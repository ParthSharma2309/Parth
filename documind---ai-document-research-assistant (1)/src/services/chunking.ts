import { ChunkRecord } from '../types/index.ts';
import { ExtractedPage } from './pdf.ts';

export interface ChunkingOptions {
  chunkSize?: number; // default ~800
  chunkOverlap?: number; // default ~150
}

/**
 * Splits extracted document pages into chunks within pages ONLY (never across pages).
 */
export function chunkDocumentPages(
  documentId: string,
  documentName: string,
  pages: ExtractedPage[],
  options: ChunkingOptions = {}
): Omit<ChunkRecord, 'embedding'>[] {
  const chunkSize = options.chunkSize ?? 800;
  const requestedOverlap = options.chunkOverlap ?? 150;
  const chunkOverlap = Math.min(requestedOverlap, Math.floor(chunkSize / 2));
  const chunks: Omit<ChunkRecord, 'embedding'>[] = [];

  let globalChunkIndex = 0;

  for (const page of pages) {
    const text = page.text;
    if (!text || text.trim().length === 0) continue;

    // If page text is smaller than or equal to chunkSize, take it as one chunk
    if (text.length <= chunkSize) {
      chunks.push({
        id: `${documentId}-p${page.pageNumber}-c${globalChunkIndex}`,
        documentId,
        documentName,
        pageNumber: page.pageNumber,
        chunkIndex: globalChunkIndex++,
        text: text.trim(),
        model: '',
        charStart: 0,
        charEnd: text.length,
      });
      continue;
    }

    // Split within this page using sliding window with overlap
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + chunkSize, text.length);

      // If we aren't at the end of the text, try finding a sentence or paragraph break
      if (end < text.length) {
        // Look for paragraph break near end
        const paragraphBreak = text.lastIndexOf('\n\n', end);
        if (paragraphBreak > start + chunkSize / 2) {
          end = paragraphBreak + 2;
        } else {
          // Look for sentence break (. ! ? followed by space or newline)
          const searchSlice = text.substring(start + chunkSize / 2, end);
          const match = searchSlice.match(/([.!?])\s+(?=[A-Z0-9])/);
          if (match && match.index !== undefined) {
            end = start + chunkSize / 2 + match.index + 1;
          } else {
            // Look for whitespace boundary
            const spaceBreak = text.lastIndexOf(' ', end);
            if (spaceBreak > start + chunkSize / 2) {
              end = spaceBreak + 1;
            }
          }
        }
      }

      const chunkText = text.substring(start, end).trim();
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
        });
      }

      if (end >= text.length) break;

      // Advance start by (end - start - chunkOverlap)
      const nextStart = Math.max(start + 1, end - chunkOverlap);
      if (nextStart <= start) {
        start = end; // prevent infinite loop
      } else {
        start = nextStart;
      }
    }
  }

  return chunks;
}
