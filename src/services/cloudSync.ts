import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { db, storage, auth, isFirebaseConfigured } from '../lib/firebase.ts';
import {
  DocumentRecord,
  ConversationRecord,
  ChunkRecord,
  NotebookItem,
} from '../types/index.ts';
import {
  getAllDocuments,
  getDocumentBlob,
  saveDocumentBlob,
  getAllConversations,
  saveConversation,
  deleteConversation,
  saveMessage,
  getAllNotebookItems,
  getAllChunks,
  getChunksByDocument,
  saveChunks,
  getSettings,
} from './storage.ts';
import { authFetch } from './apiClient.ts';

/**
 * Uploads a document PDF blob to Cloud Storage under users/{uid}/pdfs/{docId}.pdf
 */
export async function uploadPdfToStorage(
  uid: string,
  docId: string,
  pdfBlob: Blob
): Promise<string | null> {
  if (!storage) return null;
  try {
    const storageRef = ref(storage, `users/${uid}/pdfs/${docId}.pdf`);
    await uploadBytes(storageRef, pdfBlob, {
      contentType: 'application/pdf',
      customMetadata: { docId, uploadedAt: new Date().toISOString() },
    });
    return storageRef.fullPath;
  } catch (err) {
    console.warn(`Failed to upload PDF for doc ${docId} to Cloud Storage:`, err);
    return null;
  }
}

/**
 * Sync a single document record to Firestore
 */
export async function syncDocumentRecordToCloud(
  uid: string,
  docRecord: DocumentRecord,
  storagePath?: string
): Promise<void> {
  const patchPayload = {
    name: docRecord.name,
    pages: docRecord.pageCount,
    status: docRecord.status.toLowerCase(),
    summary: docRecord.summary || '',
    topics: docRecord.topics || [],
    collectionId: docRecord.collectionId || undefined,
  };

  // 1. Update via authenticated backend API
  try {
    const patchRes = await authFetch(`/api/documents/${docRecord.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchPayload),
    });
    if (!patchRes.ok) {
      const errText = await patchRes.text().catch(() => '');
      console.warn(`Backend PATCH /api/documents/${docRecord.id} failed (${patchRes.status}):`, errText);
    }
  } catch (err) {
    console.warn(`Backend PATCH /api/documents/${docRecord.id} skipped:`, err);
  }

  // 2. Direct client Firestore sync if initialized
  if (db) {
    try {
      const docRef = doc(db, `users/${uid}/documents/${docRecord.id}`);
      await setDoc(
        docRef,
        {
          name: docRecord.name,
          pages: docRecord.pageCount,
          status: docRecord.status.toLowerCase(),
          summary: docRecord.summary || '',
          topics: docRecord.topics || [],
          updatedAt: new Date().toISOString(),
          ...(docRecord.collectionId ? { collectionId: docRecord.collectionId } : {}),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn(`Client Firestore setDoc for doc ${docRecord.id} skipped:`, err);
    }
  }
}

/**
 * Sync chunks of a document to Firestore under users/{uid}/chunks/{chunkId}
 */
export async function syncChunksToCloud(uid: string, chunks: ChunkRecord[]): Promise<void> {
  if (!db || chunks.length === 0) return;

  // Process in batches of 450 (Firestore limit is 500 ops per batch)
  const chunkSize = 450;
  for (let i = 0; i < chunks.length; i += chunkSize) {
    const batch = writeBatch(db);
    const slice = chunks.slice(i, i + chunkSize);
    for (const chunk of slice) {
      const chunkRef = doc(db, `users/${uid}/chunks/${chunk.id}`);
      const embeddingArray = Array.isArray(chunk.embedding)
        ? chunk.embedding
        : Array.from(chunk.embedding);

      batch.set(
        chunkRef,
        {
          documentId: chunk.documentId,
          documentName: chunk.documentName || '',
          page: chunk.pageNumber,
          chunkIndex: typeof chunk.chunkIndex === 'number' ? chunk.chunkIndex : 0,
          text: chunk.text,
          model: chunk.model || 'gemini-embedding-2-preview',
          dim: chunk.dim || embeddingArray.length || 0,
          embedding: embeddingArray,
          charStart: typeof chunk.charStart === 'number' ? chunk.charStart : 0,
          charEnd: typeof chunk.charEnd === 'number' ? chunk.charEnd : (chunk.text?.length || 0),
        },
        { merge: true }
      );
    }
    await batch.commit();
  }
}

/**
 * Sync a conversation and its messages to Firestore
 */
export async function syncConversationToCloud(
  uid: string,
  conversation: ConversationRecord,
  messages?: any[]
): Promise<void> {
  if (!db) return;

  const convRef = doc(db, `users/${uid}/conversations/${conversation.id}`);
  await setDoc(
    convRef,
    {
      title: conversation.title,
      scope: conversation.scope || {},
      pinned: false,
      createdAt: new Date(conversation.createdAt).toISOString(),
      updatedAt: new Date(conversation.updatedAt).toISOString(),
    },
    { merge: true }
  );

  // Sync messages if provided
  if (messages && messages.length > 0) {
    const batch = writeBatch(db);
    for (const msg of messages) {
      const msgRef = doc(db, `users/${uid}/conversations/${conversation.id}/messages/${msg.id}`);
      batch.set(
        msgRef,
        {
          role: msg.role,
          content: msg.content,
          citations: msg.citations || [],
          timings: msg.latencyMs || {},
          confidence: 'high',
          model: 'gemini-3.8-flash',
          createdAt: new Date(msg.createdAt).toISOString(),
        },
        { merge: true }
      );
    }
    await batch.commit();
  }
}

/**
 * Sync a notebook item to Firestore
 */
export async function syncNoteToCloud(uid: string, note: NotebookItem): Promise<void> {
  if (!db) return;
  const noteRef = doc(db, `users/${uid}/notebook/${note.id}`);
  await setDoc(
    noteRef,
    {
      content: note.answer || note.question || '',
      sourceMessageId: note.citations?.[0]?.chunkId || null,
      tags: note.tags || [],
      color: 'blue',
      position: 0,
      createdAt: new Date(note.createdAt).toISOString(),
    },
    { merge: true }
  );
}

/**
 * Migrates local guest data from IndexedDB into the user's Firestore and Cloud Storage accounts
 */
export async function migrateLocalDataToCloud(uid: string): Promise<{
  documentsCount: number;
  conversationsCount: number;
  notesCount: number;
}> {
  if (!isFirebaseConfigured || !db) {
    return { documentsCount: 0, conversationsCount: 0, notesCount: 0 };
  }

  const [docs, convs, notes, chunks, settings] = await Promise.all([
    getAllDocuments(),
    getAllConversations(),
    getAllNotebookItems(),
    getAllChunks(),
    getSettings(),
  ]);

  // 1. Sync User Settings
  try {
    const userRef = doc(db, `users/${uid}`);
    await setDoc(userRef, { settings }, { merge: true });
  } catch (err) {
    console.warn('Failed to sync settings to Firestore:', err);
  }

  // 2. Sync Documents & PDF Blobs
  let docsCount = 0;
  for (const docRecord of docs) {
    try {
      let storagePath: string | undefined = undefined;
      const blob = await getDocumentBlob(docRecord.id);
      if (blob && storage) {
        const path = await uploadPdfToStorage(uid, docRecord.id, blob);
        if (path) storagePath = path;
      }
      await syncDocumentRecordToCloud(uid, docRecord, storagePath);
      docsCount++;
    } catch (err) {
      console.warn(`Failed to migrate document ${docRecord.id}:`, err);
    }
  }

  // 3. Sync Chunks
  try {
    if (chunks.length > 0) {
      await syncChunksToCloud(uid, chunks);
    }
  } catch (err) {
    console.warn('Failed to migrate chunks to Firestore:', err);
  }

  // 4. Sync Conversations
  let convsCount = 0;
  for (const conv of convs) {
    try {
      await syncConversationToCloud(uid, conv);
      convsCount++;
    } catch (err) {
      console.warn(`Failed to migrate conversation ${conv.id}:`, err);
    }
  }

  // 5. Sync Notebook Items
  let notesCount = 0;
  for (const note of notes) {
    try {
      await syncNoteToCloud(uid, note);
      notesCount++;
    } catch (err) {
      console.warn(`Failed to migrate note ${note.id}:`, err);
    }
  }

  console.info(
    `✅ Migration complete for user ${uid}: ${docsCount} docs, ${convsCount} chats, ${notesCount} notes.`
  );

  return {
    documentsCount: docsCount,
    conversationsCount: convsCount,
    notesCount: notesCount,
  };
}

/**
 * Normalizes raw Firestore document metadata into a complete client DocumentRecord.
 * Maps server Firestore fields (e.g. pages -> pageCount, createdAt -> uploadedAt, hash -> fileHash, status -> Ready).
 */
export function normalizeCloudDocument(doc: any): DocumentRecord {
  let status: DocumentRecord['status'] = 'Ready';
  const rawStatus = String(doc.status || '').toLowerCase();
  if (rawStatus === 'ready') {
    status = 'Ready';
  } else if (rawStatus === 'indexing' || rawStatus === 'processing') {
    status = 'Processing';
  } else if (rawStatus === 'error' || rawStatus === 'failed') {
    status = 'Failed';
  } else if (rawStatus === 'uploaded') {
    status = 'Uploaded';
  }

  const uploadedAt = doc.uploadedAt
    ? Number(doc.uploadedAt)
    : doc.createdAt
    ? new Date(doc.createdAt).getTime()
    : Date.now();

  return {
    id: String(doc.id),
    name: String(doc.name || 'Untitled Document'),
    size: Number(doc.size || 0),
    pageCount: Number(doc.pageCount || doc.pages || 1),
    status,
    statusMessage: doc.statusMessage || undefined,
    collectionId: doc.collectionId || undefined,
    fileHash: doc.fileHash || doc.hash || undefined,
    extractedCharacters: Number(doc.extractedCharacters || 0),
    avgCharactersPerPage: Number(doc.avgCharactersPerPage || 0),
    uploadedAt,
    modelUsed: doc.modelUsed || 'gemini-embedding-2-preview',
    hasExtractableText: doc.hasExtractableText !== false,
    hasOCR: !!doc.hasOCR,
    storageBucket: doc.storageBucket || undefined,
    storagePath: doc.storagePath || undefined,
    userId: doc.userId || doc.ownerId || undefined,
    ownerId: doc.ownerId || doc.userId || undefined,
    summary: doc.summary || undefined,
    suggestedQuestions: Array.isArray(doc.suggestedQuestions) ? doc.suggestedQuestions : undefined,
    topics: Array.isArray(doc.topics) ? doc.topics : undefined,
  };
}

/**
 * Fetches user-scoped document metadata records from backend /api/documents.
 * Returns null if the request failed (distinguishing network/server error from empty list).
 */
export async function fetchCloudDocuments(): Promise<DocumentRecord[] | null> {
  try {
    const res = await authFetch('/api/documents');
    if (!res.ok) {
      console.warn(`fetchCloudDocuments returned status: ${res.status}`);
      return null;
    }
    const data = await res.json();
    return Array.isArray(data.documents) ? data.documents.map(normalizeCloudDocument) : [];
  } catch (err) {
    console.warn('Failed to fetch cloud documents:', err);
    return null;
  }
}

/**
 * Fetches user-scoped conversation records from backend /api/conversations.
 * Caches retrieved conversations into IndexedDB for offline resilience.
 * Returns null if the request failed (distinguishing network/server error from empty list).
 */
export async function fetchCloudConversations(): Promise<ConversationRecord[] | null> {
  try {
    const res = await authFetch('/api/conversations');
    if (!res.ok) {
      console.warn(`fetchCloudConversations returned status: ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!Array.isArray(data.conversations)) {
      return [];
    }
    const convs: ConversationRecord[] = data.conversations.map((c: any) => ({
      id: String(c.id),
      title: String(c.title || 'Untitled Inquiry'),
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : (c.createdAt ? new Date(c.createdAt).getTime() : Date.now()),
      updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : (c.updatedAt ? new Date(c.updatedAt).getTime() : Date.now()),
      scope: c.scope || { type: 'all' },
      userId: c.userId || c.ownerId || undefined,
    }));

    // Cache into local IndexedDB
    for (const conv of convs) {
      await saveConversation(conv).catch(() => {});
    }

    return convs;
  } catch (err) {
    console.warn('Failed to fetch cloud conversations:', err);
    return null;
  }
}

/**
 * Fetches messages for a conversation from backend /api/conversations/:id/messages.
 * Caches retrieved messages into IndexedDB.
 */
export async function fetchCloudMessages(convId: string): Promise<any[]> {
  try {
    const res = await authFetch(`/api/conversations/${convId}/messages`);
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    if (!Array.isArray(data.messages)) {
      return [];
    }

    const messages = data.messages.map((m: any) => ({
      id: String(m.id),
      conversationId: convId,
      role: m.role || 'user',
      content: String(m.content || ''),
      createdAt: typeof m.createdAt === 'number' ? m.createdAt : (m.createdAt ? new Date(m.createdAt).getTime() : Date.now()),
      status: m.status || 'answered',
      citations: Array.isArray(m.citations) ? m.citations : [],
      retrievalScope: m.retrievalScope || { type: 'all' },
      latencyMs: m.latencyMs,
      followupSuggestions: Array.isArray(m.followupSuggestions) ? m.followupSuggestions : undefined,
    }));

    // Cache into local IndexedDB
    for (const msg of messages) {
      await saveMessage(msg).catch(() => {});
    }

    return messages;
  } catch (err) {
    console.warn(`Failed to fetch cloud messages for conversation ${convId}:`, err);
    return [];
  }
}

/**
 * Saves a conversation both locally in IndexedDB and in the cloud via /api/conversations.
 */
export async function saveCloudConversation(conv: ConversationRecord): Promise<void> {
  // 1. Save locally in IndexedDB for immediate responsiveness
  await saveConversation(conv);

  // 2. If authenticated, persist to cloud
  const currentUser = auth?.currentUser;
  if (currentUser && !currentUser.isAnonymous) {
    try {
      const res = await authFetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: conv.id,
          title: conv.title,
          scope: conv.scope,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server returned ${res.status}`);
      }
    } catch (err) {
      console.warn(`Failed to persist conversation ${conv.id} to cloud:`, err);
      throw err;
    }
  }
}

/**
 * Saves a message both locally in IndexedDB and in the cloud via /api/conversations/:id/messages.
 */
export async function saveCloudMessage(convId: string, msg: any): Promise<void> {
  // 1. Save locally in IndexedDB
  await saveMessage(msg);

  // 2. If authenticated, persist to cloud
  const currentUser = auth?.currentUser;
  if (currentUser && !currentUser.isAnonymous) {
    try {
      const res = await authFetch(`/api/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          status: msg.status,
          citations: msg.citations || [],
          latencyMs: msg.latencyMs?.total,
          modelUsed: msg.modelUsed || 'gemini-3.8-flash',
          createdAt: msg.createdAt,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server returned ${res.status}`);
      }
    } catch (err) {
      console.warn(`Failed to persist message ${msg.id} to cloud:`, err);
      throw err;
    }
  }
}

/**
 * Deletes a conversation locally and in the cloud.
 */
export async function deleteCloudConversation(convId: string): Promise<void> {
  await deleteConversation(convId);

  const currentUser = auth?.currentUser;
  if (currentUser && !currentUser.isAnonymous) {
    try {
      await authFetch(`/api/conversations/${convId}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.warn(`Failed to delete conversation ${convId} from cloud:`, err);
    }
  }
}

/**
 * Deletes a document record and its Supabase Storage object via /api/documents/:id.
 * Rejects deletion if offline to prevent partial state or resurrection on sync.
 */
export async function deleteCloudDocument(docId: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Cannot delete cloud document while offline. Please reconnect to the internet and try again.');
  }

  const res = await authFetch(`/api/documents/${docId}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    // If the server returns 404 (Document not found), the document is already absent
    // from the cloud or was only stored locally in the browser. Treat as idempotent success.
    if (res.status === 404) {
      return true;
    }

    let errMsg = `Failed to delete cloud document (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) {
        errMsg = data.error;
      }
    } catch {
      // ignore json parse error
    }
    throw new Error(errMsg);
  }

  return true;
}

/**
 * Helper to trigger browser download for a Blob.
 */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Fetches a short-lived signed download URL for an authenticated user's document.
 * Requires verified Firebase Authentication. Returns null if unauthorized or missing.
 */
export async function getDocumentDownloadUrl(docId: string): Promise<string | null> {
  try {
    const res = await authFetch(`/api/documents/${docId}/download-url`);
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    return data.downloadUrl || null;
  } catch (err) {
    console.warn(`Failed to get signed download URL for doc ${docId}:`, err);
    return null;
  }
}

/**
 * Downloads the document PDF file for the user, checking IndexedDB cache first
 * and falling back to the authenticated short-lived signed URL from Supabase Storage.
 */
export async function downloadDocumentFile(docId: string, filename: string): Promise<boolean> {
  try {
    // 1. Try local IndexedDB blob
    const localBlob = await getDocumentBlob(docId);
    if (localBlob) {
      triggerBrowserDownload(localBlob, filename);
      return true;
    }

    // 2. Fetch short-lived signed URL from backend
    const signedUrl = await getDocumentDownloadUrl(docId);
    if (!signedUrl) {
      return false;
    }

    // 3. Fetch file bytes using signed URL
    const resp = await fetch(signedUrl);
    if (!resp.ok) {
      return false;
    }
    const blob = await resp.blob();

    // 4. Cache in IndexedDB for subsequent offline/reading desk use
    await saveDocumentBlob(docId, blob).catch(() => {});

    // 5. Trigger download
    triggerBrowserDownload(blob, filename);
    return true;
  } catch (err) {
    console.warn(`Failed to download document ${docId}:`, err);
    return false;
  }
}

/**
 * Loads a document blob, checking IndexedDB cache first and falling back
 * to the authenticated signed download URL from Supabase Storage.
 */
export async function loadDocumentBlob(docId: string): Promise<Blob | null> {
  try {
    const localBlob = await getDocumentBlob(docId);
    if (localBlob) return localBlob;

    const signedUrl = await getDocumentDownloadUrl(docId);
    if (!signedUrl) return null;

    const resp = await fetch(signedUrl);
    if (!resp.ok) return null;

    const blob = await resp.blob();
    await saveDocumentBlob(docId, blob).catch(() => {});
    return blob;
  } catch (err) {
    console.warn(`Failed to load document blob for ${docId}:`, err);
    return null;
  }
}

/**
 * Uploads all indexed chunks for a document to the backend /api/documents/:id/chunks.
 */
export async function uploadDocumentChunksToCloud(
  docId: string,
  chunks: ChunkRecord[]
): Promise<boolean> {
  if (!chunks || chunks.length === 0) return true;
  try {
    const formatted = chunks.map((c) => ({
      id: c.id,
      documentId: docId,
      documentName: c.documentName || '',
      pageNumber: c.pageNumber,
      chunkIndex: c.chunkIndex,
      text: c.text,
      model: c.model,
      dim: c.dim,
      embedding: Array.isArray(c.embedding) ? c.embedding : Array.from(c.embedding),
      charStart: c.charStart,
      charEnd: c.charEnd,
    }));

    const res = await authFetch(`/api/documents/${docId}/chunks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunks: formatted }),
    });

    return res.ok;
  } catch (err) {
    console.warn(`Failed to upload chunks to cloud for document ${docId}:`, err);
    return false;
  }
}

/**
 * Fetches indexed text chunks and vector embeddings for a document from backend /api/documents/:id/chunks.
 */
export async function fetchDocumentChunksFromCloud(
  docId: string
): Promise<ChunkRecord[] | null> {
  try {
    const res = await authFetch(`/api/documents/${docId}/chunks`);
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    if (!Array.isArray(data.chunks)) {
      return null;
    }

    return data.chunks.map((c: any) => ({
      id: c.id,
      documentId: c.documentId || docId,
      documentName: c.documentName || '',
      pageNumber: c.pageNumber || 1,
      chunkIndex: c.chunkIndex || 0,
      text: c.text || '',
      embedding: new Float32Array(c.embedding || []),
      dim: c.dim || (c.embedding?.length || 0),
      model: c.model || 'gemini-embedding-2-preview',
      charStart: c.charStart || 0,
      charEnd: c.charEnd || 0,
    }));
  } catch (err) {
    console.warn(`Failed to fetch cloud chunks for document ${docId}:`, err);
    return null;
  }
}

/**
 * Ensures a document's chunks are populated in local IndexedDB.
 * 1. Checks local IndexedDB first.
 * 2. If missing, attempts fast-path restoration from cloud Firestore (/api/documents/:id/chunks).
 * 3. If cloud chunks are absent, downloads the PDF blob from Supabase Storage via signed URL and
 *    regenerates the chunks, saving them to local IndexedDB and syncing to the cloud.
 */
export async function ensureDocumentChunksAvailable(
  docId: string,
  docName?: string
): Promise<ChunkRecord[]> {
  // 1. Fast check in local IndexedDB
  const localChunks = await getChunksByDocument(docId);
  if (localChunks && localChunks.length > 0) {
    return localChunks;
  }

  // 2. Fast-path: Restore from cloud storage
  const cloudChunks = await fetchDocumentChunksFromCloud(docId);
  if (cloudChunks && cloudChunks.length > 0) {
    const resolvedChunks = cloudChunks.map((c) => ({
      ...c,
      documentName: c.documentName || docName || '',
    }));
    await saveChunks(resolvedChunks);
    return resolvedChunks;
  }

  // 3. Fallback: Regenerate from PDF blob
  try {
    const blob = await loadDocumentBlob(docId);
    if (!blob) {
      console.warn(`Cannot regenerate chunks for ${docId}: PDF blob could not be retrieved.`);
      return [];
    }

    const { processPDFFile } = await import('./docProcessor.ts');
    await processPDFFile(
      blob,
      docName || 'document.pdf',
      {
        serverDocId: docId,
        storagePath: `${auth?.currentUser?.uid || 'user'}/${docId}.pdf`,
        userId: auth?.currentUser?.uid,
      }
    );

    const regeneratedChunks = await getChunksByDocument(docId);
    if (regeneratedChunks.length > 0) {
      // Sync back to cloud in background so subsequent devices don't need to regenerate
      uploadDocumentChunksToCloud(docId, regeneratedChunks).catch(() => {});
    }
    return regeneratedChunks;
  } catch (regenErr) {
    console.error(`Failed to regenerate chunks for document ${docId}:`, regenErr);
    return [];
  }
}



