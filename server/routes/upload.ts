import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { requireUser } from '../lib/authMiddleware.js';
import {
  getSupabaseAdminClient,
  getSupabaseBucket,
  isSupabaseConfigured,
} from '../lib/supabaseAdmin.js';
import { getAdminFirestore } from '../lib/firebaseAdmin.js';
import { rateLimit } from '../lib/rateLimit.js';
import { logger } from '../lib/logger.js';

export const uploadRouter = Router();

// Per-user rate limit for uploads: 30 uploads / minute
const uploadLimiter = rateLimit({ windowMs: 60000, max: 30 });

// 50MB maximum file size limit
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 52,428,800 bytes
export const FIRESTORE_MAX_BYTES = 50000000;

// In-memory multer storage to avoid writing unverified files to server disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
  },
}).single('file');

/**
 * Validates that the buffer begins with the standard %PDF magic byte header.
 */
export function hasPdfMagicBytes(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 4) return false;
  return buffer.subarray(0, 4).toString('ascii') === '%PDF';
}

/**
 * Sanitizes original filename: strips path traversals, null bytes, control chars.
 * Max length: 255 chars.
 */
export function sanitizeFilename(originalName?: string): string {
  if (!originalName || typeof originalName !== 'string') {
    return 'document.pdf';
  }
  const base = path.basename(originalName);
  const sanitized = base
    .replace(/[^a-zA-Z0-9._\-\s()]/g, '_')
    .trim()
    .slice(0, 255);
  return sanitized || 'document.pdf';
}

uploadRouter.post(
  '/api/documents/upload',
  requireUser,
  uploadLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    const requestId =
      (res.getHeader('X-Request-Id') as string) || (req.id ? String(req.id) : '');

    upload(req, res, async (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
              error: 'File exceeds the maximum allowed size of 50MB.',
              code: 'FILE_TOO_LARGE',
              requestId,
            });
          }
          return res.status(400).json({
            error: `File upload error: ${err.message}`,
            code: 'UPLOAD_ERROR',
            requestId,
          });
        }
        return res.status(400).json({
          error: (err as Error).message || 'File upload failed.',
          code: 'UPLOAD_ERROR',
          requestId,
        });
      }

      try {
        // 1. Verify file presence
        if (!req.file || !req.file.buffer) {
          return res.status(400).json({
            error: 'No file uploaded. Expected a multipart form field named "file".',
            code: 'NO_FILE',
            requestId,
          });
        }

        const file = req.file;

        // 2. Validate file extension
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.pdf') {
          return res.status(400).json({
            error: 'Invalid file type. Only PDF documents (.pdf) are supported.',
            code: 'INVALID_FILE_TYPE',
            requestId,
          });
        }

        // 3. Validate file magic bytes (%PDF)
        if (!hasPdfMagicBytes(file.buffer)) {
          return res.status(400).json({
            error: 'Invalid file format: file content does not have a valid %PDF header.',
            code: 'INVALID_FILE_TYPE',
            requestId,
          });
        }

        // 4. Validate size against strict Firestore schema limit (50,000,000 bytes)
        if (file.size > FIRESTORE_MAX_BYTES) {
          return res.status(413).json({
            error: 'File size exceeds maximum allowed limit of 50,000,000 bytes (50MB).',
            code: 'FILE_TOO_LARGE',
            requestId,
          });
        }

        // 5. Verify Supabase Storage configuration
        if (!isSupabaseConfigured()) {
          return res.status(503).json({
            error: 'Supabase Storage is not configured on this server.',
            code: 'STORAGE_NOT_CONFIGURED',
            requestId,
          });
        }

        // 6. Generate server-authoritative document ID and user-scoped storage path
        // CRITICAL: UID comes EXCLUSIVELY from verified auth token. Never trust client body/headers.
        const user = req.user!;
        const uid = user.uid!;
        const docId = `doc_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
        const storagePath = `${uid}/${docId}.pdf`;
        const bucket = getSupabaseBucket();
        const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
        const sanitizedName = sanitizeFilename(file.originalname);

        // 7. Upload actual PDF buffer to private Supabase Storage bucket
        const supabase = getSupabaseAdminClient();
        const { error: storageErr } = await supabase.storage
          .from(bucket)
          .upload(storagePath, file.buffer, {
            contentType: 'application/pdf',
            upsert: false,
          });

        if (storageErr) {
          logger.error(
            { err: storageErr.message, storagePath, bucket, requestId },
            'Supabase Storage upload failed'
          );
          return res.status(500).json({
            error: `Storage upload failed: ${storageErr.message}`,
            code: 'STORAGE_UPLOAD_FAILED',
            requestId,
          });
        }

        // 8. Prepare metadata record conforming to Firestore rules schema
        const nowIso = new Date().toISOString();
        const docRecord = {
          id: docId,
          name: sanitizedName,
          pages: 0,
          size: file.size,
          status: 'indexing' as const,
          createdAt: nowIso,
          updatedAt: nowIso,
          hash: fileHash,
          storagePath,
          ownerId: uid,
          collectionId: req.body?.collectionId ? String(req.body.collectionId).slice(0, 128) : undefined,
        };

        // 9. Persist metadata to Firestore via Firebase Admin if configured
        const adminFirestore = getAdminFirestore();
        if (adminFirestore) {
          try {
            await adminFirestore.doc(`users/${uid}/documents/${docId}`).set({
              name: docRecord.name,
              pages: docRecord.pages,
              size: docRecord.size,
              status: docRecord.status,
              createdAt: docRecord.createdAt,
              updatedAt: docRecord.updatedAt,
              hash: docRecord.hash,
              storagePath: docRecord.storagePath,
              ownerId: uid,
              ...(docRecord.collectionId ? { collectionId: docRecord.collectionId } : {}),
            });
          } catch (metaErr: any) {
            logger.error(
              { err: metaErr.message, docId, storagePath, requestId },
              'Failed to persist document metadata in Firestore; rolling back uploaded storage file'
            );

            // Rollback: delete orphaned storage object from Supabase bucket
            try {
              await supabase.storage.from(bucket).remove([storagePath]);
              logger.info(
                { storagePath, bucket },
                'Successfully cleaned up orphaned storage file after metadata failure'
              );
            } catch (cleanupErr) {
              logger.error(
                { cleanupErr, storagePath, bucket },
                'Failed to clean up orphaned storage file during rollback'
              );
            }

            return res.status(500).json({
              error: 'Failed to persist document metadata. Storage upload was rolled back.',
              code: 'METADATA_SAVE_FAILED',
              requestId,
            });
          }
        }

        logger.info(
          { docId, storagePath, size: file.size, uid, requestId },
          'Document uploaded and registered successfully'
        );

        return res.status(201).json({
          success: true,
          document: docRecord,
          requestId,
        });
      } catch (unhandledErr: any) {
        logger.error({ err: unhandledErr.message, requestId }, 'Unhandled upload error');
        return res.status(500).json({
          error: 'An unexpected error occurred during document upload.',
          code: 'INTERNAL_ERROR',
          requestId,
        });
      }
    });
  }
);
