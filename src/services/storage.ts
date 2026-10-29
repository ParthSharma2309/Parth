import { openDB, DBSchema, IDBPDatabase } from 'idb';
import {
  DocumentRecord,
  ChunkRecord,
  CollectionRecord,
  ConversationRecord,
  MessageRecord,
  NotebookItem,
  SettingsState,
  EvaluationItem,
  EvaluationRun,
  UserFeedback,
} from '../types/index.ts';
import { MODEL_CONFIG } from '../config/models.ts';

interface DocuMindDB extends DBSchema {
  documents: {
    key: string;
    value: DocumentRecord;
    indexes: { 'by-status': string; 'by-collection': string; 'by-hash': string };
  };
  chunks: {
    key: string;
    value: ChunkRecord;
    indexes: { 'by-document': string };
  };
  pdf_blobs: {
    key: string;
    value: { id: string; blob: Blob };
  };
  collections: {
    key: string;
    value: CollectionRecord;
  };
  conversations: {
    key: string;
    value: ConversationRecord;
    indexes: { 'by-updated': number };
  };
  messages: {
    key: string;
    value: MessageRecord;
    indexes: { 'by-conversation': string; 'by-created': number };
  };
  notebook: {
    key: string;
    value: NotebookItem;
    indexes: { 'by-created': number };
  };
  evaluation_items: {
    key: string;
    value: EvaluationItem;
  };
  evaluation_runs: {
    key: string;
    value: EvaluationRun;
    indexes: { 'by-created': number };
  };
  settings: {
    key: string;
    value: any;
  };
}

export const DB_NAME = 'documind_db';
export const DB_VERSION = 2; // Bumped to 2 with migrations (Requirement 1)

let dbPromise: Promise<IDBPDatabase<DocuMindDB>> | null = null;

/**
 * 2. Requests persistent storage permission from the browser.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * 2. Fetches storage usage and quota estimate, warning if >= 80%.
 */
export interface StorageEstimateInfo {
  usage: number; // in bytes
  quota: number; // in bytes
  usageMB: number;
  quotaMB: number;
  usagePercent: number; // 0 - 100
  isPersisted: boolean;
  isHighUsage: boolean; // >= 80%
}

export async function getStorageEstimate(): Promise<StorageEstimateInfo> {
  let usage = 0;
  let quota = 0;
  let isPersisted = false;

  if (typeof navigator !== 'undefined' && navigator.storage) {
    try {
      if (navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        usage = est.usage || 0;
        quota = est.quota || 0;
      }
      if (navigator.storage.persisted) {
        isPersisted = await navigator.storage.persisted();
      }
    } catch {
      // Ignore estimation errors
    }
  }

  const usagePercent = quota > 0 ? (usage / quota) * 100 : 0;
  return {
    usage,
    quota,
    usageMB: Number((usage / (1024 * 1024)).toFixed(1)),
    quotaMB: Number((quota / (1024 * 1024)).toFixed(1)),
    usagePercent: Number(usagePercent.toFixed(1)),
    isPersisted,
    isHighUsage: usagePercent >= 80,
  };
}

/**
 * 1. Opens IndexedDB with proper migrations handling every version without dropping data.
 */
export async function getDB(): Promise<IDBPDatabase<DocuMindDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DocuMindDB>(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, transaction) {
        // Documents store
        if (!db.objectStoreNames.contains('documents')) {
          const docStore = db.createObjectStore('documents', { keyPath: 'id' });
          docStore.createIndex('by-status', 'status');
          docStore.createIndex('by-collection', 'collectionId');
          docStore.createIndex('by-hash', 'fileHash');
        } else if (oldVersion < 2) {
          const docStore = transaction.objectStore('documents');
          if (!docStore.indexNames.contains('by-hash')) {
            docStore.createIndex('by-hash', 'fileHash');
          }
        }

        // Chunks store
        if (!db.objectStoreNames.contains('chunks')) {
          const chunkStore = db.createObjectStore('chunks', { keyPath: 'id' });
          chunkStore.createIndex('by-document', 'documentId');
        }

        // PDF blobs store
        if (!db.objectStoreNames.contains('pdf_blobs')) {
          db.createObjectStore('pdf_blobs', { keyPath: 'id' });
        }

        // Collections store
        if (!db.objectStoreNames.contains('collections')) {
          db.createObjectStore('collections', { keyPath: 'id' });
        }

        // Conversations store
        if (!db.objectStoreNames.contains('conversations')) {
          const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
          convStore.createIndex('by-updated', 'updatedAt');
        }

        // Messages store
        if (!db.objectStoreNames.contains('messages')) {
          const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
          msgStore.createIndex('by-conversation', 'conversationId');
          msgStore.createIndex('by-created', 'createdAt');
        }

        // Notebook store
        if (!db.objectStoreNames.contains('notebook')) {
          const noteStore = db.createObjectStore('notebook', { keyPath: 'id' });
          noteStore.createIndex('by-created', 'createdAt');
        }

        // Evaluation items store
        if (!db.objectStoreNames.contains('evaluation_items')) {
          db.createObjectStore('evaluation_items', { keyPath: 'id' });
        }

        // Evaluation runs store
        if (!db.objectStoreNames.contains('evaluation_runs')) {
          const runStore = db.createObjectStore('evaluation_runs', { keyPath: 'id' });
          runStore.createIndex('by-created', 'createdAt');
        }

        // Settings store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }

        // Migration to DB_VERSION 2: Add dim and model to chunks if missing, never drop data!
        if (oldVersion < 2 && db.objectStoreNames.contains('chunks')) {
          const chunkStore = transaction.objectStore('chunks');
          try {
            let cursor = await chunkStore.openCursor();
            while (cursor) {
              const val = cursor.value;
              let changed = false;
              if (val.dim === undefined) {
                const emb = val.embedding;
                val.dim = emb ? (emb.length || Object.keys(emb).length || 0) : 0;
                changed = true;
              }
              if (!val.model) {
                val.model = MODEL_CONFIG.defaultEmbeddingModel;
                changed = true;
              }
              if (changed) {
                await cursor.update(val);
              }
              cursor = await cursor.continue();
            }
          } catch (e) {
            console.warn('Migration cursor warning:', e);
          }
        }

        // Add schemaVersion record in settings
        const settingsStore = transaction.objectStore('settings');
        await settingsStore.put({ version: 2, updatedAt: Date.now() }, 'schemaVersion');
      },
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export async function getSchemaVersion(): Promise<number> {
  const db = await getDB();
  const rec = await db.get('settings', 'schemaVersion');
  return rec?.version || DB_VERSION;
}

export async function setSchemaVersion(version: number): Promise<void> {
  const db = await getDB();
  await db.put('settings', { version, updatedAt: Date.now() }, 'schemaVersion');
}

// ----------------- SHA-256 HASH CALCULATOR -----------------
export async function calculateFileHash(blob: Blob): Promise<string> {
  try {
    const buffer = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(digest));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    console.warn('Failed to compute SHA-256 hash:', err);
    return `fallback_${blob.size}_${Date.now()}`;
  }
}

// ----------------- DOCUMENTS -----------------
export async function findDocumentByHash(fileHash: string): Promise<DocumentRecord | undefined> {
  const db = await getDB();
  const all = await db.getAll('documents');
  return all.find((d) => d.fileHash === fileHash);
}

export async function saveDocument(doc: DocumentRecord, blob?: Blob): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['documents', 'pdf_blobs'], 'readwrite');
  await tx.objectStore('documents').put(doc);
  if (blob) {
    await tx.objectStore('pdf_blobs').put({ id: doc.id, blob });
  }
  await tx.done;
}

export async function saveDocumentBlob(id: string, blob: Blob): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('pdf_blobs', 'readwrite');
  await tx.store.put({ id, blob });
  await tx.done;
}

export async function updateDocumentStatus(
  id: string,
  update: Partial<DocumentRecord>
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('documents', 'readwrite');
  const doc = await tx.store.get(id);
  if (doc) {
    const updated = { ...doc, ...update };
    await tx.store.put(updated);
  }
  await tx.done;
}

export async function getDocument(id: string): Promise<DocumentRecord | undefined> {
  const db = await getDB();
  return db.get('documents', id);
}

export const getDocumentById = getDocument;

export async function getAllDocuments(): Promise<DocumentRecord[]> {
  const db = await getDB();
  return db.getAll('documents');
}

export async function getDocumentBlob(id: string): Promise<Blob | undefined> {
  const db = await getDB();
  const entry = await db.get('pdf_blobs', id);
  return entry?.blob;
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['documents', 'chunks', 'pdf_blobs'], 'readwrite');
  await tx.objectStore('documents').delete(id);
  await tx.objectStore('pdf_blobs').delete(id);

  // Delete all chunks for this document
  const chunkIndex = tx.objectStore('chunks').index('by-document');
  let cursor = await chunkIndex.openCursor(id);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
  invalidateDocumentChunksCache(id);
}

// ----------------- CHUNKS & VECTOR CACHING -----------------
const documentChunksCache = new Map<string, ChunkRecord[]>();

export function invalidateDocumentChunksCache(documentId?: string): void {
  if (documentId) {
    documentChunksCache.delete(documentId);
  } else {
    documentChunksCache.clear();
  }
}

export function ensureFloat32Chunk(chunk: ChunkRecord): ChunkRecord {
  if (!chunk) return chunk;
  const rawEmb = chunk.embedding;
  let embedding: Float32Array;
  if (rawEmb instanceof Float32Array) {
    embedding = rawEmb;
  } else if (Array.isArray(rawEmb)) {
    embedding = new Float32Array(rawEmb);
  } else if (rawEmb && typeof rawEmb === 'object') {
    embedding = new Float32Array(Object.values(rawEmb));
  } else {
    embedding = new Float32Array(0);
  }
  return {
    ...chunk,
    embedding,
    dim: chunk.dim || embedding.length,
    model: chunk.model || MODEL_CONFIG.defaultEmbeddingModel,
  };
}

export async function saveChunks(chunks: ChunkRecord[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('chunks', 'readwrite');
  const affectedDocIds = new Set<string>();

  for (const chunk of chunks) {
    await tx.store.put(ensureFloat32Chunk(chunk));
    if (chunk.documentId) {
      affectedDocIds.add(chunk.documentId);
    }
  }
  await tx.done;

  for (const docId of affectedDocIds) {
    invalidateDocumentChunksCache(docId);
  }
}

export async function getChunksByDocument(documentId: string): Promise<ChunkRecord[]> {
  const cached = documentChunksCache.get(documentId);
  if (cached) {
    return cached;
  }

  const db = await getDB();
  const index = db.transaction('chunks').store.index('by-document');
  const chunks = (await index.getAll(documentId)).map(ensureFloat32Chunk);
  documentChunksCache.set(documentId, chunks);
  return chunks;
}

export async function getChunksByDocuments(documentIds: string[]): Promise<ChunkRecord[]> {
  if (!documentIds || documentIds.length === 0) return [];
  const uniqueDocIds = Array.from(new Set(documentIds.filter(Boolean)));
  const chunkArrays = await Promise.all(uniqueDocIds.map((id) => getChunksByDocument(id)));
  return chunkArrays.flat();
}

export async function deleteChunksByDocument(documentId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('chunks', 'readwrite');
  const chunkIndex = tx.objectStore('chunks').index('by-document');
  let cursor = await chunkIndex.openCursor(documentId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
  invalidateDocumentChunksCache(documentId);
}

export async function getAllChunks(): Promise<ChunkRecord[]> {
  const db = await getDB();
  const chunks = await db.getAll('chunks');
  return chunks.map(ensureFloat32Chunk);
}

export async function getChunksForScope(
  scope: { type: 'all' } | { type: 'collection'; collectionId: string } | { type: 'selected'; documentIds: string[] },
  allDocs: DocumentRecord[]
): Promise<ChunkRecord[]> {
  let inScopeDocIds: string[] = [];

  if (scope.type === 'all') {
    inScopeDocIds = allDocs
      .filter((d) => String(d.status).toLowerCase() === 'ready')
      .map((d) => d.id);
  } else if (scope.type === 'collection') {
    inScopeDocIds = allDocs
      .filter((d) => d.collectionId === scope.collectionId && String(d.status).toLowerCase() === 'ready')
      .map((d) => d.id);
  } else if (scope.type === 'selected') {
    inScopeDocIds = scope.documentIds;
  }

  return getChunksByDocuments(inScopeDocIds);
}

// ----------------- COLLECTIONS -----------------
export async function saveCollection(collection: CollectionRecord): Promise<void> {
  const db = await getDB();
  await db.put('collections', collection);
}

export async function getAllCollections(): Promise<CollectionRecord[]> {
  const db = await getDB();
  return db.getAll('collections');
}

export async function deleteCollection(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['collections', 'documents'], 'readwrite');
  await tx.objectStore('collections').delete(id);

  // Unassign documents from this collection
  const docStore = tx.objectStore('documents');
  const docs = await docStore.getAll();
  for (const doc of docs) {
    if (doc.collectionId === id) {
      await docStore.put({ ...doc, collectionId: undefined });
    }
  }
  await tx.done;
}

// ----------------- CONVERSATIONS -----------------
export async function saveConversation(conv: ConversationRecord): Promise<void> {
  const db = await getDB();
  await db.put('conversations', conv);
}

export async function getAllConversations(): Promise<ConversationRecord[]> {
  const db = await getDB();
  const index = db.transaction('conversations').store.index('by-updated');
  const list = await index.getAll();
  return list.reverse();
}

export async function getConversation(id: string): Promise<ConversationRecord | undefined> {
  const db = await getDB();
  return db.get('conversations', id);
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['conversations', 'messages'], 'readwrite');
  await tx.objectStore('conversations').delete(id);

  // Delete all messages in this conversation
  const msgIndex = tx.objectStore('messages').index('by-conversation');
  let cursor = await msgIndex.openCursor(id);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function updateConversationTitle(id: string, title: string): Promise<void> {
  const db = await getDB();
  const conv = await db.get('conversations', id);
  if (conv) {
    conv.title = title;
    conv.updatedAt = Date.now();
    await db.put('conversations', conv);
  }
}

// ----------------- MESSAGES -----------------
export async function saveMessage(msg: MessageRecord): Promise<void> {
  const db = await getDB();
  await db.put('messages', msg);

  // Update conversation's updatedAt
  const conv = await db.get('conversations', msg.conversationId);
  if (conv) {
    conv.updatedAt = msg.createdAt;
    await db.put('conversations', conv);
  }
}

export async function getMessagesByConversation(conversationId: string): Promise<MessageRecord[]> {
  const db = await getDB();
  const index = db.transaction('messages').store.index('by-conversation');
  const msgs = await index.getAll(conversationId);
  return msgs.sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteMessagesByConversation(conversationId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('messages', 'readwrite');
  const index = tx.store.index('by-conversation');
  let cursor = await index.openCursor(conversationId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function updateMessageFeedback(
  messageId: string,
  feedback: UserFeedback,
  comment?: string
): Promise<void> {
  const db = await getDB();
  const msg = await db.get('messages', messageId);
  if (msg) {
    msg.feedback = feedback;
    msg.feedbackComment = comment;
    msg.feedbackAt = Date.now();
    await db.put('messages', msg);
  }
}

export async function getAllMessages(): Promise<MessageRecord[]> {
  const db = await getDB();
  return db.getAll('messages');
}

// ----------------- NOTEBOOK -----------------
export async function saveNotebookItem(item: NotebookItem): Promise<void> {
  const db = await getDB();
  await db.put('notebook', item);
}

export async function getAllNotebookItems(): Promise<NotebookItem[]> {
  const db = await getDB();
  const index = db.transaction('notebook').store.index('by-created');
  const items = await index.getAll();
  return items.reverse();
}

export const getNotebookItems = getAllNotebookItems;

export async function deleteNotebookItem(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('notebook', id);
}

// ----------------- EVALUATION -----------------
export async function getEvaluationItems(): Promise<EvaluationItem[]> {
  const db = await getDB();
  return db.getAll('evaluation_items');
}

export async function saveEvaluationItem(item: EvaluationItem): Promise<void> {
  const db = await getDB();
  await db.put('evaluation_items', item);
}

export async function deleteEvaluationItem(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('evaluation_items', id);
}

export async function getEvaluationRuns(): Promise<EvaluationRun[]> {
  const db = await getDB();
  const index = db.transaction('evaluation_runs').store.index('by-created');
  const runs = await index.getAll();
  return runs.reverse();
}

export async function saveEvaluationRun(run: EvaluationRun): Promise<void> {
  const db = await getDB();
  await db.put('evaluation_runs', run);
}

export async function deleteEvaluationRun(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('evaluation_runs', id);
}

// ----------------- SETTINGS -----------------
export const DEFAULT_SETTINGS: SettingsState = {
  chunkSize: MODEL_CONFIG.defaultChunkSize,
  chunkOverlap: MODEL_CONFIG.defaultChunkOverlap,
  topK: MODEL_CONFIG.defaultTopK,
  similarityThreshold: MODEL_CONFIG.defaultSimilarityThreshold,
  similarityThresholds: { ...MODEL_CONFIG.similarityThresholds },
  embeddingModel: MODEL_CONFIG.defaultEmbeddingModel,
  generationModel: MODEL_CONFIG.defaultGenerationModel,
  maxFileSizeMB: MODEL_CONFIG.maxFileSizeMB,
  darkMode: 'system',
  bm25Weight: 0.5,
  accentTheme: 'sunset',
  reduceMotion: false,
  enableStreaming: true,
  enableHybridSearch: true,
  deskWidthPercent: 44,
  autoSignOutMinutes: 30,
};

export async function getSettings(): Promise<SettingsState> {
  const db = await getDB();
  const stored = await db.get('settings', 'global_settings');
  return stored ? { ...DEFAULT_SETTINGS, ...stored } : { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: SettingsState): Promise<void> {
  const db = await getDB();
  await db.put('settings', settings, 'global_settings');
}

// ----------------- EXPORT / IMPORT BACKUP (Requirement 3: .json.gz / .zip) -----------------
export interface BackupFileSummary {
  schemaVersion: number;
  exportedAt: string;
  documentCount: number;
  chunkCount: number;
  pdfBlobCount: number;
  conversationCount: number;
  messageCount: number;
  notebookCount: number;
  evaluationCount: number;
  data: any;
}

export async function exportBackupFile(): Promise<{ blob: Blob; fileName: string; size: number }> {
  const db = await getDB();
  const [
    documents,
    chunks,
    pdfBlobs,
    collections,
    conversations,
    messages,
    notebook,
    evaluation_items,
    evaluation_runs,
    settings,
  ] = await Promise.all([
    db.getAll('documents'),
    db.getAll('chunks'),
    db.getAll('pdf_blobs'),
    db.getAll('collections'),
    db.getAll('conversations'),
    db.getAll('messages'),
    db.getAll('notebook'),
    db.getAll('evaluation_items'),
    db.getAll('evaluation_runs'),
    db.get('settings', 'global_settings'),
  ]);

  // Convert raw PDF Blobs to Base64 for complete, portable backup
  const serializedPDFs = await Promise.all(
    pdfBlobs.map(async (entry) => {
      const buffer = await entry.blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const len = bytes.byteLength;
      for (let i = 0; i < len; i += 8192) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192)));
      }
      return {
        id: entry.id,
        base64: btoa(binary),
        type: entry.blob.type || 'application/pdf',
      };
    })
  );

  // Convert Float32Array to standard number array
  const exportableChunks = chunks.map((c) => ({
    ...c,
    embedding: c.embedding ? Array.from(c.embedding) : [],
  }));

  const backupData = {
    schemaVersion: DB_VERSION,
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    documents,
    chunks: exportableChunks,
    pdf_blobs: serializedPDFs,
    collections,
    conversations,
    messages,
    notebook,
    evaluation_items,
    evaluation_runs,
    settings: settings || DEFAULT_SETTINGS,
  };

  const jsonStr = JSON.stringify(backupData, null, 2);
  const textEncoder = new TextEncoder();
  const uncompressedBytes = textEncoder.encode(jsonStr);

  let fileBytes: Uint8Array = uncompressedBytes;
  let fileName = `DocuMind_Backup_${new Date().toISOString().slice(0, 10)}.json.gz`;
  let mimeType = 'application/gzip';

  // Compress using Web Streams gzip CompressionStream
  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      writer.write(uncompressedBytes);
      writer.close();
      const compressedBuffer = await new Response(cs.readable).arrayBuffer();
      fileBytes = new Uint8Array(compressedBuffer);
    } catch {
      fileName = `DocuMind_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      mimeType = 'application/json';
    }
  } else {
    fileName = `DocuMind_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    mimeType = 'application/json';
  }

  const blob = new Blob([fileBytes.buffer as ArrayBuffer], { type: mimeType });
  return { blob, fileName, size: blob.size };
}

export async function parseBackupFile(file: File): Promise<BackupFileSummary> {
  const fileBuffer = await file.arrayBuffer();
  const header = new Uint8Array(fileBuffer.slice(0, 2));
  const isGzip = header[0] === 0x1f && header[1] === 0x8b;

  let jsonText = '';
  if (isGzip && typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(new Uint8Array(fileBuffer));
    writer.close();
    jsonText = await new Response(ds.readable).text();
  } else {
    jsonText = new TextDecoder().decode(fileBuffer);
  }

  let data: any;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('Failed to parse backup: Invalid or corrupted JSON content.');
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Invalid backup file: Payload is not an object.');
  }

  const schemaVersion = data.schemaVersion || data.version;
  if (!schemaVersion || typeof schemaVersion !== 'number') {
    throw new Error('Invalid backup file: Missing schemaVersion header.');
  }

  return {
    schemaVersion,
    exportedAt: data.exportedAt || 'Unknown date',
    documentCount: Array.isArray(data.documents) ? data.documents.length : 0,
    chunkCount: Array.isArray(data.chunks) ? data.chunks.length : 0,
    pdfBlobCount: Array.isArray(data.pdf_blobs) ? data.pdf_blobs.length : 0,
    conversationCount: Array.isArray(data.conversations) ? data.conversations.length : 0,
    messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
    notebookCount: Array.isArray(data.notebook) ? data.notebook.length : 0,
    evaluationCount: Array.isArray(data.evaluation_items) ? data.evaluation_items.length : 0,
    data,
  };
}

export async function importBackupData(
  data: any,
  mode: 'merge' | 'replace'
): Promise<Record<string, number>> {
  const db = await getDB();
  const counts: Record<string, number> = {
    documents: 0,
    chunks: 0,
    pdf_blobs: 0,
    collections: 0,
    conversations: 0,
    messages: 0,
    notebook: 0,
    evaluations: 0,
  };

  if (mode === 'replace') {
    const clearTx = db.transaction(
      [
        'documents',
        'chunks',
        'pdf_blobs',
        'collections',
        'conversations',
        'messages',
        'notebook',
        'evaluation_items',
        'evaluation_runs',
      ],
      'readwrite'
    );
    await Promise.all([
      clearTx.objectStore('documents').clear(),
      clearTx.objectStore('chunks').clear(),
      clearTx.objectStore('pdf_blobs').clear(),
      clearTx.objectStore('collections').clear(),
      clearTx.objectStore('conversations').clear(),
      clearTx.objectStore('messages').clear(),
      clearTx.objectStore('notebook').clear(),
      clearTx.objectStore('evaluation_items').clear(),
      clearTx.objectStore('evaluation_runs').clear(),
    ]);
    await clearTx.done;
  }

  const tx = db.transaction(
    [
      'documents',
      'chunks',
      'pdf_blobs',
      'collections',
      'conversations',
      'messages',
      'notebook',
      'evaluation_items',
      'evaluation_runs',
      'settings',
    ],
    'readwrite'
  );

  if (Array.isArray(data.documents)) {
    for (const d of data.documents) {
      await tx.objectStore('documents').put(d);
      counts.documents++;
    }
  }

  if (Array.isArray(data.chunks)) {
    for (const c of data.chunks) {
      await tx.objectStore('chunks').put(ensureFloat32Chunk(c));
      counts.chunks++;
    }
  }

  if (Array.isArray(data.pdf_blobs)) {
    for (const entry of data.pdf_blobs) {
      if (entry.base64) {
        const binStr = atob(entry.base64);
        const len = binStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: entry.type || 'application/pdf' });
        await tx.objectStore('pdf_blobs').put({ id: entry.id, blob });
        counts.pdf_blobs++;
      }
    }
  }

  if (Array.isArray(data.collections)) {
    for (const col of data.collections) {
      await tx.objectStore('collections').put(col);
      counts.collections++;
    }
  }

  if (Array.isArray(data.conversations)) {
    for (const conv of data.conversations) {
      await tx.objectStore('conversations').put(conv);
      counts.conversations++;
    }
  }

  if (Array.isArray(data.messages)) {
    for (const m of data.messages) {
      await tx.objectStore('messages').put(m);
      counts.messages++;
    }
  }

  if (Array.isArray(data.notebook)) {
    for (const n of data.notebook) {
      await tx.objectStore('notebook').put(n);
      counts.notebook++;
    }
  }

  if (Array.isArray(data.evaluation_items)) {
    for (const e of data.evaluation_items) {
      await tx.objectStore('evaluation_items').put(e);
      counts.evaluations++;
    }
  }

  if (Array.isArray(data.evaluation_runs)) {
    for (const r of data.evaluation_runs) {
      await tx.objectStore('evaluation_runs').put(r);
    }
  }

  if (data.settings) {
    if (mode === 'replace') {
      await tx.objectStore('settings').put(data.settings, 'global_settings');
    } else {
      const current = await tx.objectStore('settings').get('global_settings');
      await tx.objectStore('settings').put({ ...(current || DEFAULT_SETTINGS), ...data.settings }, 'global_settings');
    }
  }

  await tx.done;
  invalidateDocumentChunksCache();
  return counts;
}

// Backward compatible export function
export async function exportAllDataAsJSON(): Promise<string> {
  const { blob } = await exportBackupFile();
  return new Response(blob).text();
}

export async function importAllDataFromJSON(jsonString: string): Promise<{
  success: boolean;
  counts: Record<string, number>;
}> {
  const data = JSON.parse(jsonString);
  const counts = await importBackupData(data, 'merge');
  return { success: true, counts };
}

// ----------------- GRANULAR CLEAR ACTIONS WITH 5-SECOND UNDO (Requirement 4) -----------------
let pendingUndoAction: {
  actionName: string;
  restoreFn: () => Promise<void>;
  timer: any;
} | null = null;

function registerUndo(
  actionName: string,
  restoreFn: () => Promise<void>,
  onTimeout?: () => void
): () => Promise<void> {
  if (pendingUndoAction) {
    clearTimeout(pendingUndoAction.timer);
    pendingUndoAction = null;
  }

  const timer = setTimeout(() => {
    pendingUndoAction = null;
    onTimeout?.();
  }, 5000);

  const undo = async () => {
    if (pendingUndoAction && pendingUndoAction.actionName === actionName) {
      clearTimeout(pendingUndoAction.timer);
      const restore = pendingUndoAction.restoreFn;
      pendingUndoAction = null;
      await restore();
    }
  };

  pendingUndoAction = {
    actionName,
    restoreFn,
    timer,
  };

  return undo;
}

/**
 * 1. Clear chats: deletes conversations and messages with 5-second Undo
 */
export async function clearChats(): Promise<{ undo: () => Promise<void> }> {
  const db = await getDB();
  const [conversations, messages] = await Promise.all([
    db.getAll('conversations'),
    db.getAll('messages'),
  ]);

  const tx = db.transaction(['conversations', 'messages'], 'readwrite');
  await tx.objectStore('conversations').clear();
  await tx.objectStore('messages').clear();
  await tx.done;

  const undo = registerUndo('clearChats', async () => {
    const restoreTx = db.transaction(['conversations', 'messages'], 'readwrite');
    for (const c of conversations) await restoreTx.objectStore('conversations').put(c);
    for (const m of messages) await restoreTx.objectStore('messages').put(m);
    await restoreTx.done;
  });

  return { undo };
}

/**
 * 2. Clear one document: deletes document, its chunks, and PDF blob with 5-second Undo
 */
export async function clearOneDocument(documentId: string): Promise<{ undo: () => Promise<void> }> {
  const db = await getDB();
  const doc = await db.get('documents', documentId);
  const chunks = await getChunksByDocument(documentId);
  const blob = await getDocumentBlob(documentId);

  await deleteDocument(documentId);

  const undo = registerUndo(`clearDoc_${documentId}`, async () => {
    if (doc) {
      await saveDocument(doc, blob);
    }
    if (chunks.length > 0) {
      await saveChunks(chunks);
    }
  });

  return { undo };
}

/**
 * 3. Clear evaluation history: deletes all evaluation runs with 5-second Undo
 */
export async function clearEvaluationHistory(): Promise<{ undo: () => Promise<void> }> {
  const db = await getDB();
  const runs = await db.getAll('evaluation_runs');

  const tx = db.transaction('evaluation_runs', 'readwrite');
  await tx.store.clear();
  await tx.done;

  const undo = registerUndo('clearEvaluationHistory', async () => {
    const restoreTx = db.transaction('evaluation_runs', 'readwrite');
    for (const r of runs) await restoreTx.store.put(r);
    await restoreTx.done;
  });

  return { undo };
}

/**
 * 4. Clear everything EXCEPT settings with 5-second Undo
 */
export async function clearAllExceptSettings(): Promise<{ undo: () => Promise<void> }> {
  const db = await getDB();
  const [
    documents,
    chunks,
    pdfBlobs,
    collections,
    conversations,
    messages,
    notebook,
    evaluation_items,
    evaluation_runs,
  ] = await Promise.all([
    db.getAll('documents'),
    db.getAll('chunks'),
    db.getAll('pdf_blobs'),
    db.getAll('collections'),
    db.getAll('conversations'),
    db.getAll('messages'),
    db.getAll('notebook'),
    db.getAll('evaluation_items'),
    db.getAll('evaluation_runs'),
  ]);

  const tx = db.transaction(
    [
      'documents',
      'chunks',
      'pdf_blobs',
      'collections',
      'conversations',
      'messages',
      'notebook',
      'evaluation_items',
      'evaluation_runs',
    ],
    'readwrite'
  );
  await Promise.all([
    tx.objectStore('documents').clear(),
    tx.objectStore('chunks').clear(),
    tx.objectStore('pdf_blobs').clear(),
    tx.objectStore('collections').clear(),
    tx.objectStore('conversations').clear(),
    tx.objectStore('messages').clear(),
    tx.objectStore('notebook').clear(),
    tx.objectStore('evaluation_items').clear(),
    tx.objectStore('evaluation_runs').clear(),
  ]);
  await tx.done;
  invalidateDocumentChunksCache();

  const undo = registerUndo('clearAllExceptSettings', async () => {
    const restoreTx = db.transaction(
      [
        'documents',
        'chunks',
        'pdf_blobs',
        'collections',
        'conversations',
        'messages',
        'notebook',
        'evaluation_items',
        'evaluation_runs',
      ],
      'readwrite'
    );
    for (const d of documents) await restoreTx.objectStore('documents').put(d);
    for (const c of chunks) await restoreTx.objectStore('chunks').put(ensureFloat32Chunk(c));
    for (const b of pdfBlobs) await restoreTx.objectStore('pdf_blobs').put(b);
    for (const col of collections) await restoreTx.objectStore('collections').put(col);
    for (const conv of conversations) await restoreTx.objectStore('conversations').put(conv);
    for (const m of messages) await restoreTx.objectStore('messages').put(m);
    for (const n of notebook) await restoreTx.objectStore('notebook').put(n);
    for (const e of evaluation_items) await restoreTx.objectStore('evaluation_items').put(e);
    for (const r of evaluation_runs) await restoreTx.objectStore('evaluation_runs').put(r);
    await restoreTx.done;
    invalidateDocumentChunksCache();
  });

  return { undo };
}

/**
 * 5. Full factory reset with 5-second Undo
 */
export async function fullReset(): Promise<{ undo: () => Promise<void> }> {
  const db = await getDB();
  const [
    documents,
    chunks,
    pdfBlobs,
    collections,
    conversations,
    messages,
    notebook,
    evaluation_items,
    evaluation_runs,
    settings,
  ] = await Promise.all([
    db.getAll('documents'),
    db.getAll('chunks'),
    db.getAll('pdf_blobs'),
    db.getAll('collections'),
    db.getAll('conversations'),
    db.getAll('messages'),
    db.getAll('notebook'),
    db.getAll('evaluation_items'),
    db.getAll('evaluation_runs'),
    db.get('settings', 'global_settings'),
  ]);

  await clearAllData();

  const undo = registerUndo('fullReset', async () => {
    const restoreTx = db.transaction(
      [
        'documents',
        'chunks',
        'pdf_blobs',
        'collections',
        'conversations',
        'messages',
        'notebook',
        'evaluation_items',
        'evaluation_runs',
        'settings',
      ],
      'readwrite'
    );
    for (const d of documents) await restoreTx.objectStore('documents').put(d);
    for (const c of chunks) await restoreTx.objectStore('chunks').put(ensureFloat32Chunk(c));
    for (const b of pdfBlobs) await restoreTx.objectStore('pdf_blobs').put(b);
    for (const col of collections) await restoreTx.objectStore('collections').put(col);
    for (const conv of conversations) await restoreTx.objectStore('conversations').put(conv);
    for (const m of messages) await restoreTx.objectStore('messages').put(m);
    for (const n of notebook) await restoreTx.objectStore('notebook').put(n);
    for (const e of evaluation_items) await restoreTx.objectStore('evaluation_items').put(e);
    for (const r of evaluation_runs) await restoreTx.objectStore('evaluation_runs').put(r);
    if (settings) await restoreTx.objectStore('settings').put(settings, 'global_settings');
    await restoreTx.done;
    invalidateDocumentChunksCache();
  });

  return { undo };
}

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    [
      'documents',
      'chunks',
      'pdf_blobs',
      'collections',
      'conversations',
      'messages',
      'notebook',
      'evaluation_items',
      'evaluation_runs',
      'settings',
    ],
    'readwrite'
  );
  await tx.objectStore('documents').clear();
  await tx.objectStore('chunks').clear();
  await tx.objectStore('pdf_blobs').clear();
  await tx.objectStore('collections').clear();
  await tx.objectStore('conversations').clear();
  await tx.objectStore('messages').clear();
  await tx.objectStore('notebook').clear();
  await tx.objectStore('evaluation_items').clear();
  await tx.objectStore('evaluation_runs').clear();
  await tx.objectStore('settings').clear();
  await tx.done;
  invalidateDocumentChunksCache();
}

// ----------------- INTEGRITY DIAGNOSTIC & ONE-CLICK REPAIR (Requirement 5) -----------------
export interface IntegrityReport {
  orphanChunksCount: number;
  orphanChunkIds: string[];
  emptyDocIds: string[];
  missingBlobDocIds: string[];
  hasIssues: boolean;
  totalDocuments: number;
  totalChunks: number;
  totalBlobs: number;
}

export async function checkDatabaseIntegrity(): Promise<IntegrityReport> {
  const db = await getDB();
  const allDocs = await db.getAll('documents');
  const allChunks = await db.getAll('chunks');
  const allBlobs = await db.getAll('pdf_blobs');

  const docIdSet = new Set(allDocs.map((d) => d.id));
  const blobDocIdSet = new Set(allBlobs.map((b) => b.id));

  // 1. Chunks without a document
  const orphanChunkIds: string[] = [];
  const chunkDocIdCounts = new Map<string, number>();
  for (const c of allChunks) {
    if (!docIdSet.has(c.documentId)) {
      orphanChunkIds.push(c.id);
    } else {
      chunkDocIdCounts.set(c.documentId, (chunkDocIdCounts.get(c.documentId) || 0) + 1);
    }
  }

  // 2. Documents without chunks (only flag local documents; cloud docs have chunks stored in Firestore)
  const emptyDocIds: string[] = [];
  for (const doc of allDocs) {
    const isReady = String(doc.status).toLowerCase() === 'ready';
    if (!doc.storagePath && isReady && (chunkDocIdCounts.get(doc.id) || 0) === 0) {
      emptyDocIds.push(doc.id);
    }
  }

  // 3. Missing PDF blobs (only flag local documents; cloud docs reside in Supabase Storage)
  const missingBlobDocIds: string[] = [];
  for (const doc of allDocs) {
    if (!doc.storagePath && !blobDocIdSet.has(doc.id)) {
      missingBlobDocIds.push(doc.id);
    }
  }

  const hasIssues =
    orphanChunkIds.length > 0 || emptyDocIds.length > 0 || missingBlobDocIds.length > 0;

  return {
    orphanChunksCount: orphanChunkIds.length,
    orphanChunkIds,
    emptyDocIds,
    missingBlobDocIds,
    hasIssues,
    totalDocuments: allDocs.length,
    totalChunks: allChunks.length,
    totalBlobs: allBlobs.length,
  };
}

export async function repairDatabaseIntegrity(
  report?: IntegrityReport
): Promise<{ repairedCount: number; details: string[] }> {
  const rep = report || (await checkDatabaseIntegrity());
  const db = await getDB();
  const details: string[] = [];
  let repairedCount = 0;

  const tx = db.transaction(['documents', 'chunks'], 'readwrite');

  // 1. Purge orphan chunks
  if (rep.orphanChunkIds.length > 0) {
    const chunkStore = tx.objectStore('chunks');
    for (const id of rep.orphanChunkIds) {
      await chunkStore.delete(id);
    }
    repairedCount += rep.orphanChunkIds.length;
    details.push(`Removed ${rep.orphanChunkIds.length} orphan chunks with no parent document.`);
  }

  // 2. Update empty ready documents
  if (rep.emptyDocIds.length > 0) {
    const docStore = tx.objectStore('documents');
    for (const id of rep.emptyDocIds) {
      const doc = await docStore.get(id);
      if (doc) {
        await docStore.put({
          ...doc,
          status: 'Failed',
          statusMessage: 'Integrity repair: Document contains 0 passages. Please re-upload.',
        });
        repairedCount++;
      }
    }
    details.push(`Updated ${rep.emptyDocIds.length} empty documents to require re-indexing.`);
  }

  await tx.done;
  invalidateDocumentChunksCache();

  return { repairedCount, details };
}
