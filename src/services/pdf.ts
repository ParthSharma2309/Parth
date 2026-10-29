import * as pdfjsLib from 'pdfjs-dist';
import { MODEL_CONFIG } from '../config/models.ts';
import { authFetch } from './apiClient.ts';

// Configure PDF.js worker
if (typeof window !== 'undefined') {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  } catch {
    // Fallback to CDN if URL resolution fails
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  }
}

export interface ExtractedPage {
  pageNumber: number; // 1-based
  text: string;
  isOCR?: boolean;
}

export interface PDFExtractionResult {
  numPages: number;
  pages: ExtractedPage[];
  totalCharacters: number;
  avgCharactersPerPage: number;
  hasExtractableText: boolean;
  statusMessage?: string;
}

/**
 * Validate that the file starts with the %PDF magic bytes
 */
export function validatePDFMagicBytes(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false;
  const bytes = new Uint8Array(buffer.slice(0, 4));
  // ASCII % = 0x25, P = 0x50, D = 0x44, F = 0x46
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

/**
 * Detects if a page contains embedded images or raster draw operations
 */
async function pageContainsImages(page: pdfjsLib.PDFPageProxy): Promise<boolean> {
  try {
    const operatorList = await page.getOperatorList();
    const ops = pdfjsLib.OPS;
    return operatorList.fnArray.some(
      (fn) =>
        fn === ops.paintImageXObject ||
        fn === ops.paintInlineImageXObject ||
        fn === ops.paintImageMaskXObject ||
        fn === ops.paintSolidColorImageMask
    );
  } catch {
    return false;
  }
}

/**
 * Renders a PDF page to base64 JPEG data with adaptive resolution clamping (max 1280px)
 * for optimal Gemini Vision performance, reduced transfer payload, and zero timeouts.
 */
async function renderPageToBase64Jpeg(page: pdfjsLib.PDFPageProxy, maxDimension = 1280): Promise<string> {
  const effectiveMaxDim = maxDimension > 100 ? maxDimension : 1280;
  const unscaled = page.getViewport({ scale: 1.0 });
  const longestEdge = Math.max(unscaled.width, unscaled.height);
  // Calculate scale so longest dimension does not exceed maxDimension
  const scale = longestEdge > 0 && longestEdge > effectiveMaxDim
    ? effectiveMaxDim / longestEdge
    : Math.min(1.5, Math.max(1.0, effectiveMaxDim / (longestEdge || 1)));

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create 2D canvas context for page rendering.');
  }

  // Paint white background
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const renderTask = page.render({
    canvasContext: context,
    canvas: canvas as any,
    viewport,
  });
  await renderTask.promise;

  const dataUrl = canvas.toDataURL('image/jpeg', 0.80);
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl.split(',')[1];
}

/**
 * Sends page image to server Gemini Vision endpoint for OCR and visual comprehension
 */
async function analyzePageImage(imageBase64: string, pageNumber: number): Promise<string> {
  try {
    const res = await authFetch('/api/analyze-page-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64,
        mimeType: 'image/jpeg',
        pageNumber,
      }),
    });

    if (!res.ok) {
      console.warn(`Vision analysis returned status ${res.status} for page ${pageNumber}`);
      return '';
    }

    const data = await res.json();
    return data.text || '';
  } catch (err) {
    console.warn(`Vision analysis request failed for page ${pageNumber}:`, err);
    return '';
  }
}

/**
 * Validates and extracts text page by page from an uploaded PDF file,
 * reading both native text and full images, diagrams, and scanned text via Gemini Vision.
 */
export async function extractTextFromPDF(
  file: File | Blob,
  maxSizeMB: number = MODEL_CONFIG.maxFileSizeMB,
  onProgress?: (pagesCompleted: number, totalPages: number, statusDetail?: string) => void
): Promise<PDFExtractionResult> {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    throw new Error(
      `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds maximum allowed limit of ${maxSizeMB} MB.`
    );
  }

  const arrayBuffer = await file.arrayBuffer();

  // Validate magic bytes
  if (!validatePDFMagicBytes(arrayBuffer)) {
    throw new Error(
      'Invalid file: The file does not contain valid %PDF magic bytes. Please upload a genuine PDF file.'
    );
  }

  let pdfDoc: pdfjsLib.PDFDocumentProxy;
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      useWorkerFetch: false,
      useSystemFonts: true,
    });
    pdfDoc = await loadingTask.promise;
  } catch (err: any) {
    if (err.name === 'PasswordException' || err.message?.includes('password')) {
      throw new Error(
        'This PDF is encrypted or password-protected. DocuMind cannot process password-locked documents.'
      );
    }
    if (err.name === 'InvalidPDFException' || err.message?.includes('corrupt')) {
      throw new Error(
        'The PDF file is corrupted or could not be decoded. Please verify the document and try again.'
      );
    }
    throw new Error(`Failed to load PDF: ${err.message || 'Unknown error'}`);
  }

  const numPages = pdfDoc.numPages;
  if (numPages === 0) {
    throw new Error('This PDF contains zero pages.');
  }

  const pages: ExtractedPage[] = [];
  let totalCharacters = 0;
  let visionCallsCount = 0;
  const maxVisionCalls = 25; // Sensible ceiling for vision calls per document

  try {
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Reconstruct text items preserving spaces & line breaks
      let pageText = '';
      let lastY: number | null = null;

      for (const item of textContent.items) {
        if ('str' in item) {
          const itemStr = item.str;
          // Check line jump using transform matrix
          if (lastY !== null && 'transform' in item && Math.abs(item.transform[5] - lastY) > 6) {
            pageText += '\n';
          } else if (pageText.length > 0 && !pageText.endsWith(' ') && !pageText.endsWith('\n')) {
            pageText += ' ';
          }
          pageText += itemStr;
          if ('transform' in item) {
            lastY = item.transform[5];
          }
        }
      }

      // Clean up excessive whitespace within the page
      let cleanedText = pageText
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();

      // Check if page has under 50 characters (triggering OCR fallback) or embedded images
      const hasEmbeddedImages = await pageContainsImages(page);
      const isScannedOrLowText = cleanedText.length < 50;
      let pageIsOCR = false;

      if ((hasEmbeddedImages || isScannedOrLowText) && visionCallsCount < maxVisionCalls) {
        const detailMsg = isScannedOrLowText
          ? `Page ${pageNum} (<50 chars, performing Gemini Vision OCR)...`
          : `Page ${pageNum} (reading embedded figures & diagram images)...`;

        if (onProgress) {
          onProgress(pageNum, numPages, detailMsg);
        }

        try {
          visionCallsCount++;
          const imageBase64 = await renderPageToBase64Jpeg(page, 1280);
          const visionAnalysis = await analyzePageImage(imageBase64, pageNum);

          if (visionAnalysis && visionAnalysis.length > 0) {
            if (isScannedOrLowText) {
              cleanedText = visionAnalysis;
              pageIsOCR = true;
            } else {
              cleanedText = `${cleanedText}\n\n[Page ${pageNum} Visual Figures & Image Analysis]:\n${visionAnalysis}`;
            }
          }
          // Small inter-call pause to preserve quota window
          await new Promise((r) => setTimeout(r, 200));
        } catch (visionErr) {
          console.warn(`Vision extraction skipped for page ${pageNum}:`, visionErr);
        }
      }

      pages.push({
        pageNumber: pageNum,
        text: cleanedText,
        isOCR: pageIsOCR,
      });

      totalCharacters += cleanedText.length;

      if (onProgress) {
        onProgress(pageNum, numPages, `Extracted page ${pageNum} of ${numPages}`);
      }
    }
  } finally {
    try {
      await ((pdfDoc as any).destroy?.() || (pdfDoc as any).cleanup?.());
    } catch {}
  }

  const avgCharactersPerPage = totalCharacters / numPages;
  const hasExtractableText = totalCharacters >= 30;

  let statusMessage: string | undefined = undefined;
  if (!hasExtractableText) {
    statusMessage = 'No extractable text or readable images found';
  }

  return {
    numPages,
    pages,
    totalCharacters,
    avgCharactersPerPage: Math.round(avgCharactersPerPage),
    hasExtractableText,
    statusMessage,
  };
}
