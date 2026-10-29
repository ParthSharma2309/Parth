import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import '../helpers/firebaseAdminMock.js';

// Mock @google/genai before importing server
const mockEmbedContent = vi.fn();
const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();
const mockListModels = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(function (this: any) {
      return {
        models: {
          embedContent: mockEmbedContent,
          generateContent: mockGenerateContent,
          generateContentStream: mockGenerateContentStream,
          list: mockListModels,
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

// Import express app
import { app } from '../../server/index.ts';

describe('Server Integration Tests (with mocked Gemini client)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Validation Errors (400)', () => {
    it('returns 400 when query is missing or empty in /api/generate-answer', async () => {
      const res = await request(app)
        .post('/api/generate-answer')
        .set('Authorization', 'Bearer valid-user-a')
        .send({
          query: '',
          passages: [{ index: 1, text: 'Some passage' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.error).toContain('Query is required');
      expect(res.body.stack).toBeUndefined();
    });

    it('returns 400 when passages array is empty in /api/generate-answer', async () => {
      const res = await request(app)
        .post('/api/generate-answer')
        .set('Authorization', 'Bearer valid-user-a')
        .send({
          query: 'What is the finding?',
          passages: [],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.error).toContain('At least 1 passage is required');
      expect(res.body.stack).toBeUndefined();
    });

    it('returns 400 on invalid payload in /api/embed', async () => {
      const res = await request(app)
        .post('/api/embed')
        .set('Authorization', 'Bearer valid-user-a')
        .send({
          texts: [],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.stack).toBeUndefined();
    });
  });

  describe('Stack Trace Leak Prevention', () => {
    it('guarantees no error body ever contains a stack trace', async () => {
      // Trigger a validation error
      const valRes = await request(app)
        .post('/api/generate-answer')
        .set('Authorization', 'Bearer valid-user-a')
        .send({});
      expect(valRes.body.stack).toBeUndefined();
      expect(JSON.stringify(valRes.body)).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);

      // Trigger not found route or 404
      const notFoundRes = await request(app)
        .post('/api/unknown-endpoint-xyz')
        .set('Authorization', 'Bearer valid-user-a')
        .send({});
      expect(notFoundRes.body?.stack).toBeUndefined();
      expect(JSON.stringify(notFoundRes.body)).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
    });
  });

  describe('Model Fallback', () => {
    it('falls back to secondary model when primary model encounters 503 high demand', async () => {
      // First attempt fails with 503 UNAVAILABLE
      mockGenerateContent.mockRejectedValueOnce({
        status: 503,
        message: 'The model is currently experiencing high demand (503)',
      });

      // Second attempt succeeds with fallback model
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          answerable: true,
          answer: 'Synthesized answer from fallback model [1].',
          citations: [{ marker: 1, quote: 'verbatim passage text' }],
        }),
      });

      const res = await request(app)
        .post('/api/generate-answer')
        .set('Authorization', 'Bearer valid-user-a')
        .send({
          query: 'Explain the architecture.',
          passages: [{ index: 1, text: 'This is the verbatim passage text in detail.' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.answerable).toBe(true);
      expect(res.body.answer).toContain('fallback model');
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      expect(res.body.stack).toBeUndefined();
    });
  });

  describe('SSE Event Order (/api/generate-answer/stream and /api/answer-stream)', () => {
    it('streams events in strict order: meta -> delta -> done', async () => {
      async function* mockStreamGenerator() {
        yield { text: 'The methodology employs ' };
        yield { text: 'rigorous statistical validation [1].\n' };
        yield { text: '<<<CITATIONS>>>[{"marker":1,"quote":"statistical validation"}]' };
      }

      mockGenerateContentStream.mockResolvedValueOnce(mockStreamGenerator());

      const res = await request(app)
        .post('/api/generate-answer/stream')
        .set('Authorization', 'Bearer valid-user-a')
        .send({
          query: 'What methodology was used?',
          passages: [{ index: 1, text: 'Our methodology employs rigorous statistical validation.' }],
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');

      const text = res.text;
      const metaIndex = text.indexOf('event: meta');
      const deltaIndex = text.indexOf('event: delta');
      const doneIndex = text.indexOf('event: done');

      expect(metaIndex).toBeGreaterThanOrEqual(0);
      expect(deltaIndex).toBeGreaterThan(metaIndex);
      expect(doneIndex).toBeGreaterThan(deltaIndex);

      expect(text).toContain('"type":"done"');
      expect(text).toContain('"answerable":true');
      expect(text).not.toContain('<<<CITATIONS>>>');
    });
  });

  describe('Rate Limiting & Headers', () => {
    it('returns 429 and Retry-After header when rate limit is exceeded', async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({
          answerable: true,
          answer: 'Test answer [1].',
          citations: [{ marker: 1, quote: 'text' }],
        }),
      });

      // The generate endpoint limit is 20/min. Send requests rapidly with same X-Forwarded-For IP
      const ip = '192.168.100.42';
      let lastRes: request.Response | null = null;

      for (let i = 0; i < 22; i++) {
        lastRes = await request(app)
          .post('/api/generate-answer')
          .set('X-Forwarded-For', ip)
          .set('Authorization', 'Bearer valid-user-a')
          .send({
            query: `Question probe ${i}`,
            passages: [{ index: 1, text: 'text' }],
          });

        if (lastRes.status === 429) {
          break;
        }
      }

      expect(lastRes).not.toBeNull();
      expect(lastRes!.status).toBe(429);
      expect(lastRes!.headers['retry-after']).toBeDefined();
      expect(lastRes!.headers['ratelimit-limit']).toBeDefined();
      expect(lastRes!.body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(lastRes!.body.stack).toBeUndefined();
    });
  });

  describe('Client Abort Handling', () => {
    it('handles aborted requests cleanly without uncaught exceptions or leaking stack traces', async () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      mockGenerateContent.mockRejectedValue(abortErr);

      const res = await request(app)
        .post('/api/generate-answer')
        .set('Authorization', 'Bearer valid-user-b')
        .send({
          query: 'Long running question',
          passages: [{ index: 1, text: 'pass' }],
        });

      // AbortError formats into 504 Gateway timeout
      expect([504, 500]).toContain(res.status);
      expect(res.body.code).toBe('timeout');
      expect(res.body.stack).toBeUndefined();
    });
  });

  describe('Authentication & Guest Mode Enforcement (Requirement 7)', () => {
    it('returns 403 Forbidden when a guest user attempts to use vision OCR /api/analyze-page-image', async () => {
      const res = await request(app)
        .post('/api/analyze-page-image')
        .set('Authorization', 'Bearer guest_test_123')
        .send({
          imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          mimeType: 'image/jpeg',
          pageNumber: 1,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('GUEST_ACCESS_DENIED');
      expect(res.body.error).toContain('Vision OCR');
      expect(res.body.stack).toBeUndefined();
    });

    it('successfully authorizes valid user token and does not leak X-User-Id header in responses', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          answerable: true,
          answer: 'The verified answer',
          citations: [{ marker: 1, quote: 'Some passage' }],
          confidence: 'high',
        }),
      });

      const res = await request(app)
        .post('/api/generate-answer')
        .set('Authorization', 'Bearer valid-user-b')
        .send({
          query: 'What is the answer?',
          passages: [{ index: 1, text: 'Some passage' }],
        });

      expect(res.status).toBe(200);
      expect(res.headers['x-user-id']).toBeUndefined();
    });

    it('allows access to /api/health without requiring an Authorization header', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });
});
