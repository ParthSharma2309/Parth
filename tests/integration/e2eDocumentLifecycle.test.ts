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

describe('Phase 5: End-to-End Document Storage & Lifecycle Integration (e2eDocumentLifecycle.test.ts)', () => {
  const validPdfHeader = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

  // Multi-tenant in-memory Firestore database
  const firestoreDb = new Map<string, any>();

  const createMockFirestore = () => ({
    collection: (colPath: string) => ({
      orderBy: () => ({
        get: async () => {
          const docs: any[] = [];
          for (const [key, value] of firestoreDb.entries()) {
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
        for (const [key, value] of firestoreDb.entries()) {
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
        const exists = firestoreDb.has(docPath);
        return {
          exists,
          id: docPath.split('/').pop(),
          data: () => (exists ? { ...firestoreDb.get(docPath) } : undefined),
        };
      },
      set: async (data: any, options?: any) => {
        if (options?.merge && firestoreDb.has(docPath)) {
          firestoreDb.set(docPath, { ...firestoreDb.get(docPath), ...data });
        } else {
          firestoreDb.set(docPath, { ...data });
        }
      },
      update: async (data: any) => {
        if (!firestoreDb.has(docPath)) {
          const err: any = new Error('NOT_FOUND');
          err.code = 5;
          throw err;
        }
        firestoreDb.set(docPath, { ...firestoreDb.get(docPath), ...data });
      },
      delete: async () => {
        firestoreDb.delete(docPath);
      },
    }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    firestoreDb.clear();
    (isSupabaseConfigured as any).mockReturnValue(true);
    setAdminFirestoreForTesting(createMockFirestore() as any);

    mockStorageUpload.mockResolvedValue({ data: { path: 'uploaded' }, error: null });
    mockStorageRemove.mockResolvedValue({ data: [{ name: 'removed' }], error: null });
    mockCreateSignedUrl.mockImplementation(async (path: string, expiresIn: number) => {
      return {
        data: {
          signedUrl: `https://test-project.supabase.co/storage/v1/object/sign/documents/${path}?token=signed_token_abc&expires=${Date.now() + expiresIn * 1000}`,
        },
        error: null,
      };
    });
  });

  it('completes the entire document lifecycle: upload -> list -> retrieve -> signed url -> delete', async () => {
    const userAToken = 'Bearer valid-user-a';
    let docId = '';
    let storagePath = '';

    // 1. Authenticated User A uploads a valid PDF
    const uploadRes = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', userAToken)
      .attach('file', validPdfHeader, 'research_paper.pdf')
      .field('collectionId', 'col_biotech');

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.success).toBe(true);
    expect(uploadRes.body.document).toBeDefined();
    expect(uploadRes.body.document.ownerId).toBe('valid-user-a');
    expect(uploadRes.body.document.storagePath).toMatch(/^valid-user-a\/doc_\d+_[a-f0-9]+\.pdf$/);

    docId = uploadRes.body.document.id;
    storagePath = uploadRes.body.document.storagePath;

    // Verify storage upload was called with correct scoped path and buffer
    expect(mockStorageUpload).toHaveBeenCalledWith(
      storagePath,
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'application/pdf', upsert: false })
    );

    // 2. User A lists documents - newly uploaded document is returned
    const listRes = await request(app)
      .get('/api/documents')
      .set('Authorization', userAToken);

    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    expect(listRes.body.documents).toHaveLength(1);
    expect(listRes.body.documents[0].id).toBe(docId);
    expect(listRes.body.documents[0].name).toBe('research_paper.pdf');
    expect(listRes.body.documents[0].ownerId).toBe('valid-user-a');

    // 3. User A retrieves single document metadata
    const getRes = await request(app)
      .get(`/api/documents/${docId}`)
      .set('Authorization', userAToken);

    expect(getRes.status).toBe(200);
    expect(getRes.body.document.id).toBe(docId);
    expect(getRes.body.document.storagePath).toBe(storagePath);

    // 4. User A requests a signed download URL
    const signedUrlRes = await request(app)
      .get(`/api/documents/${docId}/download-url`)
      .set('Authorization', userAToken);

    expect(signedUrlRes.status).toBe(200);
    expect(signedUrlRes.body.success).toBe(true);
    expect(signedUrlRes.body.downloadUrl).toContain(storagePath);
    expect(signedUrlRes.body.downloadUrl).toContain('signed_token_abc');
    expect(signedUrlRes.body.expiresInSeconds).toBe(900);

    // Verify service-role secret is never exposed in response
    const jsonStr = JSON.stringify(signedUrlRes.body);
    expect(jsonStr).not.toContain('supabase-service-role');
    expect(jsonStr).not.toContain('SERVICE_ROLE');

    // 5. User A deletes the document
    const deleteRes = await request(app)
      .delete(`/api/documents/${docId}`)
      .set('Authorization', userAToken);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    // Verify storage removal was triggered with correct path
    expect(mockStorageRemove).toHaveBeenCalledWith([storagePath]);

    // Verify subsequent retrieval returns 404
    const getAfterDelete = await request(app)
      .get(`/api/documents/${docId}`)
      .set('Authorization', userAToken);
    expect(getAfterDelete.status).toBe(404);

    // Verify signed URL request returns 404
    const signedAfterDelete = await request(app)
      .get(`/api/documents/${docId}/download-url`)
      .set('Authorization', userAToken);
    expect(signedAfterDelete.status).toBe(404);
  });

  it('strictly enforces cross-user security: User B cannot access User A document or signed URL', async () => {
    const userAToken = 'Bearer valid-user-a';
    const userBToken = 'Bearer valid-user-b';

    // User A uploads document
    const uploadRes = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', userAToken)
      .attach('file', validPdfHeader, 'confidential_a.pdf');

    expect(uploadRes.status).toBe(201);
    const docId = uploadRes.body.document.id;
    const storagePath = uploadRes.body.document.storagePath;

    // User B tries to view User A's document metadata -> 404
    const getResB = await request(app)
      .get(`/api/documents/${docId}`)
      .set('Authorization', userBToken);
    expect(getResB.status).toBe(404);

    // User B tries to get a signed URL for User A's document -> 404
    const signResB = await request(app)
      .get(`/api/documents/${docId}/download-url`)
      .set('Authorization', userBToken);
    expect(signResB.status).toBe(404);

    // User B tries to update User A's document -> 404
    const patchResB = await request(app)
      .patch(`/api/documents/${docId}`)
      .set('Authorization', userBToken)
      .send({ name: 'tampered.pdf' });
    expect(patchResB.status).toBe(404);

    // User B tries to delete User A's document -> 404
    const deleteResB = await request(app)
      .delete(`/api/documents/${docId}`)
      .set('Authorization', userBToken);
    expect(deleteResB.status).toBe(404);

    // Ensure mockStorageRemove was NOT called on behalf of User B
    expect(mockStorageRemove).not.toHaveBeenCalled();

    // Verify document still exists safely for User A
    const verifyDocA = await request(app)
      .get(`/api/documents/${docId}`)
      .set('Authorization', userAToken);
    expect(verifyDocA.status).toBe(200);
    expect(verifyDocA.body.document.storagePath).toBe(storagePath);
  });

  it('rejects guest users on all authenticated document cloud endpoints', async () => {
    const guestToken = 'Bearer guest_test_session';

    // Guest cannot upload to cloud storage
    const uploadGuest = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', guestToken)
      .attach('file', validPdfHeader, 'guest_doc.pdf');
    expect(uploadGuest.status).toBe(403);
    expect(uploadGuest.body.code).toBe('GUEST_NOT_ALLOWED');

    // Guest cannot list cloud documents
    const listGuest = await request(app)
      .get('/api/documents')
      .set('Authorization', guestToken);
    expect(listGuest.status).toBe(403);
    expect(listGuest.body.code).toBe('GUEST_NOT_ALLOWED');

    // Guest cannot request signed URLs
    const signGuest = await request(app)
      .get('/api/documents/doc_123/download-url')
      .set('Authorization', guestToken);
    expect(signGuest.status).toBe(403);
    expect(signGuest.body.code).toBe('GUEST_NOT_ALLOWED');

    // Guest cannot delete cloud documents
    const deleteGuest = await request(app)
      .delete('/api/documents/doc_123')
      .set('Authorization', guestToken);
    expect(deleteGuest.status).toBe(403);
    expect(deleteGuest.body.code).toBe('GUEST_NOT_ALLOWED');
  });

  it('rejects unauthenticated requests without valid Firebase token', async () => {
    const uploadUnauth = await request(app)
      .post('/api/documents/upload')
      .attach('file', validPdfHeader, 'test.pdf');
    expect(uploadUnauth.status).toBe(401);

    const listUnauth = await request(app).get('/api/documents');
    expect(listUnauth.status).toBe(401);

    const signUnauth = await request(app).get('/api/documents/doc_123/download-url');
    expect(signUnauth.status).toBe(401);

    const deleteUnauth = await request(app).delete('/api/documents/doc_123');
    expect(deleteUnauth.status).toBe(401);
  });
});
