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

vi.mock('../../server/lib/supabaseAdmin.js', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseBucket: vi.fn(() => 'documents'),
  getSupabaseAdminClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: mockStorageUpload,
        remove: mockStorageRemove,
      })),
    },
  })),
  resetSupabaseAdminClient: vi.fn(),
  StorageNotConfiguredError: class StorageNotConfiguredError extends Error {},
}));

import { app } from '../../server/index.js';
import {
  setAdminFirestoreForTesting,
} from '../../server/lib/firebaseAdmin.js';
import { isSupabaseConfigured } from '../../server/lib/supabaseAdmin.js';
import { MAX_FILE_SIZE_BYTES } from '../../server/routes/upload.js';

describe('Secure Document Uploads to Supabase Storage (tests/integration/upload.test.ts)', () => {
  const validPdfHeader = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
  let mockFirestoreSet: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (isSupabaseConfigured as any).mockReturnValue(true);

    mockStorageUpload.mockResolvedValue({
      data: { path: 'documents/mock.pdf' },
      error: null,
    });
    mockStorageRemove.mockResolvedValue({
      data: [{ name: 'mock.pdf' }],
      error: null,
    });

    mockFirestoreSet = vi.fn().mockResolvedValue({ writeTime: 'mock-time' });
    setAdminFirestoreForTesting({
      doc: vi.fn(() => ({
        set: mockFirestoreSet,
      })),
    } as any);
  });

  // 1. Valid authenticated PDF upload
  it('1. successfully uploads valid PDF for authenticated user to Supabase Storage and records metadata', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', 'Bearer valid-user-a')
      .field('collectionId', 'col_quantum_computing')
      .attach('file', validPdfHeader, 'quantum_algorithms.pdf');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.document).toBeDefined();

    const doc = res.body.document;
    expect(doc.id).toMatch(/^doc_\d+_[a-f0-9]+$/);
    expect(doc.name).toBe('quantum_algorithms.pdf');
    expect(doc.size).toBe(validPdfHeader.length);
    expect(doc.status).toBe('indexing');
    expect(doc.collectionId).toBe('col_quantum_computing');

    // Storage path scoped to authenticated UID: valid-user-a/<docId>.pdf
    expect(doc.storagePath).toBe(`valid-user-a/${doc.id}.pdf`);

    // Verify Supabase upload was invoked with correct arguments
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
    const [calledPath, calledBuffer, calledOpts] = mockStorageUpload.mock.calls[0];
    expect(calledPath).toBe(`valid-user-a/${doc.id}.pdf`);
    expect(Buffer.isBuffer(calledBuffer)).toBe(true);
    expect(calledOpts.contentType).toBe('application/pdf');

    // Verify Firestore metadata was persisted
    expect(mockFirestoreSet).toHaveBeenCalledTimes(1);
    const firestoreData = mockFirestoreSet.mock.calls[0][0];
    expect(firestoreData.name).toBe('quantum_algorithms.pdf');
    expect(firestoreData.storagePath).toBe(`valid-user-a/${doc.id}.pdf`);
    expect(firestoreData.status).toBe('indexing');
  });

  // 2. Unauthenticated upload (missing or invalid token)
  it('2. rejects unauthenticated uploads with 401 UNAUTHORIZED', async () => {
    // Missing Authorization header
    const missingRes = await request(app)
      .post('/api/documents/upload')
      .attach('file', validPdfHeader, 'test.pdf');

    expect(missingRes.status).toBe(401);
    expect(missingRes.body.code).toBe('UNAUTHORIZED');

    // Invalid token
    const invalidRes = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', 'Bearer invalid-token-123')
      .attach('file', validPdfHeader, 'test.pdf');

    expect(invalidRes.status).toBe(401);
    expect(invalidRes.body.code).toBe('UNAUTHORIZED');
  });

  // 3. Guest upload attempt is rejected (requires registered user account)
  it('3. rejects guest session uploads with 403 GUEST_NOT_ALLOWED', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', 'Bearer guest_researcher_456')
      .attach('file', validPdfHeader, 'guest_paper.pdf');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('GUEST_NOT_ALLOWED');
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  // 4. Invalid file extension (.txt or .docx when only .pdf is supported)
  it('4. rejects non-PDF file extensions with 400 INVALID_FILE_TYPE', async () => {
    const textBuffer = Buffer.from('Plain text file content');
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', 'Bearer valid-user-a')
      .attach('file', textBuffer, 'notes.txt');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FILE_TYPE');
    expect(res.body.error).toContain('Only PDF documents (.pdf) are supported');
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  // 5. Invalid magic bytes (.pdf extension but not starting with %PDF)
  it('5. rejects files with .pdf extension that lack %PDF magic bytes with 400 INVALID_FILE_TYPE', async () => {
    const fakePdfBuffer = Buffer.from('NOT_A_REAL_PDF_HEADER_JUST_TEXT');
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', 'Bearer valid-user-a')
      .attach('file', fakePdfBuffer, 'fake.pdf');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FILE_TYPE');
    expect(res.body.error).toContain('valid %PDF header');
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  // 6. File exceeding size limit (> 50MB)
  it('6. rejects uploads exceeding configured 50MB limit with 413 FILE_TOO_LARGE', async () => {
    // 50MB + 1024 bytes buffer
    const largeBuffer = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1024);
    // Write %PDF header at beginning
    largeBuffer.write('%PDF-1.4');

    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', 'Bearer valid-user-a')
      .attach('file', largeBuffer, 'massive_book.pdf');

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('FILE_TOO_LARGE');
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  // 7. Supabase storage upload failure
  it('7. returns 500 when Supabase Storage upload fails and prevents metadata save', async () => {
    mockStorageUpload.mockResolvedValueOnce({
      data: null,
      error: { message: 'Storage bucket quota exceeded' },
    });

    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', 'Bearer valid-user-a')
      .attach('file', validPdfHeader, 'failing_upload.pdf');

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('STORAGE_UPLOAD_FAILED');
    expect(res.body.error).toContain('Storage bucket quota exceeded');
    expect(mockFirestoreSet).not.toHaveBeenCalled();
  });

  // 8. Metadata persistence failure triggers safe rollback / cleanup of uploaded storage file
  it('8. triggers safe rollback (removes uploaded Supabase file) if metadata save fails', async () => {
    mockFirestoreSet.mockRejectedValueOnce(
      new Error('Firestore write stream aborted: network timeout')
    );

    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', 'Bearer valid-user-a')
      .attach('file', validPdfHeader, 'rollback_test.pdf');

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('METADATA_SAVE_FAILED');
    expect(res.body.error).toContain('Storage upload was rolled back');

    // Supabase file was uploaded first...
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
    const uploadedPath = mockStorageUpload.mock.calls[0][0];

    // ...and then rolled back via remove([uploadedPath])
    expect(mockStorageRemove).toHaveBeenCalledTimes(1);
    expect(mockStorageRemove).toHaveBeenCalledWith([uploadedPath]);
  });

  // 9. Client-supplied UID or storagePath tampering is completely ignored
  it('9. ignores client-supplied uid or storagePath tampering and enforces authenticated UID', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', 'Bearer valid-user-a')
      .field('uid', 'victim-user-123')
      .field('userId', 'victim-user-123')
      .field('storagePath', 'victim-user-123/malicious.pdf')
      .attach('file', validPdfHeader, 'spoofed_paper.pdf');

    expect(res.status).toBe(201);
    const doc = res.body.document;

    // Must be scoped strictly to verified authenticated user 'valid-user-a', NEVER 'victim-user-123'
    expect(doc.storagePath).toMatch(/^valid-user-a\/doc_/);
    expect(doc.storagePath).not.toContain('victim-user-123');

    const calledPath = mockStorageUpload.mock.calls[0][0];
    expect(calledPath).toMatch(/^valid-user-a\/doc_/);
    expect(calledPath).not.toContain('victim-user-123');
  });

  // 10. Missing Supabase configuration returns 503 STORAGE_NOT_CONFIGURED
  it('10. returns 503 STORAGE_NOT_CONFIGURED when Supabase is not configured', async () => {
    (isSupabaseConfigured as any).mockReturnValueOnce(false);

    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', 'Bearer valid-user-a')
      .attach('file', validPdfHeader, 'unconfigured.pdf');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('STORAGE_NOT_CONFIGURED');
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });
});
