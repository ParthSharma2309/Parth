export type DocumentStatus = 'Uploaded' | 'Processing' | 'Ready' | 'Failed';

export interface DocumentRecord {
  id: string;
  name: string;
  size: number;
  pageCount: number;
  collectionId?: string;
  status: DocumentStatus;
  statusMessage?: string;
  progress?: number; // 0 - 100
  processingStep?: 'validating' | 'extracting' | 'chunking' | 'embedding' | 'complete' | 'failed';
  extractedCharacters: number;
  avgCharactersPerPage: number;
  uploadedAt: number;
  modelUsed: string;
  hasExtractableText: boolean;
}

export interface ChunkRecord {
  id: string;
  documentId: string;
  documentName: string;
  pageNumber: number; // 1-based page number
  chunkIndex: number;
  text: string;
  embedding: number[];
  model: string;
  charStart: number;
  charEnd: number;
}

export interface CollectionRecord {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
}

export interface Citation {
  marker: number; // 1-based marker like [1]
  chunkId: string;
  documentId: string;
  documentName: string;
  pageNumber: number;
  quote: string;
  verified: boolean; // quote verified in passage text via normalized whitespace
  sourceDeleted?: boolean;
  passageText: string;
  similarity: number;
}

export type MessageStatus =
  | 'answered'
  | 'no_relevant_passages'
  | 'insufficient_evidence'
  | 'error';

export type UserFeedback =
  | 'helpful'
  | 'incorrect'
  | 'unsupported_citation'
  | 'missing_info';

export interface RetrievalScore {
  chunkId: string;
  documentId: string;
  documentName: string;
  pageNumber: number;
  score: number;
  preview: string;
}

export type RetrievalScope =
  | { type: 'all' }
  | { type: 'collection'; collectionId: string }
  | { type: 'selected'; documentIds: string[] };

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  status: MessageStatus;
  errorMessage?: string;
  citations: Citation[];
  retrievalScope: RetrievalScope;
  retrievalScores?: RetrievalScore[];
  latencyMs?: {
    retrieval: number;
    generation: number;
    total: number;
  };
  feedback?: UserFeedback;
  feedbackComment?: string;
  feedbackAt?: number;
}

export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  scope: RetrievalScope;
}

export interface SettingsState {
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  similarityThreshold: number;
  embeddingModel: string;
  generationModel: string;
  maxFileSizeMB: number;
}

export interface EvaluationItem {
  id: string;
  question: string;
  expectedDocumentId?: string;
  expectedDocumentName?: string;
  expectedPages: number[]; // 1-based
  isAnswerable: boolean;
  notes?: string;
}

export interface EvaluationItemResult {
  itemId: string;
  question: string;
  expectedDocumentName: string;
  expectedPages: number[];
  isAnswerable: boolean;
  actualAnswerable: boolean;
  retrievedPages: Array<{ documentId: string; pageNumber: number; score: number; rank: number }>;
  recallAt3: boolean;
  recallAt5: boolean;
  modelMarkersProduced: number;
  validMarkersCount: number;
  citationValidityRate: number;
  outcome: MessageStatus;
  retrievalLatencyMs: number;
  totalLatencyMs: number;
  answerText: string;
  citations: Citation[];
}

export interface EvaluationRun {
  id: string;
  createdAt: number;
  config: SettingsState;
  itemCount: number;
  itemResults: EvaluationItemResult[];
  metrics: {
    recallAt3: number;
    recallAt5: number;
    citationValidity: number;
    abstentionPrecision: number;
    abstentionRecall: number;
    falseAbstainRate: number;
    p50RetrievalLatencyMs: number;
    p95RetrievalLatencyMs: number;
    p50EndToEndLatencyMs: number;
    p95EndToEndLatencyMs: number;
  };
}
