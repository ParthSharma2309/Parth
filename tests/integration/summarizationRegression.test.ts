import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../helpers/firebaseAdminMock.js';
import { runAnsweringPipeline } from '../../src/services/answering.ts';
import { DocumentRecord, ChunkRecord, SettingsState } from '../../src/types/index.ts';
import { MODEL_CONFIG } from '../../src/config/models.ts';
import * as storage from '../../src/services/storage.ts';
import * as embeddings from '../../src/services/embeddings.ts';
import * as apiClient from '../../src/services/apiClient.ts';

describe('Regression: Document Summarization vs Unsupported Query Honest Abstention', () => {
  const mockDocs: DocumentRecord[] = [
    {
      id: 'doc_dlcd_1',
      name: 'DLCD - Unit 1.pdf',
      size: 1048576,
      pageCount: 15,
      status: 'Ready',
      statusMessage: 'Ready for research inquiry',
      progress: 100,
      processingStep: 'complete',
      extractedCharacters: 8500,
      avgCharactersPerPage: 566,
      uploadedAt: Date.now(),
      modelUsed: 'gemini-embedding-2-preview',
      hasExtractableText: true,
      hasOCR: false,
    },
    {
      id: 'doc_math_2',
      name: 'Calculus.pdf',
      size: 2048576,
      pageCount: 30,
      status: 'Ready',
      statusMessage: 'Ready for research inquiry',
      progress: 100,
      processingStep: 'complete',
      extractedCharacters: 15000,
      avgCharactersPerPage: 500,
      uploadedAt: Date.now(),
      modelUsed: 'gemini-embedding-2-preview',
      hasExtractableText: true,
      hasOCR: false,
    },
    {
      id: 'doc_history_3',
      name: 'ModernHistory.pdf',
      size: 3048576,
      pageCount: 40,
      status: 'Ready',
      statusMessage: 'Ready for research inquiry',
      progress: 100,
      processingStep: 'complete',
      extractedCharacters: 20000,
      avgCharactersPerPage: 500,
      uploadedAt: Date.now(),
      modelUsed: 'gemini-embedding-2-preview',
      hasExtractableText: true,
      hasOCR: false,
    },
  ];

  const mockChunks: ChunkRecord[] = [
    {
      id: 'doc_dlcd_1-p1-c0',
      documentId: 'doc_dlcd_1',
      documentName: 'DLCD - Unit 1.pdf',
      pageNumber: 1,
      chunkIndex: 0,
      text: 'Introduction to Digital Logic Circuits. Boolean algebra provides the fundamental mathematical framework for binary operations.',
      embedding: new Float32Array([0.8, 0.4, 0.2]),
      dim: 3,
      model: 'gemini-embedding-2-preview',
      charStart: 0,
      charEnd: 125,
    },
    {
      id: 'doc_dlcd_1-p2-c1',
      documentId: 'doc_dlcd_1',
      documentName: 'DLCD - Unit 1.pdf',
      pageNumber: 2,
      chunkIndex: 1,
      text: 'Logic gates include AND, OR, NOT, NAND, and NOR gates. Truth tables define the binary input and output relationships.',
      embedding: new Float32Array([0.7, 0.5, 0.3]),
      dim: 3,
      model: 'gemini-embedding-2-preview',
      charStart: 0,
      charEnd: 115,
    },
    {
      id: 'doc_dlcd_1-p15-c2',
      documentId: 'doc_dlcd_1',
      documentName: 'DLCD - Unit 1.pdf',
      pageNumber: 15,
      chunkIndex: 2,
      text: 'Summary: Karnaugh maps simplify complex boolean expressions to minimize gate counts in combinational logic designs.',
      embedding: new Float32Array([0.75, 0.45, 0.25]),
      dim: 3,
      model: 'gemini-embedding-2-preview',
      charStart: 0,
      charEnd: 115,
    },
  ];

  const defaultSettings: SettingsState = {
    chunkSize: 900,
    chunkOverlap: 180,
    topK: 8,
    similarityThreshold: 0.42,
    similarityThresholds: { 'gemini-embedding-2-preview': 0.42 },
    embeddingModel: 'gemini-embedding-2-preview',
    generationModel: 'gemini-3.8-flash',
    maxFileSizeMB: 25,
    darkMode: 'system',
    bm25Weight: 0.5,
    accentTheme: 'sunset',
    reduceMotion: false,
    enableStreaming: true,
    enableHybridSearch: true,
    deskWidthPercent: 44,
    autoSignOutMinutes: 30,
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(storage, 'getAllDocuments').mockResolvedValue(mockDocs);
    vi.spyOn(storage, 'getChunksByDocuments').mockResolvedValue(mockChunks);
    vi.spyOn(embeddings, 'embedQuery').mockImplementation(async (query: string) => {
      if (query.toLowerCase().includes('recursion')) {
        // Orthogonal vector to DLCD content
        return new Float32Array([0.0, 0.0, 1.0]);
      }
      return new Float32Array([0.8, 0.4, 0.2]);
    });
  });

  it('summarizes a selected document (1 of 3) with genuine citations without returning INSUFFICIENT EVIDENCE', async () => {
    // Mock streaming API returning a scholarly summary with inline citations
    vi.spyOn(apiClient, 'authFetch').mockImplementation(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url || '';
      if (url === '/api/suggest-followups') {
        return new Response(JSON.stringify({ followups: ['What is De Morgan law?'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/answer-stream') {
        const streamData = [
          'data: {"type":"delta","text":"## Document Overview\\nThis document introduces digital logic circuits [1]. "}\n\n',
          'data: {"type":"delta","text":"It covers fundamental boolean algebra, primary logic gates [2], and Karnaugh map minimization [3].\\n\\n"}\n\n',
          'data: {"type":"done","answerable":true,"fullText":"## Document Overview\\nThis document introduces digital logic circuits [1]. It covers fundamental boolean algebra, primary logic gates [2], and Karnaugh map minimization [3].","citations":[{"marker":1,"quote":"Introduction to Digital Logic Circuits"},{"marker":2,"quote":"Logic gates include AND, OR, NOT"},{"marker":3,"quote":"Karnaugh maps simplify complex boolean expressions"}]}\n\n',
        ].join('');

        return new Response(streamData, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return new Response('{}', { status: 200 });
    });

    const infoLogs: string[] = [];
    const warnLogs: string[] = [];
    const origInfo = console.info;
    const origWarn = console.warn;
    console.info = (...args: any[]) => {
      infoLogs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
      origInfo(...args);
    };
    console.warn = (...args: any[]) => {
      warnLogs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
      origWarn(...args);
    };

    try {
      const output = await runAnsweringPipeline({
        conversationId: 'conv_test_1',
        userQuestion: 'summarize the document',
        history: [],
        scope: { type: 'selected', documentIds: ['doc_dlcd_1'] },
        settings: defaultSettings,
        availableDocs: mockDocs,
        onStreamToken: vi.fn(),
      });

      // Must succeed with status: 'answered', not 'insufficient_evidence'
      expect(output.status).toBe('answered');
      expect(output.answerText).toContain('## Document Overview');
      expect(output.citations.length).toBeGreaterThan(0);
      expect(output.citations[0].documentId).toBe('doc_dlcd_1');

      // Verify safe diagnostics were logged
      expect(infoLogs.some((l) => l.includes('[DocuMind Diagnostics] Document selection & readiness'))).toBe(true);
      expect(infoLogs.some((l) => l.includes('[DocuMind Diagnostics] Chunks & extracted text'))).toBe(true);
      expect(infoLogs.some((l) => l.includes('[DocuMind Diagnostics] Retrieval & Query evaluation'))).toBe(true);
      expect(infoLogs.some((l) => l.includes('"isSummaryQueryBranch":true'))).toBe(true);
    } finally {
      console.info = origInfo;
      console.warn = origWarn;
    }
  });

  it('triggers honest abstention (RELEVANCE FLOOR NOT MET) for unsupported factual questions (what is recursion)', async () => {
    const infoLogs: string[] = [];
    const warnLogs: string[] = [];
    const origInfo = console.info;
    const origWarn = console.warn;
    console.info = (...args: any[]) => {
      infoLogs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
      origInfo(...args);
    };
    console.warn = (...args: any[]) => {
      warnLogs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
      origWarn(...args);
    };

    try {
      const output = await runAnsweringPipeline({
        conversationId: 'conv_test_2',
        userQuestion: 'what is recursion',
        history: [],
        scope: { type: 'selected', documentIds: ['doc_dlcd_1'] },
        settings: defaultSettings,
        availableDocs: mockDocs,
        onStreamToken: vi.fn(),
      });

      // Must trigger honest abstention with status: 'no_relevant_passages'
      expect(output.status).toBe('no_relevant_passages');
      expect(output.answerText).toBe(MODEL_CONFIG ? output.answerText : '');
      expect(output.citations).toHaveLength(0);

      // Verify diagnostics logged the rejection reason cleanly
      expect(warnLogs.some((l) => l.includes('[DocuMind Diagnostics] Query rejected (Honest Abstention)'))).toBe(true);
      expect(warnLogs.some((l) => l.includes('Relevance floor not met'))).toBe(true);
    } finally {
      console.info = origInfo;
      console.warn = origWarn;
    }
  });

  it('safely merges documents preserving Ready status even when local record has stale processing state', async () => {
    const staleLocalDocs: DocumentRecord[] = [
      {
        ...mockDocs[0],
        status: 'Processing',
      },
    ];

    vi.spyOn(storage, 'getAllDocuments').mockResolvedValue(staleLocalDocs);
    vi.spyOn(apiClient, 'authFetch').mockImplementation(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url || '';
      if (url === '/api/suggest-followups') {
        return new Response(JSON.stringify({ followups: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          answerable: true,
          answer: 'Summary of DLCD from ready merged document [1].',
          citations: [{ marker: 1, quote: 'Boolean algebra provides the fundamental' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const output = await runAnsweringPipeline({
      conversationId: 'conv_test_3',
      userQuestion: 'summarize the document',
      history: [],
      scope: { type: 'selected', documentIds: ['doc_dlcd_1'] },
      settings: defaultSettings,
      availableDocs: mockDocs, // has status: 'Ready'
    });

    // Should not fail with "No ready documents found"
    expect(output.status).toBe('answered');
    expect(output.answerText).toContain('Summary of DLCD');
  });

  it('correctly answers document questions and summarizes known 11-page text document (unti12)', async () => {
    const untiDoc: DocumentRecord = {
      id: 'doc_unti12',
      name: 'unti12.pdf',
      size: 1548576,
      pageCount: 11,
      status: 'Ready',
      statusMessage: 'Ready for research inquiry',
      progress: 100,
      processingStep: 'complete',
      extractedCharacters: 18500,
      avgCharactersPerPage: 1681,
      uploadedAt: Date.now(),
      modelUsed: 'gemini-embedding-2-preview',
      hasExtractableText: true,
      hasOCR: false,
    };

    const untiChunks: ChunkRecord[] = Array.from({ length: 11 }, (_, i) => ({
      id: `doc_unti12-p${i + 1}-c${i}`,
      documentId: 'doc_unti12',
      documentName: 'unti12.pdf',
      pageNumber: i + 1,
      chunkIndex: i,
      text: `Unit 12 Section ${i + 1}: Detailed engineering concepts, operational principles, and systemic analysis for unit ${i + 1}.`,
      embedding: new Float32Array([0.7, 0.4, 0.3]),
      dim: 3,
      model: 'gemini-embedding-2-preview',
      charStart: 0,
      charEnd: 120,
    }));

    vi.spyOn(storage, 'getAllDocuments').mockResolvedValue([untiDoc]);
    vi.spyOn(storage, 'getChunksByDocuments').mockResolvedValue(untiChunks);

    vi.spyOn(apiClient, 'authFetch').mockImplementation(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url || '';
      if (url === '/api/suggest-followups') {
        return new Response(JSON.stringify({ followups: ['What is the core principle of Section 1?'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/answer-stream') {
        const streamData = [
          'data: {"type":"delta","text":"Unit 12 covers foundational engineering concepts [1] and operational analysis [2].\\n\\n"}\n\n',
          'data: {"type":"done","answerable":true,"fullText":"Unit 12 covers foundational engineering concepts [1] and operational analysis [2].","citations":[{"marker":1,"quote":"Unit 12 Section 1: Detailed engineering concepts"},{"marker":2,"quote":"operational principles, and systemic analysis"}]}\n\n',
        ].join('');

        return new Response(streamData, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return new Response('{}', { status: 200 });
    });

    const output = await runAnsweringPipeline({
      conversationId: 'conv_unti12',
      userQuestion: 'what is in this document',
      history: [],
      scope: { type: 'selected', documentIds: ['doc_unti12'] },
      settings: defaultSettings,
      availableDocs: [untiDoc],
      onStreamToken: vi.fn(),
    });

    expect(output.status).toBe('answered');
    expect(output.answerText).toContain('Unit 12 covers');
    expect(output.citations.length).toBeGreaterThan(0);
    expect(output.citations[0].documentId).toBe('doc_unti12');
  });

  it('shows clear actionable error instead of generic abstention when document has no text or chunks', async () => {
    const ocrDoc: DocumentRecord = {
      id: 'doc_oops_unit2',
      name: 'OOPS (UNIT 2) AHEAD.pdf',
      size: 512000,
      pageCount: 1,
      status: 'Failed',
      statusMessage: 'No extractable text or readable images found',
      progress: 100,
      processingStep: 'failed',
      extractedCharacters: 0,
      avgCharactersPerPage: 0,
      uploadedAt: Date.now(),
      modelUsed: 'gemini-embedding-2-preview',
      hasExtractableText: false,
    };

    vi.spyOn(storage, 'getAllDocuments').mockResolvedValue([ocrDoc]);
    vi.spyOn(storage, 'getChunksByDocuments').mockResolvedValue([]);

    const output = await runAnsweringPipeline({
      conversationId: 'conv_ocr_failed',
      userQuestion: 'summarize the document',
      history: [],
      scope: { type: 'selected', documentIds: ['doc_oops_unit2'] },
      settings: defaultSettings,
      availableDocs: [ocrDoc],
    });

    expect(output.status).toBe('insufficient_evidence');
    expect(output.answerText).toContain('OOPS (UNIT 2) AHEAD.pdf');
    expect(output.answerText).toContain('no extractable text');
    expect(output.answerText).toContain('OCR');
  });

  it('does not falsely reject an answer with valid citations even if text mentions insufficient evidence for another point', async () => {
    const outputDoc: DocumentRecord = {
      id: 'doc_corrosion',
      name: 'corrosion_green_chem.pdf',
      size: 1024000,
      pageCount: 2,
      status: 'Ready',
      statusMessage: 'Ready for research inquiry',
      progress: 100,
      processingStep: 'complete',
      extractedCharacters: 4000,
      avgCharactersPerPage: 2000,
      uploadedAt: Date.now(),
      modelUsed: 'gemini-embedding-2-preview',
      hasExtractableText: true,
    };

    const chunks: ChunkRecord[] = [
      {
        id: 'doc_corrosion-p1-c0',
        documentId: 'doc_corrosion',
        documentName: 'corrosion_green_chem.pdf',
        pageNumber: 1,
        chunkIndex: 0,
        text: 'Green corrosion inhibitors utilize plant extracts such as neem and eucalyptus to form a protective adsorption layer on mild steel surfaces.',
        embedding: new Float32Array([0.8, 0.4, 0.2]),
        dim: 3,
        model: 'gemini-embedding-2-preview',
        charStart: 0,
        charEnd: 140,
      },
    ];

    vi.spyOn(storage, 'getAllDocuments').mockResolvedValue([outputDoc]);
    vi.spyOn(storage, 'getChunksByDocuments').mockResolvedValue(chunks);

    vi.spyOn(apiClient, 'authFetch').mockImplementation(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url || '';
      if (url === '/api/suggest-followups') {
        return new Response(JSON.stringify({ followups: ['What plant extracts are used?'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/answer-stream') {
        // Model answers the question with valid citations, but notes there is no relevant evidence for high-temp alloys
        const streamData = [
          'data: {"type":"delta","text":"Green inhibitors like neem extracts form a protective adsorption layer on steel [1]. Note: the provided passages do not contain high-temperature evaluation data."}\n\n',
          'data: {"type":"done","answerable":true,"fullText":"Green inhibitors like neem extracts form a protective adsorption layer on steel [1]. Note: the provided passages do not contain high-temperature evaluation data.","citations":[{"marker":1,"quote":"Green corrosion inhibitors utilize plant extracts"}]}\n\n',
        ].join('');

        return new Response(streamData, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return new Response('{}', { status: 200 });
    });

    const output = await runAnsweringPipeline({
      conversationId: 'conv_corrosion_1',
      userQuestion: 'How do green corrosion inhibitors protect steel surfaces?',
      history: [],
      scope: { type: 'selected', documentIds: ['doc_corrosion'] },
      settings: defaultSettings,
      availableDocs: [outputDoc],
      onStreamToken: vi.fn(),
    });

    // Since it cited supporting evidence from the document with verified quote, it must NOT be marked insufficient_evidence
    expect(output.status).toBe('answered');
    expect(output.citations.length).toBe(1);
    expect(output.citations[0].verified).toBe(true);
  });

  it('correctly parses real SSE streams formatted with event: delta and event: done blocks', async () => {
    vi.spyOn(storage, 'getAllDocuments').mockResolvedValue(mockDocs);
    vi.spyOn(storage, 'getChunksByDocuments').mockResolvedValue(mockChunks);
    vi.spyOn(embeddings, 'embedQuery').mockResolvedValue(new Float32Array([0.8, 0.4, 0.2]));

    const streamedTokens: string[] = [];

    vi.spyOn(apiClient, 'authFetch').mockImplementation(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url || '';
      if (url === '/api/suggest-followups') {
        return new Response(JSON.stringify({ followups: ['What is De Morgan law?'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/answer-stream') {
        // Real Express SSE formatting with event: delta\ndata: ... and event: done\ndata: ...
        const streamData = [
          'event: meta\ndata: {"requestId":"req-1","model":"gemini-3.8-flash"}\n\n',
          'event: delta\ndata: {"type":"delta","text":"This is an overview of digital logic circuits [1]."}\n\n',
          'event: delta\ndata: {"type":"delta","text":" It outlines primary logic gates [2] and minimization techniques [3]."}\n\n',
          'event: done\ndata: {"type":"done","answerable":true,"fullText":"This is an overview of digital logic circuits [1]. It outlines primary logic gates [2] and minimization techniques [3].","citations":[{"marker":1,"quote":"Introduction to Digital Logic Circuits"},{"marker":2,"quote":"Logic gates include AND, OR, NOT"},{"marker":3,"quote":"Karnaugh maps simplify complex boolean expressions"}]}\n\n',
        ].join('');

        return new Response(streamData, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return new Response('{}', { status: 200 });
    });

    const output = await runAnsweringPipeline({
      conversationId: 'conv_sse_test',
      userQuestion: 'summarize this document and explain main topics',
      history: [],
      scope: { type: 'selected', documentIds: ['doc_dlcd_1'] },
      settings: defaultSettings,
      availableDocs: mockDocs,
      onStreamToken: (token) => streamedTokens.push(token),
    });

    expect(output.status).toBe('answered');
    expect(output.answerText).toContain('This is an overview of digital logic circuits [1].');
    expect(output.answerText).toContain('minimization techniques [3].');
    expect(streamedTokens.length).toBeGreaterThan(0);
    expect(streamedTokens.join('')).toContain('This is an overview of digital logic circuits [1].');
    expect(output.citations.length).toBe(3);
    expect(output.citations[0].verified).toBe(true);
  });

  it('falls back to non-streaming /api/answer if stream reader yields empty answer', async () => {
    vi.spyOn(storage, 'getAllDocuments').mockResolvedValue(mockDocs);
    vi.spyOn(storage, 'getChunksByDocuments').mockResolvedValue(mockChunks);
    vi.spyOn(embeddings, 'embedQuery').mockResolvedValue(new Float32Array([0.8, 0.4, 0.2]));

    let fallbackCalled = false;

    vi.spyOn(apiClient, 'authFetch').mockImplementation(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url || '';
      if (url === '/api/suggest-followups') {
        return new Response(JSON.stringify({ followups: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/answer-stream') {
        // Stream returns empty stream
        return new Response('', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      if (url === '/api/answer') {
        fallbackCalled = true;
        return new Response(
          JSON.stringify({
            answerable: true,
            answer: 'Fallback synthesis of digital logic circuits [1].',
            citations: [{ marker: 1, quote: 'Introduction to Digital Logic Circuits' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    });

    const output = await runAnsweringPipeline({
      conversationId: 'conv_fallback_test',
      userQuestion: 'summarize the document',
      history: [],
      scope: { type: 'selected', documentIds: ['doc_dlcd_1'] },
      settings: defaultSettings,
      availableDocs: mockDocs,
      onStreamToken: vi.fn(),
    });

    expect(fallbackCalled).toBe(true);
    expect(output.status).toBe('answered');
    expect(output.answerText).toBe('Fallback synthesis of digital logic circuits [1].');
    expect(output.citations.length).toBe(1);
  });

  it('never returns status: answered with an empty answerText', async () => {
    vi.spyOn(storage, 'getAllDocuments').mockResolvedValue(mockDocs);
    vi.spyOn(storage, 'getChunksByDocuments').mockResolvedValue(mockChunks);
    vi.spyOn(embeddings, 'embedQuery').mockResolvedValue(new Float32Array([0.8, 0.4, 0.2]));

    vi.spyOn(apiClient, 'authFetch').mockImplementation(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url || '';
      if (url === '/api/suggest-followups') {
        return new Response(JSON.stringify({ followups: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/answer-stream') {
        return new Response('', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (url === '/api/answer') {
        // Model unexpectedly returns empty answer string
        return new Response(
          JSON.stringify({
            answerable: true,
            answer: '',
            citations: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    });

    const output = await runAnsweringPipeline({
      conversationId: 'conv_empty_test',
      userQuestion: 'summarize the document',
      history: [],
      scope: { type: 'selected', documentIds: ['doc_dlcd_1'] },
      settings: defaultSettings,
      availableDocs: mockDocs,
      onStreamToken: vi.fn(),
    });

    // Must NOT be status: 'answered' when answerText is empty
    expect(output.status).toBe('insufficient_evidence');
    expect(output.answerText.trim().length).toBeGreaterThan(0);
  });
});
