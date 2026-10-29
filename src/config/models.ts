/**
 * DocuMind Central Model & System Configuration
 */

export const MODEL_CONFIG = {
  // Embedding model: Gemini embedding model
  defaultEmbeddingModel: 'gemini-embedding-2-preview',
  supportedEmbeddingModels: [
    { id: 'gemini-embedding-2-preview', name: 'Gemini Embedding 2 Preview (High Dimension / Default)' },
    { id: 'gemini-embedding-2', name: 'Gemini Embedding 2' },
    { id: 'gemini-embedding-001', name: 'Gemini Embedding 001' },
    { id: 'text-embedding-004', name: 'Text Embedding 004' },
  ],

  // Per-embedding-model similarity thresholds for honest abstention (Requirement 2)
  similarityThresholds: {
    'gemini-embedding-2-preview': 0.42,
    'gemini-embedding-2': 0.45,
    'gemini-embedding-001': 0.50,
    'text-embedding-004': 0.52,
  } as Record<string, number>,

  // Text Generation model: Gemini text model
  defaultGenerationModel: 'gemini-3.8-flash',
  supportedGenerationModels: [
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Flagship Text & Vision Model / Default)' },
    { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite (High Availability Fallback)' },
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview (Complex Reasoning)' },
  ],

  // Retrieval & Chunking Defaults (ONE config: 900 / 180, Requirement 5)
  defaultChunkSize: 900, // characters
  defaultChunkOverlap: 180, // characters
  pageBoundaryOverlap: 150, // max characters to overlap across adjacent page boundary
  maxExpandedPassages: 25, // cap total passages sent to model
  defaultTopK: 8,
  broadQueryTopK: 16, // expanded top-k for broad, comparative, or detailed research questions
  defaultSimilarityThreshold: 0.45, // below this -> outcome 1: No relevant passages

  // File limits
  maxFileSizeMB: 25,
  minAvgCharsPerPage: 10, // With Gemini Vision OCR, even 0-native-text pages are supported
} as const;

export const ABSTENTION_MESSAGE =
  "I couldn't find sufficient evidence to answer this question in your selected documents. Try a more specific question or upload a document that covers this topic.";

/**
 * Returns the configured abstention similarity threshold for a given embedding model.
 */
export function getModelSimilarityThreshold(modelId?: string): number {
  if (!modelId) return MODEL_CONFIG.defaultSimilarityThreshold;
  const cleanId = modelId.replace(/^models\//, '');
  return (
    MODEL_CONFIG.similarityThresholds[cleanId] ??
    MODEL_CONFIG.similarityThresholds[modelId] ??
    MODEL_CONFIG.defaultSimilarityThreshold
  );
}
