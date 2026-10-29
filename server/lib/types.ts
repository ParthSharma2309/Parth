import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

/**
 * Gemini Error Interface and Class
 */
export interface GeminiErrorLike {
  name?: string;
  message?: string;
  status?: number;
  statusCode?: number;
  code?: string | number;
  errType?: string;
  _classified?: string;
  stack?: string;
}

export class GeminiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly errType?: string;

  constructor(message: string, status = 500, code = 'GEMINI_ERROR', errType?: string) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.code = code;
    this.errType = errType;
    Object.setPrototypeOf(this, GeminiError.prototype);
  }
}

/**
 * Zod Schemas and Inferred Types for Server Routes
 */

// Embed Request
export const EmbedRequestSchema = z.object({
  texts: z
    .array(
      z
        .string()
        .min(1, 'Chunk text cannot be empty')
        .max(10000, 'Chunk text cannot exceed 10,000 characters')
    )
    .min(1, 'At least 1 text must be provided')
    .max(50, 'Maximum 50 texts allowed per batch'),
  model: z.string().optional().default('gemini-embedding-2-preview'),
  purpose: z.enum(['document', 'query']).optional().default('document'),
  dimensions: z.coerce.number().int().positive().optional(),
});
export type EmbedRequest = z.infer<typeof EmbedRequestSchema>;

// Passage
export const PassageSchema = z.object({
  index: z.coerce.number().int().min(1),
  docName: z.string().max(200).optional().default('document'),
  page: z.coerce.number().int().min(1).optional().default(1),
  text: z.string().max(12000, 'Passage text exceeds maximum limit (12,000 chars)'),
});
export type Passage = z.infer<typeof PassageSchema>;

// Generate Answer Request
export const GenerateAnswerSchema = z.object({
  query: z
    .string()
    .min(1, 'Query is required and must not be empty')
    .max(3000, 'Query cannot exceed 3,000 characters'),
  passages: z
    .array(PassageSchema)
    .min(1, 'At least 1 passage is required for answer generation')
    .max(25, 'Maximum 25 passages allowed'),
  model: z.string().optional(),
});
export type GenerateAnswerRequest = z.infer<typeof GenerateAnswerSchema>;

// Chat Turn History item
export const ChatTurnSchema = z.object({
  role: z.enum(['user', 'assistant', 'model']),
  content: z.string().optional(),
  text: z.string().optional(),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

// Answer Stream Request
export const AnswerStreamSchema = z.object({
  query: z
    .string()
    .min(1, 'Query is required and must not be empty')
    .max(3000, 'Query cannot exceed 3,000 characters'),
  passages: z
    .array(PassageSchema)
    .min(1, 'At least 1 passage is required')
    .max(25, 'Maximum 25 passages allowed'),
  model: z.string().optional(),
  history: z.array(ChatTurnSchema).optional().default([]),
});
export type AnswerStreamRequest = z.infer<typeof AnswerStreamSchema>;

// Document Summary Request
export const DocumentSummarySchema = z.object({
  text: z
    .string()
    .min(1, 'Text sample is required and must not be empty')
    .max(30000, 'Text sample cannot exceed 30,000 characters'),
  docName: z.string().max(300).optional().default('Document'),
});
export type DocumentSummaryRequest = z.infer<typeof DocumentSummarySchema>;

// Suggest Followups Request
export const SuggestFollowupsSchema = z.object({
  question: z
    .string()
    .min(1, 'Question is required and cannot be empty')
    .max(3000, 'Question cannot exceed 3,000 characters'),
  answer: z
    .string()
    .min(1, 'Answer is required and cannot be empty')
    .max(12000, 'Answer cannot exceed 12,000 characters'),
});
export type SuggestFollowupsRequest = z.infer<typeof SuggestFollowupsSchema>;

// Vision OCR Request
export const VisionRequestSchema = z.object({
  image: z
    .string()
    .min(1, 'Image data is required')
    .refine((val) => val.startsWith('data:image/') || /^[A-Za-z0-9+/=]+$/.test(val), {
      message: 'Image must be base64 data or data URL',
    }),
  prompt: z.string().max(5000).optional(),
});
export type VisionRequest = z.infer<typeof VisionRequestSchema>;

// Query Rewrite Request
export const RewriteRequestSchema = z.object({
  question: z
    .string()
    .min(1, 'Question is required')
    .max(2000, 'Question cannot exceed 2000 characters'),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'model']),
        text: z.string().max(4000),
      })
    )
    .max(20, 'History cannot exceed 20 turns')
    .optional()
    .default([]),
});
export type RewriteRequest = z.infer<typeof RewriteRequestSchema>;

export type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void | Response | unknown>;
