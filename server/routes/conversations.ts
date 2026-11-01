import { Router, Request, Response } from 'express';
import { requireUser } from '../lib/authMiddleware.js';
import { getAdminFirestore } from '../lib/firebaseAdmin.js';
import { rateLimit } from '../lib/rateLimit.js';
import { logger } from '../lib/logger.js';

export const conversationsRouter = Router();

// Per-user rate limit for conversation operations: 120 / min
const convLimiter = rateLimit({ windowMs: 60000, max: 120 });

// ID validation matching Firestore rules: 1-128 chars, alphanumeric, underscores, hyphens
const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]{1,128}$/;

function isValidId(id: string): boolean {
  return typeof id === 'string' && VALID_ID_REGEX.test(id);
}

/**
 * GET /api/conversations
 * List all conversations belonging to the authenticated user.
 */
conversationsRouter.get(
  '/api/conversations',
  requireUser,
  convLimiter,
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
        .collection(`users/${uid}/conversations`)
        .orderBy('updatedAt', 'desc')
        .get()
        .catch(async () => {
          // Fallback if index not yet generated
          return await adminFirestore!.collection(`users/${uid}/conversations`).get();
        });

      const conversations = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          title: data.title || 'Untitled Inquiry',
          scope: data.scope || { type: 'all' },
          pinned: Boolean(data.pinned),
          createdAt: typeof data.createdAt === 'string' ? new Date(data.createdAt).getTime() : (data.createdAt || Date.now()),
          updatedAt: typeof data.updatedAt === 'string' ? new Date(data.updatedAt).getTime() : (data.updatedAt || Date.now()),
          userId: uid,
          ownerId: uid,
        };
      });

      // Sort in memory by updatedAt descending
      conversations.sort((a, b) => b.updatedAt - a.updatedAt);

      return res.status(200).json({
        success: true,
        conversations,
        total: conversations.length,
        requestId,
      });
    } catch (err: any) {
      logger.error({ err: err.message, uid, requestId }, 'Failed to list user conversations');
      return res.status(500).json({
        error: 'Failed to retrieve conversation history.',
        code: 'INTERNAL_ERROR',
        requestId,
      });
    }
  }
);

/**
 * POST /api/conversations
 * Create or update a conversation record.
 */
conversationsRouter.post(
  '/api/conversations',
  requireUser,
  convLimiter,
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

    const { id, title, scope, pinned, createdAt, updatedAt } = req.body;
    const convId = id && isValidId(id) ? id : `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    if (!isValidId(convId)) {
      return res.status(400).json({
        error: 'Invalid conversation ID format.',
        code: 'INVALID_ID',
        requestId,
      });
    }

    const cleanTitle = typeof title === 'string' && title.trim() ? title.trim().slice(0, 255) : 'New Research Inquiry';
    const nowIso = new Date().toISOString();
    const createdIso = createdAt ? new Date(createdAt).toISOString() : nowIso;
    const updatedIso = updatedAt ? new Date(updatedAt).toISOString() : nowIso;

    try {
      const convRef = adminFirestore.doc(`users/${uid}/conversations/${convId}`);
      const existingSnap = await convRef.get();

      const convData = {
        title: cleanTitle,
        scope: typeof scope === 'object' && scope !== null ? scope : { type: 'all' },
        pinned: Boolean(pinned),
        createdAt: existingSnap.exists ? existingSnap.data()?.createdAt || createdIso : createdIso,
        updatedAt: updatedIso,
        ownerId: uid,
      };

      await convRef.set(convData, { merge: true });

      return res.status(200).json({
        success: true,
        conversation: {
          id: convId,
          ...convData,
          createdAt: new Date(convData.createdAt).getTime(),
          updatedAt: new Date(convData.updatedAt).getTime(),
          userId: uid,
        },
        requestId,
      });
    } catch (err: any) {
      logger.error({ err: err.message, convId, uid, requestId }, 'Failed to save conversation');
      return res.status(500).json({
        error: 'Failed to persist conversation.',
        code: 'INTERNAL_ERROR',
        requestId,
      });
    }
  }
);

/**
 * DELETE /api/conversations/:id
 * Delete a conversation and all its messages.
 */
conversationsRouter.delete(
  '/api/conversations/:id',
  requireUser,
  convLimiter,
  async (req: Request, res: Response) => {
    const requestId =
      (res.getHeader('X-Request-Id') as string) || (req.id ? String(req.id) : '');
    const uid = req.user!.uid!;
    const convId = req.params.id;

    if (!isValidId(convId)) {
      return res.status(400).json({
        error: 'Invalid conversation ID format.',
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
      const convRef = adminFirestore.doc(`users/${uid}/conversations/${convId}`);
      const convSnap = await convRef.get();
      if (!convSnap.exists) {
        return res.status(200).json({ success: true, message: 'Already deleted or absent', requestId });
      }

      // Delete subcollection messages in batch
      const messagesSnap = await convRef.collection('messages').get();
      const batchSize = 450;
      for (let i = 0; i < messagesSnap.docs.length; i += batchSize) {
        const batch = adminFirestore.batch();
        const slice = messagesSnap.docs.slice(i, i + batchSize);
        for (const doc of slice) {
          batch.delete(doc.ref);
        }
        await batch.commit();
      }

      // Delete the conversation document
      await convRef.delete();

      return res.status(200).json({
        success: true,
        deletedId: convId,
        requestId,
      });
    } catch (err: any) {
      logger.error({ err: err.message, convId, uid, requestId }, 'Failed to delete conversation');
      return res.status(500).json({
        error: 'Failed to delete conversation.',
        code: 'INTERNAL_ERROR',
        requestId,
      });
    }
  }
);

/**
 * GET /api/conversations/:id/messages
 * Retrieve messages for a conversation, ordered chronologically.
 */
conversationsRouter.get(
  '/api/conversations/:id/messages',
  requireUser,
  convLimiter,
  async (req: Request, res: Response) => {
    const requestId =
      (res.getHeader('X-Request-Id') as string) || (req.id ? String(req.id) : '');
    const uid = req.user!.uid!;
    const convId = req.params.id;

    if (!isValidId(convId)) {
      return res.status(400).json({
        error: 'Invalid conversation ID format.',
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
      const convRef = adminFirestore.doc(`users/${uid}/conversations/${convId}`);
      const convSnap = await convRef.get();
      if (!convSnap.exists) {
        return res.status(404).json({
          error: 'Conversation not found.',
          code: 'NOT_FOUND',
          requestId,
        });
      }

      const msgsSnap = await convRef
        .collection('messages')
        .orderBy('createdAt', 'asc')
        .get()
        .catch(async () => {
          return await convRef.collection('messages').get();
        });

      const messages = msgsSnap.docs.map((d) => {
        const data = d.data();
        const createdAtNum = typeof data.createdAt === 'string'
          ? new Date(data.createdAt).getTime()
          : (data.createdAt || Date.now());

        let msgStatus: 'answered' | 'insufficient_evidence' | 'no_relevant_passages' | 'error' = 'answered';
        if (data.status) {
          msgStatus = data.status;
        } else if (
          (data.content && data.content.includes("couldn't find sufficient evidence")) ||
          (data.content && data.content.toLowerCase().startsWith('no relevant evidence'))
        ) {
          msgStatus = 'insufficient_evidence';
        }

        return {
          id: d.id,
          conversationId: convId,
          role: data.role || 'user',
          content: data.content || '',
          citations: Array.isArray(data.citations) ? data.citations : [],
          latencyMs: data.timings?.total || data.latencyMs || undefined,
          modelUsed: data.model || 'gemini-3.8-flash',
          status: msgStatus,
          createdAt: createdAtNum,
          retrievalScope: convSnap.data()?.scope,
        };
      });

      // Sort in memory by createdAt ascending
      messages.sort((a, b) => a.createdAt - b.createdAt);

      return res.status(200).json({
        success: true,
        conversationId: convId,
        messages,
        total: messages.length,
        requestId,
      });
    } catch (err: any) {
      logger.error({ err: err.message, convId, uid, requestId }, 'Failed to retrieve conversation messages');
      return res.status(500).json({
        error: 'Failed to retrieve conversation messages.',
        code: 'INTERNAL_ERROR',
        requestId,
      });
    }
  }
);

/**
 * POST /api/conversations/:id/messages
 * Persist a message in a conversation.
 */
conversationsRouter.post(
  '/api/conversations/:id/messages',
  requireUser,
  convLimiter,
  async (req: Request, res: Response) => {
    const requestId =
      (res.getHeader('X-Request-Id') as string) || (req.id ? String(req.id) : '');
    const uid = req.user!.uid!;
    const convId = req.params.id;

    if (!isValidId(convId)) {
      return res.status(400).json({
        error: 'Invalid conversation ID format.',
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

    const { id, role, content, citations, latencyMs, modelUsed, createdAt, status } = req.body;
    const msgId = id && isValidId(id) ? id : `msg_${role || 'user'}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({
        error: 'Message content is required.',
        code: 'INVALID_CONTENT',
        requestId,
      });
    }

    const cleanRole = role === 'assistant' || role === 'system' ? role : 'user';
    const nowIso = new Date().toISOString();
    const createdIso = createdAt ? new Date(createdAt).toISOString() : nowIso;

    try {
      const convRef = adminFirestore.doc(`users/${uid}/conversations/${convId}`);
      const convSnap = await convRef.get();
      if (!convSnap.exists) {
        // Auto-create conversation parent if missing
        await convRef.set({
          title: content.slice(0, 36) + (content.length > 36 ? '...' : ''),
          scope: { type: 'all' },
          pinned: false,
          createdAt: createdIso,
          updatedAt: nowIso,
          ownerId: uid,
        });
      } else {
        // Update conversation's updatedAt
        await convRef.set({ updatedAt: nowIso }, { merge: true });
      }

      const msgRef = convRef.collection('messages').doc(msgId);
      const msgStatus =
        status === 'insufficient_evidence' ||
        status === 'no_relevant_passages' ||
        status === 'error' ||
        status === 'answered'
          ? status
          : (content && content.includes("couldn't find sufficient evidence") ? 'insufficient_evidence' : 'answered');

      const msgData: Record<string, any> = {
        role: cleanRole,
        content: content.slice(0, 50000),
        status: msgStatus,
        citations: Array.isArray(citations) ? citations.slice(0, 100) : [],
        timings: typeof latencyMs === 'number' ? { total: latencyMs } : {},
        confidence: 'high' as const,
        model: String(modelUsed || 'gemini-3.8-flash').slice(0, 128),
        createdAt: createdIso,
      };

      await msgRef.set(msgData, { merge: true });

      return res.status(200).json({
        success: true,
        conversationId: convId,
        message: {
          id: msgId,
          conversationId: convId,
          ...msgData,
          createdAt: new Date(msgData.createdAt).getTime(),
          latencyMs,
          modelUsed: msgData.model,
          status: 'answered' as const,
        },
        requestId,
      });
    } catch (err: any) {
      logger.error({ err: err.message, convId, msgId, uid, requestId }, 'Failed to persist conversation message');
      return res.status(500).json({
        error: 'Failed to persist message.',
        code: 'INTERNAL_ERROR',
        requestId,
      });
    }
  }
);
