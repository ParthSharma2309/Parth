import { ChunkRecord } from '../types/index.ts';
import { ExtractedPage } from './pdf.ts';
import { MODEL_CONFIG } from '../config/models.ts';

export interface ChunkingOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

/**
 * Splits extracted document pages into chunks using ONE canonical config from MODEL_CONFIG:
 * defaultChunkSize: 900 chars, overlap: 180 chars.
 * Allows a chunk at the end of a page to overlap into the start of the next page (last 150 chars)
 * for uninterrupted cross-page semantic context.
 */
export function chunkDocumentPages(
  documentId: string,
  documentName: string,
  pages: ExtractedPage[],
  options: ChunkingOptions = {}
): Omit<ChunkRecord, 'embedding'>[] {
  // Use ONE config (900 / 180) from MODEL_CONFIG (Requirement 5)
  const chunkSize = options.chunkSize || MODEL_CONFIG.defaultChunkSize;
  const chunkOverlap = options.chunkOverlap || MODEL_CONFIG.defaultChunkOverlap;
  const pageBoundaryOverlap = MODEL_CONFIG.pageBoundaryOverlap || 150;

  const chunks: Omit<ChunkRecord, 'embedding'>[] = [];
  let globalChunkIndex = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const text = page.text;
    if (!text || text.trim().length === 0) continue;

    const nextPage = i + 1 < pages.length ? pages[i + 1] : null;
    const nextPageOverlapText =
      nextPage && nextPage.text && nextPage.text.trim().length > 0
        ? nextPage.text.trim().slice(0, pageBoundaryOverlap)
        : '';

    // If page text is smaller than or equal to chunkSize, take it as one chunk,
    // and if there's a next page, overlap into the start of the next page (last 150 chars)
    if (text.length <= chunkSize) {
      let combinedText = text.trim();
      if (nextPageOverlapText) {
        combinedText = `${combinedText} ${nextPageOverlapText}`;
      }

      chunks.push({
        id: `${documentId}-p${page.pageNumber}-c${globalChunkIndex}`,
        documentId,
        documentName,
        pageNumber: page.pageNumber,
        chunkIndex: globalChunkIndex++,
        text: combinedText.trim(),
        model: '',
        charStart: 0,
        charEnd: text.length,
        isOCR: page.isOCR,
      });
      continue;
    }

    // Split within this page using sliding window with overlap
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + chunkSize, text.length);

      // If we aren't at the end of the text, try finding a sentence or paragraph break
      if (end < text.length) {
        const paragraphBreak = text.lastIndexOf('\n\n', end);
        if (paragraphBreak > start + chunkSize / 2) {
          end = paragraphBreak + 2;
        } else {
          const searchSlice = text.substring(start + chunkSize / 2, end);
          const match = searchSlice.match(/([.!?])\s+(?=[A-Z0-9])/);
          if (match && match.index !== undefined) {
            end = start + chunkSize / 2 + match.index + 1;
          } else {
            const spaceBreak = text.lastIndexOf(' ', end);
            if (spaceBreak > start + chunkSize / 2) {
              end = spaceBreak + 1;
            }
          }
        }
      }

      let chunkText = text.substring(start, end).trim();

      // If this is the last chunk on this page and there is a next page,
      // allow this chunk to overlap into the start of the next page (up to 150 chars)
      const isLastChunkOfPage = end >= text.length;
      if (isLastChunkOfPage && nextPageOverlapText) {
        chunkText = `${chunkText} ${nextPageOverlapText}`.trim();
      }

      if (chunkText.length > 20) {
        chunks.push({
          id: `${documentId}-p${page.pageNumber}-c${globalChunkIndex}`,
          documentId,
          documentName,
          pageNumber: page.pageNumber,
          chunkIndex: globalChunkIndex++,
          text: chunkText,
          model: '',
          charStart: start,
          charEnd: end,
          isOCR: page.isOCR,
        });
      }

      if (end >= text.length) break;

      const nextStart = Math.max(start + 1, end - chunkOverlap);
      if (nextStart <= start) {
        start = end;
      } else {
        start = nextStart;
      }
    }
  }

  return chunks;
}
