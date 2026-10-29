export type DocumentStatus = 'Uploaded' | 'Processing' | 'Ready' | 'Failed';

export type DocumentStage = 'Read' | 'Split' | 'Embed' | 'Ready' | 'Failed';

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
  stage?: DocumentStage;
  fileHash?: string; // SHA-256 for duplicate detection
  extractedCharacters: number;
  avgCharactersPerPage: number;
  uploadedAt: number;
  modelUsed: string;
  hasExtractableText: boolean;
  hasOCR?: boolean;
  storagePath?: string; // Scoped storage path in Supabase Storage (e.g., <uid>/<docId>.pdf)
  userId?: string; // Authenticated Firebase user ID
  ownerId?: string; // Owner UID matching Firestore metadata
  summary?: string;
  suggestedQuestions?: string[];
  topics?: string[];
}

export interface ChunkRecord {
  id: string;
  documentId: string;
  documentName: string;
  pageNumber: number; // 1-based page number
  chunkIndex: number;
  text: string;
  embedding: Float32Array | number[];
  dim?: number;
  model: string;
  charStart: number;
  charEnd: number;
  isOCR?: boolean;
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
  isOCR?: boolean;
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
  denseScore?: number;
  sparseScore?: number;
  preview: string;
  isOCR?: boolean;
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
  followupSuggestions?: string[];
  latencyMs?: {
    retrieval: number;
    generation: number;
    total: number;
    timeToFirstToken?: number;
  };
  feedback?: UserFeedback;
  feedbackComment?: string;
  feedbackAt?: number;
  indexMismatch?: {
    indexedModel: string;
    currentModel: string;
    indexedDim?: number;
    currentDim?: number;
  };
}

export interface NotebookItem {
  id: string;
  title: string;
  question: string;
  answer: string;
  citations: Citation[];
  createdAt: number;
  documentName?: string;
  documentId?: string;
  tags?: string[];
}

export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  scope: RetrievalScope;
  userId?: string;
}

export interface SettingsState {
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  similarityThreshold: number;
  similarityThresholds?: Record<string, number>;
  embeddingModel: string;
  generationModel: string;
  maxFileSizeMB: number;
  darkMode: 'light' | 'dark' | 'system';
  bm25Weight: number; // 0.0 - 1.0 (hybrid fusion weight)
  accentTheme?: 'sunset' | 'ocean' | 'forest';
  reduceMotion?: boolean;
  enableStreaming?: boolean;
  enableHybridSearch?: boolean;
  deskWidthPercent?: number;
  autoSignOutMinutes?: number; // Inactivity auto sign-out (default 30, 0 = disabled)
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
    faithfulnessAndAbstention?: number;
    p50RetrievalLatencyMs: number;
    p95RetrievalLatencyMs: number;
    p50EndToEndLatencyMs: number;
    p95EndToEndLatencyMs: number;
    counts?: {
      citationNumerator: number;
      citationDenominator: number;
      citationCasesCount: number;
      recallNumerator: number;
      recallDenominator: number;
      faithfulnessNumerator: number;
      faithfulnessDenominator: number;
      trueAnswers: number;
      trueAbstains: number;
      falseAbstains: number;
      falseAnswers: number;
      ungroundedAnswers?: number;
    };
  };
}

export class IndexMismatchError extends Error {
  public readonly indexedModel: string;
  public readonly currentModel: string;
  public readonly indexedDim?: number;
  public readonly currentDim?: number;

  constructor(indexedModel: string, currentModel: string, indexedDim?: number, currentDim?: number) {
    super(`Your documents were indexed with ${indexedModel}. Re-index them to use ${currentModel}`);
    this.name = 'IndexMismatchError';
    this.indexedModel = indexedModel;
    this.currentModel = currentModel;
    this.indexedDim = indexedDim;
    this.currentDim = currentDim;
    Object.setPrototypeOf(this, IndexMismatchError.prototype);
  }
}

