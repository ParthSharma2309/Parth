import { Router, Request, Response } from 'express';
import { requireUser } from '../lib/authMiddleware.js';
import { getAdminFirestore } from '../lib/firebaseAdmin.js';
import {
  getSupabaseAdminClient,
  getSupabaseBucket,
  isSupabaseConfigured,
} from '../lib/supabaseAdmin.js';
import { rateLimit } from '../lib/rateLimit.js';
import { logger } from '../lib/logger.js';

export const documentsRouter = Router();

// Per-user rate limit for document management operations
const docLimiter = rateLimit({ windowMs: 60000, max: 120 });

// ID validation matching Firestore rules: 1-128 chars, alphanumeric, underscores, hyphens
const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]{1,128}$/;

// Server-controlled fields that clients are strictly forbidden from modifying
const FORBIDDEN_UPDATE_FIELDS = [
  'ownerId',
  'uid',
  'userId',
  'storageBucket',
  'storagePath',
  'size',
  'hash',
  'createdAt',
];

/**
 * Validates document ID format.
 */
function isValidDocumentId(id: string): boolean {
  return typeof id === 'string' && VALID_ID_REGEX.test(id);
}

/**
 * GET /api/documents
 * List document metadata records belonging to the authenticated user.
 */
documentsRouter.get(
  '/api/documents',
  requireUser,
  docLimiter,
  async (req: Request, res: Response) => {
    const requestId =
      (res.getHeader('X-Request-Id') as string) || (req.id ? String(req.id) : '');
    const uid = req.user!.uid!;

    const adminFirestore = getAdminFirestore();
    if (!adminFirestore) {
      return res.status(503).json({
        error: 'Database is not configured on this server.',
        code: 'DATABASE_NOT_CONFIGURED',
        requestId,
      });
    }

    try {
      const snapshot = await adminFirestore
        .collection(`users/${uid}/documents`)
        .orderBy('createdAt', 'desc')
        .get()
        .catch(async () => {
          // Fallback if composite index is not yet built
          return await adminFirestore!.collection(`users/${uid}/documents`).get();
        });

      const documents = snapshot.docs
        .map((doc) => {
          const data = doc.data();
          // Filter out any legacy record with conflicting ownerId
          if (data.ownerId && data.ownerId !== uid) {
            return null;
          }
          return {
            id: doc.id,
            ...data,
            ownerId: data.ownerId || uid,
          };
        })
        .filter(Boolean);

      return res.status(200).json({
        success: true,
        documents,
        total: documents.length,
        requestId,
      });
    } catch (err: any) {
      logger.error({ err: err.message, uid, requestId }, 'Failed to list user documents');
      return res.status(500).json({
        error: 'Failed to retrieve document metadata.',
        code: 'INTERNAL_ERROR',
        requestId,
      });
    }
  }
);

/**
 * GET /api/documents/:id
 * Retrieve a single document metadata record, strictly isolated to the authenticated user.
 */
documentsRouter.get(
  '/api/documents/:id',
  requireUser,
  docLimiter,
  async (req: Request, res: Response) => {
    const requestId =
      (res.getHeader('X-Request-Id') as string) || (req.id ? String(req.id) : '');
    const uid = req.user!.uid!;
    const docId = req.params.id;

    if (!isValidDocumentId(docId)) {
      return res.status(400).json({
        error: 'Invalid document ID format.',
        code: 'INVALID_ID',
        requestId,
      });
    }

    const adminFirestore = getAdminFirestore();
    if (!adminFirestore) {
      return res.status(503).json({
        error: 'Database is not configured on this server.',
        code: 'DATABASE_NOT_CONFIGURED',
        requestId,
      });
    }

    try {
      const docSnap = await adminFirestore.doc(`users/${uid}/documents/${docId}`).get();

      if (!docSnap.exists) {
        return res.status(404).json({
          error: 'Document not found.',
          code: 'NOT_FOUND',
          requestId,
        });
      }

      const data = docSnap.data()!;

      // Ownership guard: reject legacy records belonging to a different UID
      if (data.ownerId && data.ownerId !== uid) {
        return res.status(403).json({
          error: 'Access denied: you do not have permission to view this document.',
          code: 'FORBIDDEN',
          requestId,
        });
      }

      return res.status(200).json({
        success: true,
        document: {
          id: docSnap.id,
          ...data,
          ownerId: data.ownerId || uid,
        },
        requestId,
      });
    } catch (err: any) {
      logger.error({ err: err.message, docId, uid, requestId }, 'Failed to get document');
      return res.status(500).json({
        error: 'Failed to retrieve document.',
        code: 'INTERNAL_ERROR',
        requestId,
      });
    }
  }
);

/**
 * PATCH /api/documents/:id
 * Update editable metadata fields (e.g. name, collectionId, summary, topics, status).
 * Strictly forbids clients from altering server-managed fields.
 */
documentsRouter.patch(
  '/api/documents/:id',
  requireUser,
  docLimiter,
  async (req: Request, res: Response) => {
    const requestId =
      (res.getHeader('X-Request-Id') as string) || (req.id ? String(req.id) : '');
    const uid = req.user!.uid!;
    const docId = req.params.id;

    if (!isValidDocumentId(docId)) {
      return res.status(400).json({
        error: 'Invalid document ID format.',
        code: 'INVALID_ID',
        requestId,
      });
    }

    // Security Guard: Detect attempts to alter server-controlled fields
    const bodyKeys = Object.keys(req.body || {});
    const attemptedForbiddenFields = bodyKeys.filter((k) => FORBIDDEN_UPDATE_FIELDS.includes(k));
    if (attemptedForbiddenFields.length > 0) {
      return res.status(400).json({
        error: `Cannot modify server-controlled fields: ${attemptedForbiddenFields.join(', ')}.`,
        code: 'FORBIDDEN_FIELD_UPDATE',
        forbiddenFields: attemptedForbiddenFields,
        requestId,
      });
    }

    const adminFirestore = getAdminFirestore();
    if (!adminFirestore) {
      return res.status(503).json({
        error: 'Database is not configured on this server.',
        code: 'DATABASE_NOT_CONFIGURED',
        requestId,
      });
    }

    try {
      const docRef = adminFirestore.doc(`users/${uid}/documents/${docId}`);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return res.status(404).json({
          error: 'Document not found.',
          code: 'NOT_FOUND',
          requestId,
        });
      }

      const existingData = docSnap.data()!;
      if (existingData.ownerId && existingData.ownerId !== uid) {
        return res.status(403).json({
          error: 'Access denied: you do not have permission to modify this document.',
          code: 'FORBIDDEN',
          requestId,
        });
      }

      // Whitelist permitted update fields
      const updates: Record<string, any> = {
        updatedAt: new Date().toISOString(),
      };

      if (typeof req.body.name === 'string' && req.body.name.trim().length > 0) {
        updates.name = req.body.name.trim().slice(0, 255);
      }
      if (req.body.collectionId !== undefined) {
        updates.collectionId = req.body.collectionId ? String(req.body.collectionId).slice(0, 128) : null;
      }
      if (typeof req.body.summary === 'string') {
        updates.summary = req.body.summary.slice(0, 5000);
      }
      if (Array.isArray(req.body.topics)) {
        updates.topics = req.body.topics.slice(0, 50);
      }
      if (['indexing', 'ready', 'error'].includes(req.body.status)) {
        updates.status = req.body.status;
      }
      if (typeof req.body.pages === 'number' && req.body.pages >= 0) {
        updates.pages = Math.floor(req.body.pages);
      }

      await docRef.update(updates);

      return res.status(200).json({
        success: true,
        document: {
          id: docId,
          ...existingData,
          ...updates,
          ownerId: existingData.ownerId || uid,
        },
        requestId,
      });
    } catch (err: any) {
      logger.error({ err: err.message, docId, uid, requestId }, 'Failed to update document metadata');
      return res.status(500).json({
        error: 'Failed to update document metadata.',
        code: 'INTERNAL_ERROR',
        requestId,
      });
    }
  }
);

/**
 * DELETE /api/documents/:id
 * Delete document metadata from Firestore and delete the associated file from Supabase Storage.
 */
documentsRouter.delete(
  '/api/documents/:id',
  requireUser,
  docLimiter,
  async (req: Request, res: Response) => {
    const requestId =
      (res.getHeader('X-Request-Id') as string) || (req.id ? String(req.id) : '');
    const uid = req.user!.uid!;
    const docId = req.params.id;

    if (!isValidDocumentId(docId)) {
      return res.status(400).json({
        error: 'Invalid document ID format.',
        code: 'INVALID_ID',
        requestId,
      });
    }

    const adminFirestore = getAdminFirestore();
    if (!adminFirestore) {
      return res.status(503).json({
        error: 'Database is not configured on this server.',
        code: 'DATABASE_NOT_CONFIGURED',
        requestId,
      });
    }

    try {
      const docRef = adminFirestore.doc(`users/${uid}/documents/${docId}`);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return res.status(404).json({
          error: 'Document not found.',
          code: 'NOT_FOUND',
          requestId,
        });
      }

      const existingData = docSnap.data()!;
      if (existingData.ownerId && existingData.ownerId !== uid) {
        return res.status(404).json({
          error: 'Document not found.',
          code: 'NOT_FOUND',
          requestId,
        });
      }

      const storagePath: string | undefined = existingData.storagePath;
      let bucket = existingData.storageBucket || getSupabaseBucket();

      // Collect candidate paths strictly scoped to this user to guarantee clean storage state
      const pathsToDelete = new Set<string>();
      if (storagePath && (storagePath.startsWith(`${uid}/`) || storagePath.startsWith(`users/${uid}/`))) {
        pathsToDelete.add(storagePath);
      }
      pathsToDelete.add(`${uid}/${docId}.pdf`);
      const pathsArray = Array.from(pathsToDelete);

      if (isSupabaseConfigured()) {
        try {
          const supabase = getSupabaseAdminClient();
          // 1. Remove specific direct file paths
          const { data: removedDirect, error: removeErr } = await supabase.storage
            .from(bucket)
            .remove(pathsArray);

          if (removeErr) {
            logger.warn(
              { err: removeErr.message, pathsToDelete, bucket, requestId },
              'Supabase Storage direct file remove warning'
            );
          } else if (removedDirect && removedDirect.length > 0) {
            logger.info(
              { paths: removedDirect.map((r) => r.name), bucket, uid },
              'Removed file(s) from Supabase Storage on document deletion'
            );
          }

          // 2. Also check and clean up folder users/{uid}/{docId} if it exists
          const folderPrefix = `users/${uid}/${docId}`;
          if (typeof supabase.storage.from(bucket).list === 'function') {
            const { data: folderFiles } = await supabase.storage.from(bucket).list(folderPrefix);
            if (folderFiles && folderFiles.length > 0) {
              const folderPaths = folderFiles.map((f) => `${folderPrefix}/${f.name}`);
              const { error: folderErr } = await supabase.storage.from(bucket).remove(folderPaths);
              if (folderErr) {
                logger.warn({ err: folderErr.message, folderPaths }, 'Error removing folder files in Supabase');
              } else {
                logger.info({ folderPaths, bucket, uid }, 'Removed folder files from Supabase Storage');
              }
            }
          }
        } catch (storageErr: any) {
          logger.warn(
            { err: storageErr.message, docId, uid },
            'Failed during Supabase storage object cleanup'
          );
        }
      }

      // Delete document record from Firestore if present
      if (docSnap.exists) {
        await docRef.delete();
      }

      // Delete associated chunks from users/${uid}/chunks in batches of <= 400
      try {
        const chunksSnap = await adminFirestore
          .collection(`users/${uid}/chunks`)
          .where('documentId', '==', docId)
          .get();
        if (!chunksSnap.empty) {
          const batchSize = 400;
          for (let i = 0; i < chunksSnap.docs.length; i += batchSize) {
            const batch = adminFirestore.batch();
            const chunkSlice = chunksSnap.docs.slice(i, i + batchSize);
            chunkSlice.forEach((d) => batch.delete(d.ref));
            await batch.commit();
          }
          logger.info({ docId, uid, chunkCount: chunksSnap.size }, 'Removed document chunks from Firestore');
        }
      } catch (chunkDelErr: any) {
        logger.warn({ err: chunkDelErr.message, docId, uid }, 'Warning deleting chunks for document');
      }

      logger.info({ docId, uid, requestId }, 'Document deleted successfully');

      return res.status(200).json({
        success: true,
        message: 'Document, storage object, and chunks deleted successfully.',
        requestId,
      });
    } catch (err: any) {
      logger.error({ err: err.message, docId, uid, requestId }, 'Failed to delete document');
      return res.status(500).json({
        error: 'Failed to delete document.',
        code: 'INTERNAL_ERROR',
        requestId,
      });
    }
  }
);

/**
 * GET /api/documents/:id/download-url
 * Generate a short-lived signed URL for authenticated document file retrieval.
 */
documentsRouter.get(
  '/api/documents/:id/download-url',
  requireUser,
  docLimiter,
  async (req: Request, res: Response) => {
    const requestId =
      (res.getHeader('X-Request-Id') as string) || (req.id ? String(req.id) : '');
    const uid = req.user!.uid!;
    const docId = req.params.id;

    if (!isValidDocumentId(docId)) {
      return res.status(400).json({
        error: 'Invalid document ID format.',
        code: 'INVALID_ID',
        requestId,
      });
    }

    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        error: 'Supabase Storage is not configured on this server.',
        code: 'STORAGE_NOT_CONFIGURED',
        requestId,
      });
    }

    const adminFirestore = getAdminFirestore();
    if (!adminFirestore) {
      return res.status(503).json({
        error: 'Database is not configured on this server.',
        code: 'DATABASE_NOT_CONFIGURED',
        requestId,
      });
    }

    try {
      const docSnap = await adminFirestore.doc(`users/${uid}/documents/${docId}`).get();

      if (!docSnap.exists) {
        return res.status(404).json({
          error: 'Document not found.',
          code: 'NOT_FOUND',
          requestId,
        });
      }

      const data = docSnap.data()!;
      if (data.ownerId && data.ownerId !== uid) {
        return res.status(403).json({
          error: 'Access denied.',
          code: 'FORBIDDEN',
          requestId,
        });
      }

      const storagePath = data.storagePath;
      if (!storagePath || typeof storagePath !== 'string') {
        return res.status(404).json({
          error: 'No storage file associated with this document.',
          code: 'NO_STORAGE_FILE',
          requestId,
        });
      }

      // Security check: ensure storagePath belongs strictly to this user
      if (
        !storagePath.startsWith(`${uid}/`) &&
        !storagePath.startsWith(`users/${uid}/`)
      ) {
        return res.status(403).json({
          error: 'Access denied to storage path.',
          code: 'FORBIDDEN',
          requestId,
        });
      }

      const supabase = getSupabaseAdminClient();
      const bucket = data.storageBucket || getSupabaseBucket();
      // Signed URL expires in 15 minutes (900 seconds)
      const { data: signData, error: signErr } = await supabase.storage
        .from(bucket)
        .createSignedUrl(storagePath, 900);

      if (signErr || !signData?.signedUrl) {
        return res.status(500).json({
          error: 'Failed to generate signed download URL.',
          code: 'SIGN_URL_FAILED',
          requestId,
        });
      }

      return res.status(200).json({
        success: true,
        downloadUrl: signData.signedUrl,
        expiresInSeconds: 900,
        requestId,
      });
    } catch (err: any) {
      logger.error({ err: err.message, docId, uid, requestId }, 'Failed to generate download URL');
      return res.status(500).json({
        error: 'Failed to generate download URL.',
        code: 'INTERNAL_ERROR',
        requestId,
      });
    }
  }
);

/**
 * GET /api/documents/:id/chunks
 * Retrieves all indexed text chunks and embeddings for a document owned by the authenticated user.
 * Enables cross-device AI retrieval and verified citations without re-parsing PDF bytes.
 */
documentsRouter.get(
  '/api/documents/:id/chunks',
  requireUser,
  docLimiter,
  async (req: Request, res: Response) => {
    const requestId =
      (res.getHeader('X-Request-Id') as string) || (req.id ? String(req.id) : '');
    const uid = req.user!.uid!;
    const docId = req.params.id;

    if (!isValidDocumentId(docId)) {
      return res.status(400).json({
        error: 'Invalid document ID format.',
        code: 'INVALID_ID',
        requestId,
      });
    }

    const adminFirestore = getAdminFirestore();
    if (!adminFirestore) {
      return res.status(503).json({
        error: 'Database is not configured on this server.',
        code: 'DATABASE_NOT_CONFIGURED',
        requestId,
      });
    }

    try {
      // 1. Ownership & existence guard: verify document exists in user's partition
      const docSnap = await adminFirestore.doc(`users/${uid}/documents/${docId}`).get();
      if (!docSnap.exists) {
        return res.status(404).json({
          error: 'Document not found.',
          code: 'NOT_FOUND',
          requestId,
        });
      }

      const docData = docSnap.data()!;
      if (docData.ownerId && docData.ownerId !== uid) {
        return res.status(403).json({
          error: 'Access denied.',
          code: 'FORBIDDEN',
          requestId,
        });
      }

      // 2. Query all chunks for this document in users/{uid}/chunks
      const chunksSnap = await adminFirestore
        .collection(`users/${uid}/chunks`)
        .where('documentId', '==', docId)
        .get();

      const chunks = chunksSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          documentId: data.documentId || docId,
          documentName: data.documentName || docData.name || '',
          pageNumber: typeof data.page === 'number' ? data.page : (typeof data.pageNumber === 'number' ? data.pageNumber : 1),
          chunkIndex: typeof data.chunkIndex === 'number' ? data.chunkIndex : 0,
          text: data.text || '',
          model: data.model || 'gemini-embedding-2-preview',
          dim: typeof data.dim === 'number' ? data.dim : (Array.isArray(data.embedding) ? data.embedding.length : 0),
          embedding: Array.isArray(data.embedding) ? data.embedding : [],
          charStart: typeof data.charStart === 'number' ? data.charStart : 0,
          charEnd: typeof data.charEnd === 'number' ? data.charEnd : (data.text?.length || 0),
        };
      });

      // Sort consistently by page number, then chunk index
      chunks.sort((a, b) => a.pageNumber - b.pageNumber || a.chunkIndex - b.chunkIndex);

      return res.status(200).json({
        success: true,
        docId,
        chunks,
        count: chunks.length,
        requestId,
      });
    } catch (err: any) {
      logger.error({ err: err.message, docId, uid, requestId }, 'Failed to retrieve document chunks');
      return res.status(500).json({
        error: 'Failed to retrieve document chunks.',
        code: 'INTERNAL_ERROR',
        requestId,
      });
    }
  }
);

/**
 * POST /api/documents/:id/chunks
 * Persists indexed text chunks and vector embeddings for a document in Firestore.
 * Supports cross-device synchronization and fast-path restoration.
 */
documentsRouter.post(
  '/api/documents/:id/chunks',
  requireUser,
  docLimiter,
  async (req: Request, res: Response) => {
    const requestId =
      (res.getHeader('X-Request-Id') as string) || (req.id ? String(req.id) : '');
    const uid = req.user!.uid!;
    const docId = req.params.id;

    if (!isValidDocumentId(docId)) {
      return res.status(400).json({
        error: 'Invalid document ID format.',
        code: 'INVALID_ID',
        requestId,
      });
    }

    const adminFirestore = getAdminFirestore();
    if (!adminFirestore) {
      return res.status(503).json({
        error: 'Database is not configured on this server.',
        code: 'DATABASE_NOT_CONFIGURED',
        requestId,
      });
    }

    const { chunks } = req.body;
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return res.status(400).json({
        error: 'Invalid request: "chunks" must be a non-empty array.',
        code: 'INVALID_CHUNKS',
        requestId,
      });
    }

    if (chunks.length > 2000) {
      return res.status(413).json({
        error: 'Maximum 2000 chunks per upload exceeded.',
        code: 'TOO_MANY_CHUNKS',
        requestId,
      });
    }

    try {
      // 1. Ownership & existence guard: verify document exists in user's partition
      const docRef = adminFirestore.doc(`users/${uid}/documents/${docId}`);
      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        return res.status(404).json({
          error: 'Document not found.',
          code: 'NOT_FOUND',
          requestId,
        });
      }

      const docData = docSnap.data()!;
      if (docData.ownerId && docData.ownerId !== uid) {
        return res.status(403).json({
          error: 'Access denied.',
          code: 'FORBIDDEN',
          requestId,
        });
      }

      // 2. Persist chunks in Firestore batches (max 450 items per write batch)
      const batchSize = 450;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = adminFirestore.batch();
        const slice = chunks.slice(i, i + batchSize);

        for (const chunk of slice) {
          const chunkId = chunk.id && isValidDocumentId(chunk.id)
            ? chunk.id
            : `chunk_${docId}_${chunk.pageNumber || chunk.page || 1}_${chunk.chunkIndex || 0}_${Math.random().toString(36).slice(2, 6)}`;
          const chunkRef = adminFirestore.doc(`users/${uid}/chunks/${chunkId}`);

          const embedding = Array.isArray(chunk.embedding)
            ? chunk.embedding
            : (chunk.embedding && typeof chunk.embedding === 'object' ? Array.from(chunk.embedding) : []);

          batch.set(
            chunkRef,
            {
              documentId: docId,
              documentName: chunk.documentName || docData.name || '',
              page: typeof chunk.pageNumber === 'number' ? chunk.pageNumber : (chunk.page || 1),
              chunkIndex: typeof chunk.chunkIndex === 'number' ? chunk.chunkIndex : 0,
              text: String(chunk.text || '').slice(0, 10000),
              model: String(chunk.model || 'gemini-embedding-2-preview').slice(0, 128),
              dim: typeof chunk.dim === 'number' ? chunk.dim : embedding.length,
              embedding,
              charStart: typeof chunk.charStart === 'number' ? chunk.charStart : 0,
              charEnd: typeof chunk.charEnd === 'number' ? chunk.charEnd : 0,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        }
        await batch.commit();
      }

      // 3. Mark document status ready if it was indexing
      await docRef.set(
        {
          status: 'ready',
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      logger.info({ docId, uid, chunkCount: chunks.length, requestId }, 'Document chunks persisted successfully');

      return res.status(200).json({
        success: true,
        docId,
        count: chunks.length,
        requestId,
      });
    } catch (err: any) {
      logger.error({ err: err.message, docId, uid, requestId }, 'Failed to persist document chunks');
      return res.status(500).json({
        error: 'Failed to persist document chunks.',
        code: 'INTERNAL_ERROR',
        requestId,
      });
    }
  }
);

