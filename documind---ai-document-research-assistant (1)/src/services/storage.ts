import { openDB, DBSchema, IDBPDatabase } from 'idb';
import {
  DocumentRecord,
  ChunkRecord,
  CollectionRecord,
  ConversationRecord,
  MessageRecord,
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
    indexes: { 'by-status': string; 'by-collection': string };
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
    value: SettingsState;
  };
}

const DB_NAME = 'documind_db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<DocuMindDB>> | null = null;

export async function getDB(): Promise<IDBPDatabase<DocuMindDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DocuMindDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Documents store
        if (!db.objectStoreNames.contains('documents')) {
          const docStore = db.createObjectStore('documents', { keyPath: 'id' });
          docStore.createIndex('by-status', 'status');
          docStore.createIndex('by-collection', 'collectionId');
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
      },
    });
  }
  return dbPromise;
}

// ----------------- DOCUMENTS -----------------
export async function saveDocument(doc: DocumentRecord, blob?: Blob): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['documents', 'pdf_blobs'], 'readwrite');
  await tx.objectStore('documents').put(doc);
  if (blob) {
    await tx.objectStore('pdf_blobs').put({ id: doc.id, blob });
  }
  await tx.done;
}

export async function updateDocumentStatus(
  id: string,
  update: Partial<DocumentRecord>
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('documents', 'readwrite');
  const existing = await tx.store.get(id);
  if (existing) {
    const updated = { ...existing, ...update };
    await tx.store.put(updated);
  }
  await tx.done;
}

export async function getAllDocuments(): Promise<DocumentRecord[]> {
  const db = await getDB();
  return db.getAll('documents');
}

export async function getDocumentById(id: string): Promise<DocumentRecord | undefined> {
  const db = await getDB();
  return db.get('documents', id);
}

export async function getDocumentBlob(id: string): Promise<Blob | undefined> {
  const db = await getDB();
  const record = await db.get('pdf_blobs', id);
  return record?.blob;
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['documents', 'chunks', 'pdf_blobs', 'messages'], 'readwrite');

  // 1. Delete document record & blob
  await tx.objectStore('documents').delete(id);
  await tx.objectStore('pdf_blobs').delete(id);

  // 2. Delete all chunks for this document
  const chunkStore = tx.objectStore('chunks');
  const chunkIndex = chunkStore.index('by-document');
  const chunksToDelete = await chunkIndex.getAllKeys(id);
  for (const chunkKey of chunksToDelete) {
    await chunkStore.delete(chunkKey);
  }

  // 3. Mark citations referencing deleted doc as "sourceDeleted: true" in old messages
  const messageStore = tx.objectStore('messages');
  const allMessages = await messageStore.getAll();
  for (const msg of allMessages) {
    if (msg.citations && msg.citations.length > 0) {
      let modified = false;
      const updatedCitations = msg.citations.map((c) => {
        if (c.documentId === id) {
          modified = true;
          return { ...c, sourceDeleted: true };
        }
        return c;
      });
      if (modified) {
        await messageStore.put({ ...msg, citations: updatedCitations });
      }
    }
  }

  await tx.done;
}

// ----------------- CHUNKS & EMBEDDINGS -----------------
export async function saveChunks(chunks: ChunkRecord[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('chunks', 'readwrite');
  for (const chunk of chunks) {
    await tx.store.put(chunk);
  }
  await tx.done;
}

export async function getChunksByDocument(documentId: string): Promise<ChunkRecord[]> {
  const db = await getDB();
  const index = db.transaction('chunks').store.index('by-document');
  return index.getAll(documentId);
}

export async function getAllChunks(): Promise<ChunkRecord[]> {
  const db = await getDB();
  return db.getAll('chunks');
}

export async function deleteChunksByDocument(documentId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('chunks', 'readwrite');
  const index = tx.store.index('by-document');
  const keys = await index.getAllKeys(documentId);
  for (const k of keys) {
    await tx.store.delete(k);
  }
  await tx.done;
}

// ----------------- COLLECTIONS -----------------
export async function getAllCollections(): Promise<CollectionRecord[]> {
  const db = await getDB();
  return db.getAll('collections');
}

export async function saveCollection(collection: CollectionRecord): Promise<void> {
  const db = await getDB();
  await db.put('collections', collection);
}

export async function deleteCollection(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['collections', 'documents'], 'readwrite');
  await tx.objectStore('collections').delete(id);

  // Unassign documents from this collection
  const docStore = tx.objectStore('documents');
  const allDocs = await docStore.getAll();
  for (const doc of allDocs) {
    if (doc.collectionId === id) {
      await docStore.put({ ...doc, collectionId: undefined });
    }
  }
  await tx.done;
}

// ----------------- CONVERSATIONS -----------------
export async function getAllConversations(): Promise<ConversationRecord[]> {
  const db = await getDB();
  const index = db.transaction('conversations').store.index('by-updated');
  const list = await index.getAll();
  return list.reverse(); // newest first
}

export async function getConversation(id: string): Promise<ConversationRecord | undefined> {
  const db = await getDB();
  return db.get('conversations', id);
}

export async function saveConversation(conv: ConversationRecord): Promise<void> {
  const db = await getDB();
  await db.put('conversations', conv);
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['conversations', 'messages'], 'readwrite');
  await tx.objectStore('conversations').delete(id);

  const msgStore = tx.objectStore('messages');
  const msgIndex = msgStore.index('by-conversation');
  const msgKeys = await msgIndex.getAllKeys(id);
  for (const k of msgKeys) {
    await msgStore.delete(k);
  }
  await tx.done;
}

// ----------------- MESSAGES -----------------
export async function getMessagesByConversation(conversationId: string): Promise<MessageRecord[]> {
  const db = await getDB();
  const index = db.transaction('messages').store.index('by-conversation');
  const list = await index.getAll(conversationId);
  return list.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getAllMessages(): Promise<MessageRecord[]> {
  const db = await getDB();
  const list = await db.getAll('messages');
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getMessageById(id: string): Promise<MessageRecord | undefined> {
  const db = await getDB();
  return db.get('messages', id);
}


export async function saveMessage(msg: MessageRecord): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['messages', 'conversations'], 'readwrite');
  await tx.objectStore('messages').put(msg);

  // Update conversation updatedAt
  const conv = await tx.objectStore('conversations').get(msg.conversationId);
  if (conv) {
    await tx.objectStore('conversations').put({ ...conv, updatedAt: Date.now() });
  }
  await tx.done;
}

export async function updateMessageFeedback(
  messageId: string,
  feedback: UserFeedback,
  comment?: string
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('messages', 'readwrite');
  const msg = await tx.store.get(messageId);
  if (msg) {
    await tx.store.put({
      ...msg,
      feedback,
      feedbackComment: comment,
      feedbackAt: Date.now(),
    });
  }
  await tx.done;
}

// ----------------- EVALUATION ITEMS & RUNS -----------------
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
  embeddingModel: MODEL_CONFIG.defaultEmbeddingModel,
  generationModel: MODEL_CONFIG.defaultGenerationModel,
  maxFileSizeMB: MODEL_CONFIG.maxFileSizeMB,
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

// ----------------- CLEAR ALL DATA -----------------
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
  await tx.objectStore('evaluation_items').clear();
  await tx.objectStore('evaluation_runs').clear();
  await tx.objectStore('settings').clear();
  await tx.done;
}
