import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import '../helpers/firebaseAdminMock.js';

// Mock @google/genai with constructible function
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(function (this: any) {
      return {
        models: {
          embedContent: vi.fn().mockResolvedValue({
            embeddings: [{ values: [0.1, 0.2, 0.3] }],
          }),
        },
      };
    }),
    Type: {
      OBJECT: 'OBJECT',
      STRING: 'STRING',
      ARRAY: 'ARRAY',
      BOOLEAN: 'BOOLEAN',
      INTEGER: 'INTEGER',
    },
  };
});

// Mock Supabase Storage methods
export const mockStorageRemove = vi.fn();
export const mockCreateSignedUrl = vi.fn();

vi.mock('../../server/lib/supabaseAdmin.js', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseBucket: vi.fn(() => 'documents'),
  getSupabaseAdminClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        remove: mockStorageRemove,
        createSignedUrl: mockCreateSignedUrl,
      })),
    },
  })),
  resetSupabaseAdminClient: vi.fn(),
  StorageNotConfiguredError: class StorageNotConfiguredError extends Error {},
}));

import { app } from '../../server/index.js';
import { setAdminFirestoreForTesting } from '../../server/lib/firebaseAdmin.js';

describe('Phase 7: Cross-Device Document Persistence & AI Retrieval Verification', () => {
  // Stateful in-memory Firestore map for accurate multi-tenant testing
  const firestoreStore = new Map<string, any>();

  const createMockFirestore = () => {
    return {
      collection: (colPath: string) => {
        const getDocsMatching = (filters: Array<{ field: string; op: string; val: any }> = []) => {
          const docs: any[] = [];
          for (const [key, value] of firestoreStore.entries()) {
            if (key.startsWith(colPath + '/')) {
              const docId = key.slice(colPath.length + 1);
              let match = true;
              for (const f of filters) {
                if (f.op === '==' && value[f.field] !== f.val) {
                  match = false;
                  break;
                }
              }
              if (match) {
                docs.push({
                  id: docId,
                  ref: { path: key },
                  data: () => ({ ...value }),
                });
              }
            }
          }
          return docs;
        };

        const createQuery = (filters: Array<{ field: string; op: string; val: any }> = []) => ({
          where: (field: string, op: string, val: any) =>
            createQuery([...filters, { field, op, val }]),
          orderBy: () => createQuery(filters),
          get: async () => {
            const docs = getDocsMatching(filters);
            return {
              docs,
              empty: docs.length === 0,
              size: docs.length,
            };
          },
        });

        return {
          ...createQuery(),
          get: async () => {
            const docs = getDocsMatching();
            return {
              docs,
              empty: docs.length === 0,
              size: docs.length,
            };
          },
        };
      },
      doc: (docPath: string) => ({
        path: docPath,
        get: async () => {
          const val = firestoreStore.get(docPath);
          const docId = docPath.split('/').pop()!;
          return {
            exists: Boolean(val),
            id: docId,
            data: () => (val ? { ...val } : undefined),
          };
        },
        set: async (data: any, options?: { merge?: boolean }) => {
          if (options?.merge) {
            const existing = firestoreStore.get(docPath) || {};
            firestoreStore.set(docPath, { ...existing, ...data });
          } else {
            firestoreStore.set(docPath, { ...data });
          }
        },
        update: async (updates: any) => {
          const existing = firestoreStore.get(docPath) || {};
          firestoreStore.set(docPath, { ...existing, ...updates });
        },
        delete: async () => {
          firestoreStore.delete(docPath);
        },
      }),
      batch: () => {
        const operations: Array<() => void> = [];
        return {
          set: (docRef: any, data: any, options?: { merge?: boolean }) => {
            operations.push(() => {
              const path = docRef.path;
              if (options?.merge) {
                const existing = firestoreStore.get(path) || {};
                firestoreStore.set(path, { ...existing, ...data });
              } else {
                firestoreStore.set(path, { ...data });
              }
            });
          },
          delete: (docRef: any) => {
            operations.push(() => {
              const path = docRef.path;
              firestoreStore.delete(path);
            });
          },
          commit: async () => {
            operations.forEach((op) => op());
          },
        };
      },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    firestoreStore.clear();

    mockStorageRemove.mockResolvedValue({ data: [{ name: 'file.pdf' }], error: null });
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://supabase.co/storage/v1/object/sign/doc.pdf?token=xyz' },
      error: null,
    });

    // Seed User A's document: users/valid-user-a/documents/doc_alpha_1
    firestoreStore.set('users/valid-user-a/documents/doc_alpha_1', {
      name: 'User A Quantum Paper.pdf',
      pages: 14,
      size: 1048576,
      status: 'ready',
      createdAt: '2026-10-23T10:00:00.000Z',
      updatedAt: '2026-10-23T10:00:00.000Z',
      hash: 'a1a1a1a1a1a1a1a1a1a1',
      storagePath: 'valid-user-a/doc_alpha_1.pdf',
      ownerId: 'valid-user-a',
      collectionId: 'col_physics',
      summary: 'Quantum computing fundamentals.',
      topics: ['quantum', 'algorithms'],
    });

    // Seed User B's document: users/valid-user-b/documents/doc_beta_1
    firestoreStore.set('users/valid-user-b/documents/doc_beta_1', {
      name: 'User B Biology Paper.pdf',
      pages: 8,
      size: 524288,
      status: 'ready',
      createdAt: '2026-10-23T11:00:00.000Z',
      updatedAt: '2026-10-23T11:00:00.000Z',
      hash: 'b2b2b2b2b2b2b2b2b2b2',
      storagePath: 'valid-user-b/doc_beta_1.pdf',
      ownerId: 'valid-user-b',
      collectionId: 'col_biology',
      summary: 'Cellular respiration overview.',
      topics: ['biology', 'cells'],
    });

    // Seed existing chunks for doc_alpha_1 in users/valid-user-a/chunks
    firestoreStore.set('users/valid-user-a/chunks/chunk_alpha_1_1_0', {
      documentId: 'doc_alpha_1',
      page: 1,
      chunkIndex: 0,
      text: 'Quantum superposition allows qubits to exist in states |0> and |1> simultaneously.',
      model: 'gemini-embedding-2-preview',
      dim: 768,
      embedding: [0.12, 0.45, -0.23],
      charStart: 0,
      charEnd: 78,
      updatedAt: '2026-10-23T10:05:00.000Z',
    });

    firestoreStore.set('users/valid-user-a/chunks/chunk_alpha_1_2_1', {
      documentId: 'doc_alpha_1',
      page: 2,
      chunkIndex: 1,
      text: 'Entanglement produces non-local correlations between separated particles.',
      model: 'gemini-embedding-2-preview',
      dim: 768,
      embedding: [0.08, 0.33, -0.19],
      charStart: 79,
      charEnd: 154,
      updatedAt: '2026-10-23T10:05:00.000Z',
    });

    // Inject stateful mock Firestore into Firebase Admin
    setAdminFirestoreForTesting(createMockFirestore() as any);
  });

  // 1. POST /api/documents/:id/chunks persists chunks and embeddings
  it('1. allows authenticated owner to persist chunks with embeddings', async () => {
    const newChunks = [
      {
        id: 'chunk_alpha_1_3_0',
        pageNumber: 3,
        chunkIndex: 0,
        text: 'Shor algorithm achieves exponential speedup for integer factorization.',
        embedding: [0.5, 0.1, -0.4],
        charStart: 0,
        charEnd: 72,
        model: 'gemini-embedding-2-preview',
      },
    ];

    const res = await request(app)
      .post('/api/documents/doc_alpha_1/chunks')
      .set('Authorization', 'Bearer valid-user-a')
      .send({ chunks: newChunks });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);
    expect(res.body.docId).toBe('doc_alpha_1');

    // Verify stored in Firestore in user's partition
    const saved = firestoreStore.get('users/valid-user-a/chunks/chunk_alpha_1_3_0');
    expect(saved).toBeDefined();
    expect(saved.documentId).toBe('doc_alpha_1');
    expect(saved.text).toContain('Shor algorithm');
    expect(saved.embedding).toEqual([0.5, 0.1, -0.4]);
  });

  // 2. GET /api/documents/:id/chunks retrieves sorted chunks for authenticated owner
  it('2. allows authenticated owner to retrieve their document chunks sorted by page and index', async () => {
    const res = await request(app)
      .get('/api/documents/doc_alpha_1/chunks')
      .set('Authorization', 'Bearer valid-user-a');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
    expect(res.body.chunks).toHaveLength(2);

    // Verify chunk 1
    expect(res.body.chunks[0].pageNumber).toBe(1);
    expect(res.body.chunks[0].chunkIndex).toBe(0);
    expect(res.body.chunks[0].text).toContain('Quantum superposition');
    expect(res.body.chunks[0].embedding).toEqual([0.12, 0.45, -0.23]);

    // Verify chunk 2
    expect(res.body.chunks[1].pageNumber).toBe(2);
    expect(res.body.chunks[1].chunkIndex).toBe(1);
    expect(res.body.chunks[1].text).toContain('Entanglement');
  });

  // 3. Cross-user access denial: User B cannot retrieve User A's chunks
  it('3. rejects cross-user chunk retrieval with 404 (document not in user partition)', async () => {
    const res = await request(app)
      .get('/api/documents/doc_alpha_1/chunks')
      .set('Authorization', 'Bearer valid-user-b');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  // 4. Cross-user access denial: User B cannot post chunks to User A's document
  it('4. rejects cross-user chunk posting with 404 (document not in user partition)', async () => {
    const res = await request(app)
      .post('/api/documents/doc_alpha_1/chunks')
      .set('Authorization', 'Bearer valid-user-b')
      .send({
        chunks: [
          {
            pageNumber: 1,
            chunkIndex: 0,
            text: 'Malicious overwrite attempt',
            embedding: [0, 0, 0],
          },
        ],
      });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  // 5. Guest sessions cannot access chunks endpoints
  it('5. rejects guest sessions with 403 GUEST_NOT_ALLOWED on chunk endpoints', async () => {
    const getRes = await request(app)
      .get('/api/documents/doc_alpha_1/chunks')
      .set('Authorization', 'Bearer guest_test_session');

    expect(getRes.status).toBe(403);
    expect(getRes.body.code).toBe('GUEST_NOT_ALLOWED');

    const postRes = await request(app)
      .post('/api/documents/doc_alpha_1/chunks')
      .set('Authorization', 'Bearer guest_test_session')
      .send({
        chunks: [
          {
            pageNumber: 1,
            chunkIndex: 0,
            text: 'Guest test chunk',
            embedding: [0.1, 0.2],
          },
        ],
      });

    expect(postRes.status).toBe(403);
    expect(postRes.body.code).toBe('GUEST_NOT_ALLOWED');
  });

  // 6. Unauthenticated requests are rejected with 401
  it('6. rejects unauthenticated chunk requests with 401 UNAUTHORIZED', async () => {
    const getRes = await request(app).get('/api/documents/doc_alpha_1/chunks');
    expect(getRes.status).toBe(401);
    expect(getRes.body.code).toBe('UNAUTHORIZED');

    const postRes = await request(app)
      .post('/api/documents/doc_alpha_1/chunks')
      .send({
        chunks: [
          {
            pageNumber: 1,
            chunkIndex: 0,
            text: 'Unauth chunk',
            embedding: [0.1, 0.2],
          },
        ],
      });
    expect(postRes.status).toBe(401);
    expect(postRes.body.code).toBe('UNAUTHORIZED');
  });

  // 7. Input validation: rejects empty chunks or chunk count > 2000
  it('7. validates chunk payloads and limits', async () => {
    // Empty array
    const emptyRes = await request(app)
      .post('/api/documents/doc_alpha_1/chunks')
      .set('Authorization', 'Bearer valid-user-a')
      .send({ chunks: [] });

    expect(emptyRes.status).toBe(400);
    expect(emptyRes.body.code).toBe('INVALID_CHUNKS');

    // Missing chunks field
    const missingRes = await request(app)
      .post('/api/documents/doc_alpha_1/chunks')
      .set('Authorization', 'Bearer valid-user-a')
      .send({});

    expect(missingRes.status).toBe(400);
    expect(missingRes.body.code).toBe('INVALID_CHUNKS');

    // Exceeds 2000 chunks limit
    const excessiveChunks = new Array(2001).fill(null).map((_, i) => ({
      pageNumber: 1,
      chunkIndex: i,
      text: `Chunk ${i}`,
      embedding: [0.1],
    }));

    const excessRes = await request(app)
      .post('/api/documents/doc_alpha_1/chunks')
      .set('Authorization', 'Bearer valid-user-a')
      .send({ chunks: excessiveChunks });

    expect(excessRes.status).toBe(413);
    expect(excessRes.body.code).toBe('TOO_MANY_CHUNKS');
  });

  // 8. Cascading deletion: deleting document cleans up document, storage file, AND associated chunks
  it('8. deletes document metadata, storage file, and associated chunks when document is deleted', async () => {
    // Verify chunks exist before delete
    expect(firestoreStore.has('users/valid-user-a/chunks/chunk_alpha_1_1_0')).toBe(true);
    expect(firestoreStore.has('users/valid-user-a/chunks/chunk_alpha_1_2_1')).toBe(true);
    expect(firestoreStore.has('users/valid-user-a/documents/doc_alpha_1')).toBe(true);

    const deleteRes = await request(app)
      .delete('/api/documents/doc_alpha_1')
      .set('Authorization', 'Bearer valid-user-a');

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    // Verify document deleted from Firestore
    expect(firestoreStore.has('users/valid-user-a/documents/doc_alpha_1')).toBe(false);

    // Verify storage file removed
    expect(mockStorageRemove).toHaveBeenCalledWith(['valid-user-a/doc_alpha_1.pdf']);

    // Verify chunks deleted from Firestore (no orphaned chunk vectors)
    expect(firestoreStore.has('users/valid-user-a/chunks/chunk_alpha_1_1_0')).toBe(false);
    expect(firestoreStore.has('users/valid-user-a/chunks/chunk_alpha_1_2_1')).toBe(false);
  });
});
