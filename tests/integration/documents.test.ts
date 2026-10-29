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

describe('Document Metadata & Per-User Data Isolation (tests/integration/documents.test.ts)', () => {
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
      summary: 'Cellular biology fundamentals.',
      topics: ['genetics'],
    });

    setAdminFirestoreForTesting(createMockFirestore() as any);
  });

  // 1. User A can list their own documents
  it('1. allows User A to list their own documents and does not return User B documents', async () => {
    const res = await request(app)
      .get('/api/documents')
      .set('Authorization', 'Bearer valid-user-a');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.documents[0].id).toBe('doc_alpha_1');
    expect(res.body.documents[0].name).toBe('User A Quantum Paper.pdf');
    expect(res.body.documents[0].ownerId).toBe('valid-user-a');

    // Verify User B's doc is NOT returned to User A
    const ids = res.body.documents.map((d: any) => d.id);
    expect(ids).not.toContain('doc_beta_1');
  });

  // 2. User A can read their own single document metadata
  it('2. allows User A to read their own document metadata by ID', async () => {
    const res = await request(app)
      .get('/api/documents/doc_alpha_1')
      .set('Authorization', 'Bearer valid-user-a');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.document.id).toBe('doc_alpha_1');
    expect(res.body.document.name).toBe('User A Quantum Paper.pdf');
    expect(res.body.document.ownerId).toBe('valid-user-a');
    expect(res.body.document.storagePath).toBe('valid-user-a/doc_alpha_1.pdf');
  });

  // 3. User B CANNOT read User A's document metadata (isolated by authenticated UID -> 404)
  it('3. prevents User B from reading User A document metadata (returns 404)', async () => {
    const res = await request(app)
      .get('/api/documents/doc_alpha_1')
      .set('Authorization', 'Bearer valid-user-b');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.document).toBeUndefined();
  });

  // 4. User B CANNOT update User A's document record
  it('4. prevents User B from updating User A document record', async () => {
    const res = await request(app)
      .patch('/api/documents/doc_alpha_1')
      .set('Authorization', 'Bearer valid-user-b')
      .send({ name: 'Tampered Name by User B' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');

    // Verify User A document name remains unchanged
    const docA = firestoreStore.get('users/valid-user-a/documents/doc_alpha_1');
    expect(docA.name).toBe('User A Quantum Paper.pdf');
  });

  // 5. User B CANNOT delete User A's document record or file
  it('5. prevents User B from deleting User A document record or storage file', async () => {
    const res = await request(app)
      .delete('/api/documents/doc_alpha_1')
      .set('Authorization', 'Bearer valid-user-b');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');

    // Verify record still exists
    expect(firestoreStore.has('users/valid-user-a/documents/doc_alpha_1')).toBe(true);
    expect(mockStorageRemove).not.toHaveBeenCalled();
  });

  // 6. Clients CANNOT forge ownership or modify server-managed fields on PATCH
  it('6. rejects attempts to modify server-managed fields (ownerId, storagePath, size, hash, createdAt) with 400', async () => {
    // Attempt 1: Tamper with ownerId
    const resOwner = await request(app)
      .patch('/api/documents/doc_alpha_1')
      .set('Authorization', 'Bearer valid-user-a')
      .send({ ownerId: 'hacker-uid' });

    expect(resOwner.status).toBe(400);
    expect(resOwner.body.code).toBe('FORBIDDEN_FIELD_UPDATE');
    expect(resOwner.body.forbiddenFields).toContain('ownerId');

    // Attempt 2: Tamper with storagePath
    const resPath = await request(app)
      .patch('/api/documents/doc_alpha_1')
      .set('Authorization', 'Bearer valid-user-a')
      .send({ storagePath: 'hacker-uid/evil.pdf' });

    expect(resPath.status).toBe(400);
    expect(resPath.body.code).toBe('FORBIDDEN_FIELD_UPDATE');
    expect(resPath.body.forbiddenFields).toContain('storagePath');

    // Attempt 3: Tamper with size or hash
    const resSize = await request(app)
      .patch('/api/documents/doc_alpha_1')
      .set('Authorization', 'Bearer valid-user-a')
      .send({ size: 9999999 });

    expect(resSize.status).toBe(400);
    expect(resSize.body.code).toBe('FORBIDDEN_FIELD_UPDATE');

    // Verify User A document in Firestore was not altered
    const docA = firestoreStore.get('users/valid-user-a/documents/doc_alpha_1');
    expect(docA.ownerId).toBe('valid-user-a');
    expect(docA.storagePath).toBe('valid-user-a/doc_alpha_1.pdf');
    expect(docA.size).toBe(1048576);
  });

  // 7. Legitimate PATCH updates for allowed fields succeed
  it('7. allows User A to update allowed fields (name, collectionId, summary, topics)', async () => {
    const res = await request(app)
      .patch('/api/documents/doc_alpha_1')
      .set('Authorization', 'Bearer valid-user-a')
      .send({
        name: 'Updated Quantum Paper Title.pdf',
        collectionId: 'col_advanced_physics',
        summary: 'Updated summary.',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.document.name).toBe('Updated Quantum Paper Title.pdf');
    expect(res.body.document.collectionId).toBe('col_advanced_physics');
    expect(res.body.document.summary).toBe('Updated summary.');

    // Server-controlled fields remain intact
    expect(res.body.document.ownerId).toBe('valid-user-a');
    expect(res.body.document.storagePath).toBe('valid-user-a/doc_alpha_1.pdf');
  });

  // 8. Legitimate DELETE removes Firestore record and cleans up Supabase storage
  it('8. allows User A to delete their document and removes file from Supabase Storage', async () => {
    const res = await request(app)
      .delete('/api/documents/doc_alpha_1')
      .set('Authorization', 'Bearer valid-user-a');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify record removed from Firestore
    expect(firestoreStore.has('users/valid-user-a/documents/doc_alpha_1')).toBe(false);

    // Verify Supabase Storage removal was invoked with user-scoped path
    expect(mockStorageRemove).toHaveBeenCalledTimes(1);
    expect(mockStorageRemove).toHaveBeenCalledWith(['valid-user-a/doc_alpha_1.pdf']);
  });

  // 9. Unauthenticated requests are rejected with 401
  it('9. rejects unauthenticated requests with 401 UNAUTHORIZED', async () => {
    const listRes = await request(app).get('/api/documents');
    expect(listRes.status).toBe(401);
    expect(listRes.body.code).toBe('UNAUTHORIZED');

    const getRes = await request(app).get('/api/documents/doc_alpha_1');
    expect(getRes.status).toBe(401);

    const patchRes = await request(app).patch('/api/documents/doc_alpha_1').send({ name: 'X' });
    expect(patchRes.status).toBe(401);

    const deleteRes = await request(app).delete('/api/documents/doc_alpha_1');
    expect(deleteRes.status).toBe(401);
  });

  // 10. Guest sessions are rejected with 403 GUEST_NOT_ALLOWED
  it('10. rejects guest sessions on document management endpoints with 403 GUEST_NOT_ALLOWED', async () => {
    const listRes = await request(app)
      .get('/api/documents')
      .set('Authorization', 'Bearer guest_test_session');

    expect(listRes.status).toBe(403);
    expect(listRes.body.code).toBe('GUEST_NOT_ALLOWED');
  });

  // 11. Download URL generation is strictly per-user
  it('11. creates signed download URL for User A and forbids User B', async () => {
    // User A requests URL -> 200 with signedUrl
    const resA = await request(app)
      .get('/api/documents/doc_alpha_1/download-url')
      .set('Authorization', 'Bearer valid-user-a');

    expect(resA.status).toBe(200);
    expect(resA.body.success).toBe(true);
    expect(resA.body.downloadUrl).toContain('https://supabase.co/storage');
    expect(mockCreateSignedUrl).toHaveBeenCalledWith('valid-user-a/doc_alpha_1.pdf', 900);

    // User B requests User A's doc -> 404
    const resB = await request(app)
      .get('/api/documents/doc_alpha_1/download-url')
      .set('Authorization', 'Bearer valid-user-b');

    expect(resB.status).toBe(404);
  });
});
