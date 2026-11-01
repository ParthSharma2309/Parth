import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import '../helpers/firebaseAdminMock.js';

// Mock Supabase storage
export const mockStorageRemove = vi.fn();
vi.mock('../../server/lib/supabaseAdmin.js', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseBucket: vi.fn(() => 'documents'),
  getSupabaseAdminClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        remove: mockStorageRemove,
      })),
    },
  })),
  resetSupabaseAdminClient: vi.fn(),
  StorageNotConfiguredError: class StorageNotConfiguredError extends Error {},
}));

import { app } from '../../server/index.js';
import { setAdminFirestoreForTesting } from '../../server/lib/firebaseAdmin.js';
import { deleteCloudDocument } from '../../src/services/cloudSync.js';

describe('Document Deletion Feature (tests/unit/documentDeletion.test.ts)', () => {
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
        delete: async () => {
          firestoreStore.delete(docPath);
        },
      }),
      batch: () => {
        const operations: Array<() => void> = [];
        return {
          delete: (docRef: any) => {
            operations.push(() => {
              firestoreStore.delete(docRef.path);
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
    setAdminFirestoreForTesting(createMockFirestore() as any);

    // Seed User A's document and another document
    firestoreStore.set('users/valid-user-a/documents/doc_target_1', {
      name: 'User A Research Study.pdf',
      ownerId: 'valid-user-a',
      storagePath: 'valid-user-a/doc_target_1.pdf',
      pages: 5,
    });

    firestoreStore.set('users/valid-user-a/documents/doc_keep_2', {
      name: 'User A Preserved Study.pdf',
      ownerId: 'valid-user-a',
      storagePath: 'valid-user-a/doc_keep_2.pdf',
      pages: 12,
    });

    // Seed chunks for User A's target document
    for (let i = 0; i < 5; i++) {
      firestoreStore.set(`users/valid-user-a/chunks/chunk_target_${i}`, {
        documentId: 'doc_target_1',
        chunkIndex: i,
        text: `Passage ${i} of target document`,
      });
    }

    // Seed chunk for preserved document
    firestoreStore.set('users/valid-user-a/chunks/chunk_keep_0', {
      documentId: 'doc_keep_2',
      chunkIndex: 0,
      text: 'Passage from preserved document',
    });

    // Seed User B's document
    firestoreStore.set('users/valid-user-b/documents/doc_user_b_1', {
      name: 'User B Confidential File.pdf',
      ownerId: 'valid-user-b',
      storagePath: 'valid-user-b/doc_user_b_1.pdf',
      pages: 3,
    });
  });

  it('1. allows User A to delete their document and removes Firestore record, chunks, and storage file', async () => {
    const res = await request(app)
      .delete('/api/documents/doc_target_1')
      .set('Authorization', 'Bearer valid-user-a');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify User A target document is deleted
    expect(firestoreStore.has('users/valid-user-a/documents/doc_target_1')).toBe(false);

    // Verify associated chunks for target document are deleted
    for (let i = 0; i < 5; i++) {
      expect(firestoreStore.has(`users/valid-user-a/chunks/chunk_target_${i}`)).toBe(false);
    }

    // Verify preserved document and its chunk remain untouched
    expect(firestoreStore.has('users/valid-user-a/documents/doc_keep_2')).toBe(true);
    expect(firestoreStore.has('users/valid-user-a/chunks/chunk_keep_0')).toBe(true);

    // Verify Supabase storage removal was called with user-scoped path
    expect(mockStorageRemove).toHaveBeenCalledWith(['valid-user-a/doc_target_1.pdf']);
  });

  it('2. blocks cross-user deletion: User B cannot delete User A document and gets 404 without leaking existence', async () => {
    const res = await request(app)
      .delete('/api/documents/doc_target_1')
      .set('Authorization', 'Bearer valid-user-b');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');

    // Document and chunks must remain intact
    expect(firestoreStore.has('users/valid-user-a/documents/doc_target_1')).toBe(true);
    expect(firestoreStore.has('users/valid-user-a/chunks/chunk_target_0')).toBe(true);
    expect(mockStorageRemove).not.toHaveBeenCalled();
  });

  it('3. rejects unauthenticated deletion requests with 401 UNAUTHORIZED', async () => {
    const res = await request(app).delete('/api/documents/doc_target_1');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(firestoreStore.has('users/valid-user-a/documents/doc_target_1')).toBe(true);
  });

  it('4. rejects guest sessions from deleting documents with 403 GUEST_NOT_ALLOWED', async () => {
    const res = await request(app)
      .delete('/api/documents/doc_target_1')
      .set('Authorization', 'Bearer guest_session_123');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('GUEST_NOT_ALLOWED');
    expect(firestoreStore.has('users/valid-user-a/documents/doc_target_1')).toBe(true);
  });

  it('5. returns 404 when attempting to delete a non-existent document', async () => {
    const res = await request(app)
      .delete('/api/documents/non_existent_doc_id')
      .set('Authorization', 'Bearer valid-user-a');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('6. handles batched deletion of large documents with > 400 chunks without exceeding batch limit', async () => {
    // Seed 450 chunks for doc_target_1
    for (let i = 0; i < 450; i++) {
      firestoreStore.set(`users/valid-user-a/chunks/large_chunk_${i}`, {
        documentId: 'doc_target_1',
        chunkIndex: i,
        text: `Passage ${i}`,
      });
    }

    const res = await request(app)
      .delete('/api/documents/doc_target_1')
      .set('Authorization', 'Bearer valid-user-a');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify all 450 chunks were deleted
    for (let i = 0; i < 450; i++) {
      expect(firestoreStore.has(`users/valid-user-a/chunks/large_chunk_${i}`)).toBe(false);
    }
  });

  it('7. deleteCloudDocument throws actionable error when offline', async () => {
    // Mock navigator.onLine as false
    const originalNavigator = globalThis.navigator;
    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: false },
        configurable: true,
      });

      await expect(deleteCloudDocument('doc_target_1')).rejects.toThrow(
        /Cannot delete cloud document while offline/i
      );
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  it('8. deleteCloudDocument treats 404 (document already absent from cloud) as idempotent success', async () => {
    const originalFetch = globalThis.fetch;
    const originalNavigator = globalThis.navigator;
    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: true },
        configurable: true,
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Document not found.', code: 'NOT_FOUND' }),
      } as any);

      const result = await deleteCloudDocument('doc_already_absent');
      expect(result).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
  });
});
