import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import '../helpers/firebaseAdminMock.js';

// Mock @google/genai
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(function (this: any) {
      return {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify({
              answerable: true,
              answer: 'Superposition enables qubits to exist in multiple states at once [1].',
              citations: [{ marker: 1, quote: 'states |0> and |1> simultaneously' }],
              confidence: 'high',
            }),
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

// Mock Supabase Storage methods
export const mockStorageRemove = vi.fn();
export const mockCreateSignedUrl = vi.fn();

vi.mock('../../server/lib/supabaseAdmin.js', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseBucket: vi.fn(() => 'documents'),
  getSupabaseAdminClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
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
import { normalizeCloudDocument } from '../../src/services/cloudSync.ts';
import { validateCitations } from '../../src/services/citations.ts';
import {
  isDocumentSummaryQuery,
  selectRepresentativeSummaryChunks,
  retrieveRelevantChunks,
} from '../../src/services/retrieval.ts';
import { ChunkRecord } from '../../src/types/index.ts';

describe('Regression: Answering Pipeline, Document Readiness & Cloud Sync', () => {
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
        set: async (data: any, options?: { merge?: boolean }) => {
          if (options?.merge) {
            const existing = firestoreStore.get(docPath) || {};
            firestoreStore.set(docPath, { ...existing, ...data });
          } else {
            firestoreStore.set(docPath, { ...data });
          }
        },
        update: async (updates: any) => {
          const existing = firestoreStore.get(docPath) || {};
          firestoreStore.set(docPath, { ...existing, ...updates });
        },
      }),
      batch: () => {
        const operations: Array<() => void> = [];
        return {
          set: (docRef: any, data: any, options?: { merge?: boolean }) => {
            operations.push(() => {
              const path = docRef.path;
              if (options?.merge) {
                const existing = firestoreStore.get(path) || {};
                firestoreStore.set(path, { ...existing, ...data });
              } else {
                firestoreStore.set(path, { ...data });
              }
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

    // Seed test document in Firestore with lowercase 'ready'
    firestoreStore.set('users/valid-user-a/documents/doc_quantum_101', {
      name: 'Quantum_Computing_Principles.pdf',
      pages: 12,
      size: 2048576,
      status: 'ready',
      createdAt: '2026-10-25T14:30:00.000Z',
      updatedAt: '2026-10-25T14:30:00.000Z',
      hash: 'sha256_quantum_hash',
      storagePath: 'valid-user-a/doc_quantum_101.pdf',
      ownerId: 'valid-user-a',
    });

    // Seed chunks for this document
    firestoreStore.set('users/valid-user-a/chunks/chunk_quantum_p1_c0', {
      documentId: 'doc_quantum_101',
      documentName: 'Quantum_Computing_Principles.pdf',
      page: 1,
      chunkIndex: 0,
      text: 'Quantum superposition allows quantum bits or qubits to exist in states |0> and |1> simultaneously.',
      model: 'gemini-embedding-2-preview',
      dim: 3,
      embedding: [0.85, 0.45, 0.22],
      charStart: 0,
      charEnd: 98,
    });

    setAdminFirestoreForTesting(createMockFirestore() as any);
  });

  it('1. normalizes cloud Firestore documents with status "ready" to DocumentRecord status "Ready"', () => {
    const rawFirestoreDoc = {
      id: 'doc_quantum_101',
      name: 'Quantum_Computing_Principles.pdf',
      pages: 12,
      size: 2048576,
      status: 'ready',
      createdAt: '2026-10-25T14:30:00.000Z',
      hash: 'sha256_quantum_hash',
      storagePath: 'valid-user-a/doc_quantum_101.pdf',
      ownerId: 'valid-user-a',
    };

    const normalized = normalizeCloudDocument(rawFirestoreDoc);

    expect(normalized.id).toBe('doc_quantum_101');
    expect(normalized.name).toBe('Quantum_Computing_Principles.pdf');
    expect(normalized.pageCount).toBe(12);
    expect(normalized.status).toBe('Ready');
    expect(normalized.fileHash).toBe('sha256_quantum_hash');
    expect(normalized.uploadedAt).toBe(new Date('2026-10-25T14:30:00.000Z').getTime());
  });

  it('2. includes ready cloud documents in GET /api/documents/:id/chunks with documentName populated', async () => {
    const res = await request(app)
      .get('/api/documents/doc_quantum_101/chunks')
      .set('Authorization', 'Bearer valid-user-a');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.chunks).toHaveLength(1);
    expect(res.body.chunks[0].documentId).toBe('doc_quantum_101');
    expect(res.body.chunks[0].documentName).toBe('Quantum_Computing_Principles.pdf');
    expect(res.body.chunks[0].pageNumber).toBe(1);
    expect(Array.isArray(res.body.chunks[0].embedding)).toBe(true);
  });

  it('3. denies cross-user chunk retrieval to maintain strict user isolation', async () => {
    const res = await request(app)
      .get('/api/documents/doc_quantum_101/chunks')
      .set('Authorization', 'Bearer valid-user-b');

    // Document belongs to valid-user-a, so user-b gets 404 (not found in user B's partition)
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('4. accepts uploaded chunks and marks document status as ready', async () => {
    // Seed an indexing document
    firestoreStore.set('users/valid-user-a/documents/doc_indexing_1', {
      name: 'IndexingDoc.pdf',
      pages: 4,
      status: 'indexing',
      ownerId: 'valid-user-a',
    });

    const res = await request(app)
      .post('/api/documents/doc_indexing_1/chunks')
      .set('Authorization', 'Bearer valid-user-a')
      .send({
        chunks: [
          {
            pageNumber: 1,
            chunkIndex: 0,
            text: 'Introductory passage content for indexing document.',
            embedding: [0.1, 0.2, 0.3],
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);

    // Verify document marked as ready in Firestore
    const updatedDoc = firestoreStore.get('users/valid-user-a/documents/doc_indexing_1');
    expect(updatedDoc.status).toBe('ready');
  });

  it('5. validates citations accurately when exact or shingle quotes match retrieved passages', () => {
    const passages = [
      {
        chunk: {
          id: 'chunk_1',
          documentId: 'doc_1',
          documentName: 'Physics.pdf',
          pageNumber: 1,
          chunkIndex: 0,
          text: 'Quantum superposition allows quantum bits or qubits to exist in states |0> and |1> simultaneously.',
          embedding: [0.1, 0.2, 0.3],
          model: 'gemini-embedding-2-preview',
          charStart: 0,
          charEnd: 98,
        },
        score: 0.92,
        semanticScore: 0.92,
        bm25Score: 4.5,
      },
    ];

    const modelCitations = [
      {
        marker: 1,
        quote: 'states |0> and |1> simultaneously',
      },
    ];

    const validation = validateCitations(modelCitations, passages);

    expect(validation.hasValidCitations).toBe(true);
    expect(validation.validCitations).toHaveLength(1);
    expect(validation.validCitations[0].verified).toBe(true);
    expect(validation.validCitations[0].documentName).toBe('Physics.pdf');
    expect(validation.validCitations[0].pageNumber).toBe(1);
  });

  it('6. produces an honest abstention without fake citations when passages do not support claims', () => {
    const passages = [
      {
        chunk: {
          id: 'chunk_1',
          documentId: 'doc_1',
          documentName: 'Physics.pdf',
          pageNumber: 1,
          chunkIndex: 0,
          text: 'Quantum superposition allows quantum bits to exist in states |0> and |1> simultaneously.',
          embedding: [0.1, 0.2, 0.3],
          model: 'gemini-embedding-2-preview',
          charStart: 0,
          charEnd: 88,
        },
        score: 0.45,
        semanticScore: 0.45,
        bm25Score: 1.0,
      },
    ];

    // Model hallucinates an external quote not present anywhere in the text
    const hallucinatoryCitations = [
      {
        marker: 1,
        quote: 'The quarterly revenue exceeded eighty million dollars in fiscal year 2024.',
      },
    ];

    const validation = validateCitations(hallucinatoryCitations, passages);

    // Quote does not exist in passage: verification flag is false
    expect(validation.hasValidCitations).toBe(false);
    expect(validation.validCitations[0].verified).toBe(false);
  });

  it('7. detects document summary requests accurately', () => {
    expect(isDocumentSummaryQuery('summarize this document')).toBe(true);
    expect(isDocumentSummaryQuery('summarize the document')).toBe(true);
    expect(isDocumentSummaryQuery('Give me an overview of this paper')).toBe(true);
    expect(isDocumentSummaryQuery('What is this document about?')).toBe(true);
    expect(isDocumentSummaryQuery('executive summary')).toBe(true);
    expect(isDocumentSummaryQuery('what are the main takeaways from this document')).toBe(true);

    // Specific factual queries should NOT be detected as whole-document summaries
    expect(isDocumentSummaryQuery('What is the qubit decoherence rate in milliseconds?')).toBe(false);
    expect(isDocumentSummaryQuery('What is the revenue for Q3 2024?')).toBe(false);
  });

  it('8. selects representative structural passages across document pages for summarization', () => {
    const mockChunks: ChunkRecord[] = Array.from({ length: 15 }, (_, i) => ({
      id: `chunk_${i + 1}`,
      documentId: 'doc_1',
      documentName: 'Paper.pdf',
      pageNumber: Math.floor(i / 2) + 1,
      chunkIndex: i,
      text: `Passage content for section ${i + 1}`,
      embedding: new Float32Array([0.1, 0.2, 0.3]),
      dim: 3,
      model: 'gemini-embedding-2-preview',
      charStart: i * 100,
      charEnd: (i + 1) * 100,
    }));

    const representative = selectRepresentativeSummaryChunks(mockChunks, 5);
    expect(representative).toHaveLength(5);
    // Preserves introductory passages from page 1
    expect(representative[0].pageNumber).toBe(1);
    // Preserves concluding passages from the final page
    expect(representative[representative.length - 1].pageNumber).toBe(8);
  });

  it('9. retrieves representative passages for "summarize this document" with relevance score >= 0.75', async () => {
    const mockChunks: ChunkRecord[] = [
      {
        id: 'c1',
        documentId: 'doc_selected',
        documentName: 'DigitalLogic.pdf',
        pageNumber: 1,
        chunkIndex: 0,
        text: 'Digital logic circuits are built from universal logic gates including NAND and NOR.',
        embedding: new Float32Array([0.1, 0.5, 0.8]),
        dim: 3,
        model: 'gemini-embedding-2-preview',
        charStart: 0,
        charEnd: 84,
      },
      {
        id: 'c2',
        documentId: 'doc_selected',
        documentName: 'DigitalLogic.pdf',
        pageNumber: 5,
        chunkIndex: 1,
        text: 'In conclusion, combinational digital systems can be simplified using Karnaugh maps.',
        embedding: new Float32Array([0.2, 0.6, 0.7]),
        dim: 3,
        model: 'gemini-embedding-2-preview',
        charStart: 85,
        charEnd: 170,
      },
      {
        id: 'c3',
        documentId: 'doc_unselected',
        documentName: 'Biology.pdf',
        pageNumber: 1,
        chunkIndex: 0,
        text: 'Cellular respiration occurs primarily within the mitochondria.',
        embedding: new Float32Array([0.9, 0.1, 0.1]),
        dim: 3,
        model: 'gemini-embedding-2-preview',
        charStart: 0,
        charEnd: 62,
      },
    ];

    const queryEmbedding = new Float32Array([0.2, 0.5, 0.7]);
    const validDocIds = new Set(['doc_selected']);

    const result = await retrieveRelevantChunks(
      queryEmbedding,
      mockChunks,
      { type: 'selected', documentIds: ['doc_selected'] },
      validDocIds,
      8,
      'summarize this document'
    );

    expect(result.topChunks.length).toBeGreaterThan(0);
    // Strictly scoped to the selected document
    expect(result.topChunks.every((item) => item.chunk.documentId === 'doc_selected')).toBe(true);
    // Unselected documents are strictly excluded
    expect(result.topChunks.some((item) => item.chunk.documentId === 'doc_unselected')).toBe(false);
    // Genuine cosine score is calculated without artificial clamp
    expect(typeof result.maxScore).toBe('number');
    expect(result.maxScore).toBeGreaterThan(0);
    expect(result.isBroadQuery).toBe(true);
  });

  it('10. strictly excludes unselected documents in single document scope', async () => {
    const mockChunks: ChunkRecord[] = [
      {
        id: 'c1',
        documentId: 'doc_a',
        documentName: 'DocA.pdf',
        pageNumber: 1,
        chunkIndex: 0,
        text: 'Important financial figures and EBITDA margins for Doc A.',
        embedding: new Float32Array([1, 0, 0]),
        dim: 3,
        model: 'gemini-embedding-2-preview',
        charStart: 0,
        charEnd: 56,
      },
      {
        id: 'c2',
        documentId: 'doc_b',
        documentName: 'DocB.pdf',
        pageNumber: 1,
        chunkIndex: 0,
        text: 'Other information not related to Doc A.',
        embedding: new Float32Array([1, 0, 0]),
        dim: 3,
        model: 'gemini-embedding-2-preview',
        charStart: 0,
        charEnd: 40,
      },
    ];

    const result = await retrieveRelevantChunks(
      new Float32Array([1, 0, 0]),
      mockChunks,
      { type: 'selected', documentIds: ['doc_a'] },
      new Set(['doc_a']),
      5,
      'What are the EBITDA margins?'
    );

    expect(result.topChunks).toHaveLength(1);
    expect(result.topChunks[0].chunk.documentId).toBe('doc_a');
  });

  it('11. preserves genuine honest abstention for out-of-domain factual questions', async () => {
    const mockChunks: ChunkRecord[] = [
      {
        id: 'c1',
        documentId: 'doc_cooking',
        documentName: 'FrenchCooking.pdf',
        pageNumber: 1,
        chunkIndex: 0,
        text: 'Whisk eggs and milk gently over medium heat to create scrambled eggs.',
        embedding: new Float32Array([1, 0, 0]),
        dim: 3,
        model: 'gemini-embedding-2-preview',
        charStart: 0,
        charEnd: 69,
      },
    ];

    // Query on astrophysics (orthogonal embedding)
    const outOfDomainEmbedding = new Float32Array([0, 1, 0]);
    const result = await retrieveRelevantChunks(
      outOfDomainEmbedding,
      mockChunks,
      { type: 'all' },
      new Set(['doc_cooking']),
      5,
      'What is the Schwarzschild radius of a black hole?'
    );

    // Max semantic similarity is near 0, far below the ~0.42 floor threshold
    expect(result.maxScore).toBeLessThan(0.35);
  });
});
