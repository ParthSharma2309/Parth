import { describe, it, expect } from 'vitest';
import { chunkDocumentPages } from '../../src/services/chunking.ts';
import { ExtractedPage } from '../../src/services/pdf.ts';

describe('chunkDocumentPages', () => {
  it('does not create empty chunks for whitespace or empty pages', () => {
    const pages: ExtractedPage[] = [
      { pageNumber: 1, text: '', isOCR: false },
      { pageNumber: 2, text: '   \n\t  ', isOCR: false },
      { pageNumber: 3, text: 'Valid scholarly document page text here.', isOCR: false },
    ];

    const chunks = chunkDocumentPages('doc1', 'Research Paper.pdf', pages);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.trim().length).toBeGreaterThan(0);
      expect(chunk.documentId).toBe('doc1');
      expect(chunk.documentName).toBe('Research Paper.pdf');
    }
  });

  it('correctly creates overlap between consecutive chunks on a page', () => {
    // Generate a long text that exceeds default chunk size (900 chars)
    const sentence = 'The quick brown fox jumps over the lazy dog in empirical research. ';
    const longText = sentence.repeat(25); // ~1700 chars

    const pages: ExtractedPage[] = [
      { pageNumber: 1, text: longText, isOCR: false },
    ];

    const chunks = chunkDocumentPages('doc1', 'Doc.pdf', pages, {
      chunkSize: 500,
      chunkOverlap: 100,
    });

    expect(chunks.length).toBeGreaterThan(1);
    // Verify that the end of chunk 0 overlaps with the beginning of chunk 1
    const endOfChunk0 = chunks[0].text.slice(-50);
    expect(chunks[1].text.includes(endOfChunk0) || chunks[0].text.includes(chunks[1].text.slice(0, 50))).toBe(true);
  });

  it('incorporates page boundary overlap into the subsequent page start', () => {
    const pages: ExtractedPage[] = [
      {
        pageNumber: 1,
        text: 'This is the complete text of page one ending with key findings.',
        isOCR: false,
      },
      {
        pageNumber: 2,
        text: 'Page two continues the methodology discussion in full detail.',
        isOCR: false,
      },
    ];

    const chunks = chunkDocumentPages('doc1', 'MultiPage.pdf', pages);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const chunkPage1 = chunks.find((c) => c.pageNumber === 1);
    expect(chunkPage1).toBeDefined();
    // The page 1 chunk should contain boundary overlap from the beginning of page 2
    expect(chunkPage1!.text).toContain('Page two continues');
  });
});
