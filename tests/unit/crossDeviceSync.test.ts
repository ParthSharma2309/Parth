import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChunkRecord } from '../../src/types/index.ts';

// Mock storage
const mockIndexedDBChunks = new Map<string, ChunkRecord[]>();
const mockIndexedDBBlobs = new Map<string, Blob>();

vi.mock('../../src/services/storage.ts', () => ({
  getChunksByDocument: vi.fn(async (docId: string) => mockIndexedDBChunks.get(docId) || []),
  saveChunks: vi.fn(async (chunks: ChunkRecord[]) => {
    for (const c of chunks) {
      const list = mockIndexedDBChunks.get(c.documentId) || [];
      // Deduplicate by ID
      const filtered = list.filter((item) => item.id !== c.id);
      filtered.push(c);
      mockIndexedDBChunks.set(c.documentId, filtered);
    }
  }),
  getDocumentBlob: vi.fn(async (docId: string) => mockIndexedDBBlobs.get(docId) || null),
  saveDocumentBlob: vi.fn(async (docId: string, blob: Blob) => {
    mockIndexedDBBlobs.set(docId, blob);
  }),
}));

// Mock Firebase Auth
vi.mock('../../src/services/firebase.ts', () => ({
  auth: {
    currentUser: {
      uid: 'user_dev_1',
      getIdToken: vi.fn(async () => 'mock-jwt-token'),
    },
  },
  db: {},
}));

// Mock docProcessor
export const mockProcessPDFFile = vi.fn(async (_blob: Blob, _name: string, _opts: any) => {
  mockIndexedDBChunks.set('doc_test_regen', [
    {
      id: 'chunk_regen_1',
      documentId: 'doc_test_regen',
      documentName: 'document.pdf',
      pageNumber: 1,
      chunkIndex: 0,
      text: 'Regenerated chunk text from PDF bytes.',
      embedding: new Float32Array([0.1, 0.2, 0.3]),
      dim: 3,
      model: 'gemini-embedding-2-preview',
      charStart: 0,
      charEnd: 38,
    },
  ]);
});

vi.mock('../../src/services/docProcessor.ts', () => ({
  processPDFFile: (blob: any, name: any, opts: any) => mockProcessPDFFile(blob, name, opts),
}));

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

import {
  ensureDocumentChunksAvailable,
  uploadDocumentChunksToCloud,
  fetchDocumentChunksFromCloud,
} from '../../src/services/cloudSync.ts';

describe('Cross-Device Chunk Synchronization & AI Preservation (tests/unit/crossDeviceSync.test.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIndexedDBChunks.clear();
    mockIndexedDBBlobs.clear();
  });

  it('1. returns cached chunks immediately from IndexedDB without network requests', async () => {
    const existingChunk: ChunkRecord = {
      id: 'chunk_local_1',
      documentId: 'doc_local_only',
      documentName: 'local.pdf',
      pageNumber: 1,
      chunkIndex: 0,
      text: 'Local chunk already in IndexedDB',
      embedding: new Float32Array([0.5, 0.5]),
      dim: 2,
      model: 'gemini-embedding-2-preview',
      charStart: 0,
      charEnd: 32,
    };
    mockIndexedDBChunks.set('doc_local_only', [existingChunk]);

    const result = await ensureDocumentChunksAvailable('doc_local_only', 'local.pdf');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('chunk_local_1');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('2. fast-path: restores chunks from cloud API when missing in local IndexedDB', async () => {
    // Mock server returning chunks
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        docId: 'doc_cloud_1',
        chunks: [
          {
            id: 'cloud_chunk_1',
            documentId: 'doc_cloud_1',
            pageNumber: 1,
            chunkIndex: 0,
            text: 'Cloud restored chunk with vector embeddings',
            dim: 3,
            embedding: [0.5, 0.25, 0.125],
            model: 'gemini-embedding-2-preview',
            charStart: 0,
            charEnd: 43,
          },
        ],
      }),
    });

    const result = await ensureDocumentChunksAvailable('doc_cloud_1', 'Remote.pdf');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('cloud_chunk_1');
    expect(result[0].embedding).toBeInstanceOf(Float32Array);
    expect(Array.from(result[0].embedding)).toEqual([0.5, 0.25, 0.125]);
    expect(result[0].documentName).toBe('Remote.pdf');

    // Verify it was persisted to IndexedDB so subsequent calls do not make network calls
    const stored = mockIndexedDBChunks.get('doc_cloud_1');
    expect(stored).toHaveLength(1);
    expect(stored![0].id).toBe('cloud_chunk_1');
  });

  it('3. prevents duplicate records when called repeatedly on the same document', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        docId: 'doc_cloud_dup',
        chunks: [
          {
            id: 'c_dup_1',
            documentId: 'doc_cloud_dup',
            pageNumber: 1,
            chunkIndex: 0,
            text: 'Deduplication test chunk',
            dim: 2,
            embedding: [0.1, 0.2],
            model: 'gemini-embedding-2-preview',
            charStart: 0,
            charEnd: 24,
          },
        ],
      }),
    });

    // Call 1: fetches from cloud and stores
    const firstCall = await ensureDocumentChunksAvailable('doc_cloud_dup', 'Test.pdf');
    expect(firstCall).toHaveLength(1);

    // Call 2: retrieves from local cache
    const secondCall = await ensureDocumentChunksAvailable('doc_cloud_dup', 'Test.pdf');
    expect(secondCall).toHaveLength(1);

    // IndexedDB should contain exactly 1 chunk, no duplicates
    const currentStored = mockIndexedDBChunks.get('doc_cloud_dup');
    expect(currentStored).toHaveLength(1);
  });

  it('4. serializes Float32Array properly when uploading chunks to cloud', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, count: 1 }),
    });

    const chunkToUpload: ChunkRecord = {
      id: 'c_up_1',
      documentId: 'doc_upload_test',
      documentName: 'up.pdf',
      pageNumber: 1,
      chunkIndex: 0,
      text: 'Text to upload',
      embedding: new Float32Array([0.5, 0.25, 0.125]),
      dim: 3,
      model: 'gemini-embedding-2-preview',
      charStart: 0,
      charEnd: 14,
    };

    const success = await uploadDocumentChunksToCloud('doc_upload_test', [chunkToUpload]);

    expect(success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const callArgs = mockFetch.mock.calls[0];
    const url = callArgs[0];
    const opts = callArgs[1];

    expect(url).toBe('/api/documents/doc_upload_test/chunks');
    expect(opts.method).toBe('POST');
    const parsedBody = JSON.parse(opts.body);
    expect(parsedBody.chunks[0].embedding).toEqual([0.5, 0.25, 0.125]);
  });

  it('5. fallback: downloads PDF and regenerates chunks if cloud chunks are missing', async () => {
    // 1st fetch: GET /api/documents/:id/chunks returns empty/null
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
    });

    // 2nd fetch: getDocumentDownloadUrl (/api/documents/:id/download-url)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        downloadUrl: 'https://storage.supabase.co/signed/file.pdf?token=xyz',
      }),
    });

    // 3rd fetch: PDF blob download from signed URL
    const fakeBlob = new Blob(['%PDF-1.4 mock pdf data'], { type: 'application/pdf' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: async () => fakeBlob,
    });

    // 4th fetch: upload regenerated chunks back to cloud
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const result = await ensureDocumentChunksAvailable('doc_test_regen', 'Regenerate.pdf');

    expect(mockProcessPDFFile).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('chunk_regen_1');
    expect(result[0].text).toContain('Regenerated chunk text');
  });

  it('6. handles network errors gracefully without throwing', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const chunks = await fetchDocumentChunksFromCloud('doc_failing');
    expect(chunks).toBeNull();

    mockFetch.mockRejectedValueOnce(new Error('Network failure'));
    const recovered = await ensureDocumentChunksAvailable('doc_failing');
    expect(recovered).toEqual([]);
  });
});
