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

// Mock Supabase storage methods
export const mockStorageUpload = vi.fn();
export const mockStorageRemove = vi.fn();
export const mockCreateSignedUrl = vi.fn();

vi.mock('../../server/lib/supabaseAdmin.js', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseBucket: vi.fn(() => 'documents'),
  getSupabaseAdminClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: mockStorageUpload,
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
import { isSupabaseConfigured } from '../../server/lib/supabaseAdmin.js';

describe('Phase 6: Production Security Audit & Authorization Hardening (securityAudit.test.ts)', () => {
  const firestoreStore = new Map<string, any>();

  const createMockFirestore = () => ({
    collection: (colPath: string) => ({
      orderBy: () => ({
        get: async () => {
          const docs: any[] = [];
          for (const [key, value] of firestoreStore.entries()) {
            if (key.startsWith(colPath + '/')) {
              const docId = key.slice(colPath.length + 1);
              docs.push({ id: docId, data: () => ({ ...value }) });
            }
          }
          return { docs };
        },
      }),
      get: async () => {
        const docs: any[] = [];
        for (const [key, value] of firestoreStore.entries()) {
          if (key.startsWith(colPath + '/')) {
            const docId = key.slice(colPath.length + 1);
            docs.push({ id: docId, data: () => ({ ...value }) });
          }
        }
        return { docs };
      },
    }),
    doc: (docPath: string) => ({
      get: async () => {
        const exists = firestoreStore.has(docPath);
        return {
          exists,
          id: docPath.split('/').pop(),
          data: () => (exists ? { ...firestoreStore.get(docPath) } : undefined),
        };
      },
      set: async (data: any, options?: any) => {
        if (options?.merge && firestoreStore.has(docPath)) {
          firestoreStore.set(docPath, { ...firestoreStore.get(docPath), ...data });
        } else {
          firestoreStore.set(docPath, { ...data });
        }
      },
      update: async (data: any) => {
        if (!firestoreStore.has(docPath)) {
          const err: any = new Error('NOT_FOUND');
          err.code = 5;
          throw err;
        }
        firestoreStore.set(docPath, { ...firestoreStore.get(docPath), ...data });
      },
      delete: async () => {
        firestoreStore.delete(docPath);
      },
    }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    firestoreStore.clear();
    (isSupabaseConfigured as any).mockReturnValue(true);
    setAdminFirestoreForTesting(createMockFirestore() as any);

    // Seed User A's document
    firestoreStore.set('users/valid-user-a/documents/sec_doc_1', {
      name: 'Confidential Strategy.pdf',
      pages: 10,
      size: 204800,
      status: 'ready',
      createdAt: '2026-10-23T10:00:00.000Z',
      updatedAt: '2026-10-23T10:00:00.000Z',
      hash: 'hash_sec_1',
      storagePath: 'valid-user-a/sec_doc_1.pdf',
      ownerId: 'valid-user-a',
    });
  });

  it('1. rejects attempts to tamper with server-controlled fields (ownerId, storagePath, size, hash, uid)', async () => {
    const maliciousFields = [
      { ownerId: 'attacker-uid' },
      { uid: 'attacker-uid' },
      { userId: 'attacker-uid' },
      { storagePath: 'attacker-uid/stolen.pdf' },
      { size: 99999999 },
      { hash: 'tampered-hash' },
      { createdAt: '1970-01-01T00:00:00.000Z' },
    ];

    for (const field of maliciousFields) {
      const res = await request(app)
        .patch('/api/documents/sec_doc_1')
        .set('Authorization', 'Bearer valid-user-a')
        .send(field);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('FORBIDDEN_FIELD_UPDATE');
      expect(res.body.error).toContain('Cannot modify server-controlled');
    }

    // Verify document in store remained completely unchanged
    const doc = firestoreStore.get('users/valid-user-a/documents/sec_doc_1');
    expect(doc.ownerId).toBe('valid-user-a');
    expect(doc.storagePath).toBe('valid-user-a/sec_doc_1.pdf');
    expect(doc.size).toBe(204800);
  });

  it('2. sanitizes error responses and never exposes stack traces or internal secrets', async () => {
    // 401 Unauthorized
    const unauthRes = await request(app)
      .get('/api/documents')
      .set('Authorization', 'Bearer bad-secret-token');

    expect(unauthRes.status).toBe(401);
    const unauthBody = JSON.stringify(unauthRes.body);
    expect(unauthBody).not.toContain('stack');
    expect(unauthBody).not.toContain('bad-secret-token');

    // 404 Not Found
    const notFoundRes = await request(app)
      .get('/api/documents/non_existent_doc_999')
      .set('Authorization', 'Bearer valid-user-a');

    expect(notFoundRes.status).toBe(404);
    const notFoundBody = JSON.stringify(notFoundRes.body);
    expect(notFoundBody).not.toContain('stack');
    expect(notFoundBody).not.toContain('node_modules');
  });

  it('3. rejects oversized authorization tokens (> 4096 bytes) safely', async () => {
    const massiveToken = 'a'.repeat(5000);
    const res = await request(app)
      .get('/api/documents')
      .set('Authorization', `Bearer ${massiveToken}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(res.body.error).toContain('maximum length');
    // Ensure the response does not echo back the 5000 characters
    expect(JSON.stringify(res.body)).not.toContain(massiveToken);
  });

  it('4. prevents cross-user document access across all endpoints', async () => {
    // User B attempts to read User A's document
    const getRes = await request(app)
      .get('/api/documents/sec_doc_1')
      .set('Authorization', 'Bearer valid-user-b');
    expect(getRes.status).toBe(404);

    // User B attempts to get signed download URL for User A's document
    const signRes = await request(app)
      .get('/api/documents/sec_doc_1/download-url')
      .set('Authorization', 'Bearer valid-user-b');
    expect(signRes.status).toBe(404);

    // User B attempts to update User A's document
    const patchRes = await request(app)
      .patch('/api/documents/sec_doc_1')
      .set('Authorization', 'Bearer valid-user-b')
      .send({ name: 'Hacked Title.pdf' });
    expect(patchRes.status).toBe(404);

    // User B attempts to delete User A's document
    const delRes = await request(app)
      .delete('/api/documents/sec_doc_1')
      .set('Authorization', 'Bearer valid-user-b');
    expect(delRes.status).toBe(404);

    // Verify storage file was never touched
    expect(mockStorageRemove).not.toHaveBeenCalled();

    // Verify document remains intact for User A
    const originalDoc = firestoreStore.get('users/valid-user-a/documents/sec_doc_1');
    expect(originalDoc.name).toBe('Confidential Strategy.pdf');
  });

  it('5. strictly prevents guest users from cloud operations with 403 GUEST_NOT_ALLOWED', async () => {
    const guestTokens = [
      'Bearer guest_user_session_123',
      'Bearer guest_anonymous_abc',
    ];

    for (const token of guestTokens) {
      const listRes = await request(app).get('/api/documents').set('Authorization', token);
      expect(listRes.status).toBe(403);
      expect(listRes.body.code).toBe('GUEST_NOT_ALLOWED');

      const getRes = await request(app).get('/api/documents/sec_doc_1').set('Authorization', token);
      expect(getRes.status).toBe(403);
      expect(getRes.body.code).toBe('GUEST_NOT_ALLOWED');

      const downloadRes = await request(app).get('/api/documents/sec_doc_1/download-url').set('Authorization', token);
      expect(downloadRes.status).toBe(403);
      expect(downloadRes.body.code).toBe('GUEST_NOT_ALLOWED');

      const delRes = await request(app).delete('/api/documents/sec_doc_1').set('Authorization', token);
      expect(delRes.status).toBe(403);
      expect(delRes.body.code).toBe('GUEST_NOT_ALLOWED');
    }
  });
});
