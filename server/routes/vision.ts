import express, { Router, Request } from 'express';
import { z } from 'zod';
import { env } from '../lib/env.js';
import {
  getAI,
  generateWithFallback,
  getVisionModelCandidates,
  createRequestAbortController,
} from '../lib/gemini.js';
import { rateLimit } from '../lib/rateLimit.js';
import { formatZodError } from '../lib/errors.js';

export const visionRouter = Router();

// Per-route rate limit: vision 30/min (Requirement 6)
const visionLimiter = rateLimit({ windowMs: 60000, max: 30 });

// Requirement 5: 30mb limit ONLY on /api/analyze-page-image
const json30mb = express.json({ limit: '30mb' });

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

// Requirement 5: Zod validation for types, max lengths, mime types image/png|jpeg|webp
const VisionRequestSchema = z.object({
  imageBase64: z
    .string()
    .min(1, 'imageBase64 string is required and cannot be empty')
    .max(40000000, 'imageBase64 exceeds maximum allowed size (30MB)'),
  mimeType: z
    .enum(ALLOWED_MIME_TYPES)
    .optional()
    .default('image/jpeg'),
  pageNumber: z.coerce.number().int().min(1).optional().default(1),
});

visionRouter.post(
  '/api/analyze-page-image',
  json30mb,
  visionLimiter,
  async (req: Request, res, next) => {
    const requestId = (res.getHeader('X-Request-Id') as string) || (req.id ? String(req.id) : '');
    // 3 & 5. Cancellation & 90s timeout (Requirement 3 & 5)
    const { signal } = createRequestAbortController(req, res, env.TIMEOUT_VISION);

    try {
      const parseResult = VisionRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        const formatted = formatZodError(parseResult.error, req, res);
        return res.status(400).json(formatted);
      }

      const { imageBase64, mimeType, pageNumber } = parseResult.data;

      // Clean base64 data prefix if present
      const cleanBase64 = imageBase64.includes(',')
        ? imageBase64.split(',')[1].trim()
        : imageBase64.trim();

      const prompt = `You are DocuMind's document vision intelligence engine.
Analyze this document page (Page ${pageNumber}) thoroughly for document research, semantic search, and verifiable citations.

Execute two essential tasks:
1. FULL TEXT & OCR TRANSCRIPTION:
- Read and transcribe ALL visible text, labels, numbers, table cells, headers, captions, annotations, and footnotes present on this page or within images/figures.
- Transcribe data values, metrics, percentages, equations, and flowchart node text verbatim.

2. WHOLE-IMAGE & VISUAL FIGURE COMPREHENSION:
- Comprehend and explain all visual figures in whole: architectural diagrams, flowcharts, data graphs, bar/line charts, infographics, tables, schema layouts, or photos.
- Provide a clear, comprehensive description explaining what each figure depicts as a whole, including key components, relationships, directional flows/arrows, quantitative trends, legends, and takeaways.

Format your output clearly:
[VISUAL FIGURES & IMAGES IN WHOLE]:
(Detailed description and visual analysis of the diagrams, charts, schemas, or figures)

[EXTRACTED TEXT & DATA FROM IMAGES]:
(Verbatim transcript of all textual content, tables, and data points)`;

      // 2. generateWithFallback replacing duplicated isTemporary blocks (Requirement 1 & 2)
      const { response, usedModel } = await generateWithFallback({
        models: getVisionModelCandidates(),
        signal,
        requestId,
        build: async (targetModel, attemptSignal) => {
          const ai = getAI(env.TIMEOUT_VISION);
          return await ai.models.generateContent({
            model: targetModel,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: cleanBase64,
                  },
                },
                {
                  text: prompt,
                },
              ],
            },
            config: {
              temperature: 0.1,
              abortSignal: attemptSignal || signal,
            },
          });
        },
      });

      const text = response?.text ? response.text.trim() : '';
      return res.json({
        text,
        pageNumber,
        model: usedModel,
        hasContent: text.length > 0,
      });
    } catch (error) {
      next(error);
    }
  }
);
