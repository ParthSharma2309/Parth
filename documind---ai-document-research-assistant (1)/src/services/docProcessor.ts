import { DocumentRecord } from '../types/index.ts';
import { extractTextFromPDF } from './pdf.ts';
import { chunkDocumentPages } from './chunking.ts';
import { embedChunks } from './embeddings.ts';
import {
  saveDocument,
  updateDocumentStatus,
  saveChunks,
  deleteChunksByDocument,
  getSettings,
  getDocumentBlob,
  getDocumentById,
} from './storage.ts';

export interface ProcessDocumentOptions {
  collectionId?: string;
  onProgress?: (progress: number, stepText: string) => void;
}

/**
 * Handles the complete document ingestion lifecycle for PDF documents:
 * Uploaded -> Processing (Extracting native text + reading images/diagrams/OCR -> Chunking -> Embedding) -> Ready or Failed.
 */
export async function processPDFFile(
  file: File | Blob,
  fileName: string,
  options: ProcessDocumentOptions = {}
): Promise<DocumentRecord> {
  const settings = await getSettings();
  const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const initialDoc: DocumentRecord = {
    id: docId,
    name: fileName,
    size: file.size,
    pageCount: 0,
    collectionId: options.collectionId,
    status: 'Processing',
    statusMessage: 'Validating and reading PDF...',
    progress: 5,
    processingStep: 'validating',
    extractedCharacters: 0,
    avgCharactersPerPage: 0,
    uploadedAt: Date.now(),
    modelUsed: settings.embeddingModel,
    hasExtractableText: true,
  };

  // Save document and blob to IndexedDB
  await saveDocument(initialDoc, file);

  try {
    // 1. Text & Vision Extraction
    await updateDocumentStatus(docId, {
      processingStep: 'extracting',
      statusMessage: 'Extracting page text & analyzing images with Gemini Vision...',
      progress: 15,
    });
    options.onProgress?.(15, 'Extracting text & analyzing diagrams...');

    const extractionResult = await extractTextFromPDF(
      file,
      settings.maxFileSizeMB,
      (pagesDone, totalPages, statusDetail) => {
        const pct = Math.round(15 + (pagesDone / totalPages) * 35);
        const label = statusDetail || `Extracting page ${pagesDone} of ${totalPages}...`;
        options.onProgress?.(pct, label);
        updateDocumentStatus(docId, {
          progress: pct,
          statusMessage: label,
        });
      }
    );

    // Check if empty or unscannable
    if (!extractionResult.hasExtractableText) {
      await updateDocumentStatus(docId, {
        status: 'Failed',
        statusMessage: extractionResult.statusMessage || 'No extractable text or imagery found',
        pageCount: extractionResult.numPages,
        extractedCharacters: extractionResult.totalCharacters,
        avgCharactersPerPage: extractionResult.avgCharactersPerPage,
        hasExtractableText: false,
        processingStep: 'failed',
        progress: 100,
      });
      throw new Error(
        extractionResult.statusMessage ||
          `Document has no extractable text or readable images (${extractionResult.avgCharactersPerPage} avg chars/page).`
      );
    }

    // 2. Chunking
    await updateDocumentStatus(docId, {
      processingStep: 'chunking',
      statusMessage: 'Splitting text and diagram insights into page-level chunks...',
      pageCount: extractionResult.numPages,
      extractedCharacters: extractionResult.totalCharacters,
      avgCharactersPerPage: extractionResult.avgCharactersPerPage,
      progress: 55,
    });
    options.onProgress?.(55, 'Chunking pages...');

    const rawChunks = chunkDocumentPages(docId, fileName, extractionResult.pages, {
      chunkSize: settings.chunkSize,
      chunkOverlap: settings.chunkOverlap,
    });

    if (rawChunks.length === 0) {
      throw new Error('Document produced zero readable text chunks.');
    }

    // 3. Batched Embedding
    await updateDocumentStatus(docId, {
      processingStep: 'embedding',
      statusMessage: `Generating Gemini embeddings (0/${rawChunks.length})...`,
      progress: 60,
    });
    options.onProgress?.(60, `Generating embeddings (0/${rawChunks.length})...`);

    const embeddedChunks = await embedChunks(rawChunks, {
      model: settings.embeddingModel,
      batchSize: 6,
      onProgress: (done, total, statusMsg) => {
        const pct = Math.round(60 + (done / total) * 38);
        const msg = statusMsg || `Embedding passages with Gemini (${done}/${total})...`;
        updateDocumentStatus(docId, {
          progress: pct,
          statusMessage: msg,
        });
        options.onProgress?.(pct, msg);
      },
    });

    // 4. Save Chunks to IndexedDB
    await saveChunks(embeddedChunks);

    // 5. Mark as Ready
    const finalDoc: DocumentRecord = {
      ...initialDoc,
      pageCount: extractionResult.numPages,
      extractedCharacters: extractionResult.totalCharacters,
      avgCharactersPerPage: extractionResult.avgCharactersPerPage,
      status: 'Ready',
      statusMessage: 'Indexed & ready for research',
      progress: 100,
      processingStep: 'complete',
    };
    await updateDocumentStatus(docId, finalDoc);
    options.onProgress?.(100, 'Ready');

    return finalDoc;
  } catch (error: any) {
    console.error('Document processing failed:', error);
    await updateDocumentStatus(docId, {
      status: 'Failed',
      statusMessage: error.message || 'Processing failed',
      processingStep: 'failed',
    });
    throw error;
  }
}

/**
 * Converts a Blob or File to a base64 string
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result as string;
      const base64 = res.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Optimizes an image blob (downscaling if dimension exceeds maxDimension)
 * to avoid massive payloads, memory exhaustion, and Gemini Vision timeout aborts.
 */
async function optimizeImageBlob(blob: Blob, maxDimension = 1400): Promise<{ base64: string; mimeType: string }> {
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          canvas.width = 0;
          canvas.height = 0;
          resolve({ base64: dataUrl.split(',')[1] || '', mimeType: 'image/jpeg' });
          return;
        }
        blobToBase64(blob).then((base64) => resolve({ base64, mimeType: blob.type || 'image/jpeg' }));
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        blobToBase64(blob).then((base64) => resolve({ base64, mimeType: blob.type || 'image/jpeg' }));
      };
      img.src = objectUrl;
    });
  } catch {
    const raw = await blobToBase64(blob);
    return { base64: raw, mimeType: blob.type || 'image/jpeg' };
  }
}

/**
 * Handles processing of standalone images (PNG, JPG, WEBP, etc.)
 * Analyzes the whole image, transcribes all OCR text, and indexes it as Page 1.
 */
export async function processImageFile(
  file: File | Blob,
  fileName: string,
  options: ProcessDocumentOptions = {}
): Promise<DocumentRecord> {
  const settings = await getSettings();
  const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const initialDoc: DocumentRecord = {
    id: docId,
    name: fileName,
    size: file.size,
    pageCount: 1,
    collectionId: options.collectionId,
    status: 'Processing',
    statusMessage: 'Reading and analyzing image with Gemini Vision...',
    progress: 10,
    processingStep: 'extracting',
    extractedCharacters: 0,
    avgCharactersPerPage: 0,
    uploadedAt: Date.now(),
    modelUsed: settings.embeddingModel,
    hasExtractableText: true,
  };

  await saveDocument(initialDoc, file);

  try {
    options.onProgress?.(20, 'Analyzing image with Gemini Vision...');
    const { base64: imageBase64, mimeType } = await optimizeImageBlob(file, 1400);

    let res = await fetch('/api/analyze-page-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64,
        mimeType,
        pageNumber: 1,
      }),
    });

    if (!res.ok && (res.status === 504 || res.status === 503)) {
      // Retry with further downscaled resolution to guarantee fast completion
      const downscaled = await optimizeImageBlob(file, 900);
      res = await fetch('/api/analyze-page-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: downscaled.base64,
          mimeType: downscaled.mimeType,
          pageNumber: 1,
        }),
      });
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Vision analysis failed with status ${res.status}`);
    }

    const data = await res.json();
    const extractedText = (data.text || '').trim();

    if (extractedText.length === 0) {
      throw new Error('No readable text or visual structure found in this image.');
    }

    options.onProgress?.(55, 'Chunking image analysis...');
    const pages = [{ pageNumber: 1, text: extractedText }];

    const rawChunks = chunkDocumentPages(docId, fileName, pages, {
      chunkSize: settings.chunkSize,
      chunkOverlap: settings.chunkOverlap,
    });

    options.onProgress?.(65, 'Embedding image content...');
    const embeddedChunks = await embedChunks(rawChunks, {
      model: settings.embeddingModel,
      batchSize: 6,
      onProgress: (done, total, statusMsg) => {
        const pct = Math.round(65 + (done / total) * 32);
        options.onProgress?.(pct, statusMsg || `Embedding image content (${done}/${total})...`);
      },
    });

    await saveChunks(embeddedChunks);

    const finalDoc: DocumentRecord = {
      ...initialDoc,
      pageCount: 1,
      extractedCharacters: extractedText.length,
      avgCharactersPerPage: extractedText.length,
      status: 'Ready',
      statusMessage: 'Indexed & ready for research',
      progress: 100,
      processingStep: 'complete',
    };

    await updateDocumentStatus(docId, finalDoc);
    options.onProgress?.(100, 'Ready');
    return finalDoc;
  } catch (error: any) {
    console.error('Image processing failed:', error);
    await updateDocumentStatus(docId, {
      status: 'Failed',
      statusMessage: error.message || 'Image processing failed',
      processingStep: 'failed',
    });
    throw error;
  }
}

/**
 * Universal document ingestion: Automatically routes PDFs and images
 */
export async function processDocumentFile(
  file: File | Blob,
  fileName: string,
  options: ProcessDocumentOptions = {}
): Promise<DocumentRecord> {
  const isImage =
    file.type.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|bmp)$/i.test(fileName);

  if (isImage) {
    return processImageFile(file, fileName, options);
  }
  return processPDFFile(file, fileName, options);
}

/**
 * Retries processing for a failed document using the original blob stored in IndexedDB.
 */
export async function retryProcessDocument(
  docId: string,
  onProgress?: (progress: number, stepText: string) => void
): Promise<void> {
  const doc = await getDocumentById(docId);
  const blob = await getDocumentBlob(docId);
  if (!blob) {
    throw new Error('Original document blob was not found in storage. Please re-upload the file.');
  }

  const docName = doc?.name || 'document.pdf';
  await deleteChunksByDocument(docId);
  const settings = await getSettings();

  const isImage =
    blob.type.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|bmp)$/i.test(docName);

  await updateDocumentStatus(docId, {
    status: 'Processing',
    statusMessage: isImage ? 'Re-analyzing image with Gemini Vision...' : 'Retrying PDF extraction & Vision analysis...',
    processingStep: 'extracting',
    progress: 10,
  });

  try {
    let pages: Array<{ pageNumber: number; text: string }> = [];
    let pageCount = 1;
    let totalCharacters = 0;
    let avgCharacters = 0;

    if (isImage) {
      const { base64: imageBase64, mimeType } = await optimizeImageBlob(blob, 1400);
      let res = await fetch('/api/analyze-page-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          mimeType,
          pageNumber: 1,
        }),
      });
      if (!res.ok && (res.status === 504 || res.status === 503)) {
        const downscaled = await optimizeImageBlob(blob, 900);
        res = await fetch('/api/analyze-page-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: downscaled.base64,
            mimeType: downscaled.mimeType,
            pageNumber: 1,
          }),
        });
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Vision analysis failed with status ${res.status}`);
      }
      const data = await res.json();
      const txt = (data.text || '').trim();
      if (!txt) throw new Error('No text or figures extracted from image');
      pages = [{ pageNumber: 1, text: txt }];
      totalCharacters = txt.length;
      avgCharacters = txt.length;
    } else {
      const extractionResult = await extractTextFromPDF(blob, settings.maxFileSizeMB, (done, total, msg) => {
        onProgress?.(Math.round(10 + (done / total) * 35), msg || `Extracting page ${done}/${total}...`);
      });

      if (!extractionResult.hasExtractableText) {
        throw new Error(extractionResult.statusMessage || 'No extractable text found in this PDF.');
      }
      pages = extractionResult.pages;
      pageCount = extractionResult.numPages;
      totalCharacters = extractionResult.totalCharacters;
      avgCharacters = extractionResult.avgCharactersPerPage;
    }

    const rawChunks = chunkDocumentPages(docId, docName, pages, {
      chunkSize: settings.chunkSize,
      chunkOverlap: settings.chunkOverlap,
    });

    await updateDocumentStatus(docId, {
      processingStep: 'embedding',
      statusMessage: `Generating embeddings (0/${rawChunks.length})...`,
      progress: 50,
    });

    const embeddedChunks = await embedChunks(rawChunks, {
      model: settings.embeddingModel,
      batchSize: 6,
      onProgress: (done, total, statusMsg) => {
        const pct = Math.round(50 + (done / total) * 45);
        const msg = statusMsg || `Generating embeddings (${done}/${total})...`;
        updateDocumentStatus(docId, {
          progress: pct,
          statusMessage: msg,
        });
        onProgress?.(pct, msg);
      },
    });

    await saveChunks(embeddedChunks);

    await updateDocumentStatus(docId, {
      status: 'Ready',
      statusMessage: 'Indexed & ready for research',
      progress: 100,
      processingStep: 'complete',
      pageCount,
      extractedCharacters: totalCharacters,
      avgCharactersPerPage: avgCharacters,
    });
  } catch (err: any) {
    console.error(`Retry processing failed for ${docId}:`, err);
    await updateDocumentStatus(docId, {
      status: 'Failed',
      statusMessage: err.message || 'Retry processing failed',
      processingStep: 'failed',
    });
    throw err;
  }
}
