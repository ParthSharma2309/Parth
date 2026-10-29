# DocuMind — Grounded Document Research Intelligence

DocuMind is an evidence-grounded research assistant that indexes PDFs locally, extracts dense & sparse representations, and synthesizes answers using Google Gemini with strict inline citations verified against source passages.

---

## 1. System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                          BROWSER CLIENT                                │
│                                                                        │
│  ┌────────────────────┐    ┌─────────────────┐    ┌─────────────────┐  │
│  │   PDF.js Parser    │───▶│ Semantic Chunks │───▶│   IndexedDB     │  │
│  │ (Page-level text & │    │  (900c / 180c)  │    │ (Blobs, Chunks, │  │
│  │  Canvas Rendering) │    │                 │    │  Vectors, Chat) │  │
│  └────────────────────┘    └─────────────────┘    └─────────────────┘  │
│            │                                               │           │
│            ▼                                               ▼           │
│  ┌────────────────────┐                          ┌─────────────────┐   │
│  │ Citation Verifier  │                          │ Retrieval Worker│   │
│  │ (Exact substring,  │                          │  (BM25 + RRF +  │   │
│  │  Ellipsis, Shingle)│                          │    MMR Filter)  │   │
│  └────────────────────┘                          └─────────────────┘   │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ HTTP (Proxy Routes)
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        EXPRESS PROXY BACKEND                           │
│                                                                        │
│  • Request Rate Limiting (Token Bucket / Sliding Window)               │
│  • Zod Payload Validation & Parameter Sanitization                     │
│  • Server LRU Vector Embedding Cache (2,000 entries)                  │
│  • Model Fallback Circuit Breaker (503 / 429 auto-recovery)            │
│  • Server-Sent Events (SSE) Streaming Engine                           │
│  • Zero Stack-Trace Leakage Guarantee (Central Error Sanitizer)        │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ Authenticated TLS (Gemini SDK)
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         GOOGLE GEMINI API                              │
│                                                                        │
│  • Embeddings: gemini-embedding-2-preview (dim: 768 / 3072)            │
│  • Generation: gemini-3.8-flash (Primary) ➔ gemini-3.1-flash-lite      │
│  • Vision OCR: High-resolution scanned document extraction             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Chunking, Retrieval & Citation Pipeline

### Step 1: Document Parsing & Cross-Page Chunking
- Documents are parsed page-by-page using PDF.js.
- Text is split into windows of **900 characters** with an overlap of **180 characters**.
- For cross-page continuity, chunks at page boundaries borrow up to **150 characters** from the subsequent page start (`pageBoundaryOverlap`).
- Before sending chunks to `/api/embed`, text is prefixed with `"<document title> · page N"` for superior cross-document semantic relevance, while the original unaltered text is preserved for UI rendering and citation verification.

### Step 2: Single Source of Truth for Chunking
All chunking parameters across the entire platform are governed exclusively by `MODEL_CONFIG` in `src/config/models.ts`:
```typescript
export const MODEL_CONFIG = {
  defaultChunkSize: 900,        // Character window size
  defaultChunkOverlap: 180,     // Intra-page sliding overlap
  pageBoundaryOverlap: 150,     // Inter-page boundary overlap
  defaultTopK: 5,               // Candidate retrieval count
  broadQueryTopK: 12,           // Budget for broad/comparative questions
  maxExpandedPassages: 25,      // Passage limit sent to model
  similarityThresholds: { ... } // Per-model cosine abstention threshold
};
```
*Note: Hardcoded legacy 800/150 values have been removed; all services read from `MODEL_CONFIG`.*

### Step 3: Hybrid Retrieval & Ranking (Web Worker)
1. **BM25 Lexical Scoring**: Implements standard Robertson-Spärck Jones BM25 ($k_1=1.5, b=0.75$) with boundary-aware tokenization, stop-word elimination, and light suffix stemming.
2. **Dense Cosine Dot Product**: Chunks are stored as unit-normalized `Float32Array` vectors. Dot product yields exact cosine similarity in $O(d)$ time.
3. **Reciprocal Rank Fusion (RRF)**: Merges sparse keyword and dense semantic rankings using $RRF(d) = \frac{1}{60 + r_{\text{dense}}} + \frac{1}{60 + r_{\text{bm25}}}$.
4. **Maximal Marginal Relevance (MMR)**: Applies $\lambda=0.7$ diversity re-ranking to prune near-duplicate top passages.
5. **Context Expansion**: Each selected passage automatically attaches its preceding and succeeding chunks (`chunkIndex - 1` and `+ 1`) as extended model context while citations retain their accurate page anchor.
6. **Execution**: Heavy ranking computations run in a dedicated Web Worker (`retrieval.worker.ts`) to maintain smooth 60fps UI responsiveness.

### Step 4: Strict Citation Verification Protocol
Every claim synthesized by the model must cite an inline bracket `[n]`. The client validates each citation:
1. **Index Boundary**: Markers must map to $1 \le n \le k$. Invalid numbers are rejected.
2. **Verbatim Verification**: Checked via exact substring match, whitespace-normalized comparison, ellipsis bridging (`...`), or consecutive word shingles.
3. **Abstention Gate**: If top semantic similarity is below the calibrated threshold or citations fail verification, the assistant gracefully abstains from speculating.

---

## 3. Quickstart & Local Setup

### Prerequisites
- Node.js 22.x LTS or higher
- npm 10.x or higher
- Google Gemini API key ([Get one here](https://aistudio.google.com/))

### Installation Steps

1. **Clone the repository:**
   ```bash
   git clone <repo-url>
   cd documind
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env and set your GEMINI_API_KEY
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Start the development server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

5. **Run test suite:**
   ```bash
   npm run test
   ```

6. **Build for production:**
   ```bash
   npm run build
   npm run start
   ```

---

## 4. Docker Deployment

DocuMind provides a production-grade multi-stage Dockerfile (`node:22-alpine`):

```bash
# 1. Build Docker image
docker build -t documind:latest .

# 2. Run container with healthcheck
docker run -d \
  --name documind \
  -p 3000:3000 \
  -e GEMINI_API_KEY="your-api-key" \
  documind:latest

# 3. Check container health
docker inspect --format='{{json .State.Health}}' documind
```

---

## 5. Environment Variables

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | String | *Required* | API key for Google Gemini model calls |
| `PORT` | Integer | `3000` | Port for Express proxy and Vite dev server |
| `HOST` | String | `0.0.0.0` | Network host binding address |
| `NODE_ENV` | String | `development` | Environment mode (`development`, `production`, `test`) |
| `ALLOWED_ORIGINS` | String | `""` | Comma-separated CORS allowed origins |
| `GEN_MODELS` | String | `gemini-3.8-flash,...` | Generation model fallback hierarchy |
| `EMBED_MODELS` | String | `gemini-embedding-2-preview,...` | Embedding model fallback hierarchy |
| `DEFAULT_GEN_MODEL` | String | `gemini-3.8-flash` | Default generation model |
| `DEFAULT_EMBED_MODEL`| String | `gemini-embedding-2-preview`| Default embedding model |
| `EMBED_DIMENSIONS` | Integer | *(model default)* | Truncated embedding dimension (e.g., `768` for 4x storage savings) |
| `RATE_LIMIT_PER_MIN` | Integer | `60` | Default sliding-window rate limit per minute per IP |
| `TIMEOUT_EMBED` | Integer | `30000` | Timeout in ms for batch embedding requests |
| `TIMEOUT_GENERATE` | Integer | `60000` | Timeout in ms for answer generation requests |
| `TIMEOUT_VISION` | Integer | `90000` | Timeout in ms for page image OCR requests |
| `TIMEOUT_REWRITE` | Integer | `15000` | Timeout in ms for query disambiguation |
| `LOG_LEVEL` | String | `info` | Structured logging verbosity |

---

## 6. Authentication

DocuMind provides dual-mode access with zero auth bypasses:

- **Registered Accounts**: Users authenticate via Firebase Authentication (email/password or Google). Backend `/api` endpoints verify Firebase ID tokens using the Firebase Admin SDK (`verifyIdToken`). No token signatures are skipped, and no hardcoded test/dev users exist.
- **Guest Mode**: Local-first guest sessions are supported via `Authorization: Bearer guest_<id>` or the `X-Guest-Mode: true` header. Guests operate with no cloud identity (`req.user = { kind: 'guest', isGuest: true }`), cannot access Vision OCR (`/api/analyze-page-image` returns 403), and are strictly rate-limited to 15 requests/minute keyed by client IP.
- **Route Protection**: The backend enforces `requireAuth` on all API routes except health checks (`/health`, `/healthz`, `/api/health`), and provides `requireUser` to guard routes that disallow guest access. Responses never leak tokens, user IDs, or stack traces.

---

## 7. Testing, CI/CD & Deployment Gates

DocuMind enforces a rigorous quality and regression pipeline:

- **Unit Tests (`npm test`)**: Vitest suites testing chunking, boundary overlaps, BM25 + RRF ranking, citation verifiers, error classification, zero auth bypasses, and rate limiters.
- **Integration Tests**: Supertest suites verifying Firebase authentication, guest access control, rate limiting, HTTP 400 validation, HTTP 429 Retry-After, model failover, client aborts, and SSE streaming order (`meta` ➔ `delta` ➔ `done`).
- **Zero Leakage Security**: Guaranteed suppression of internal server stack traces from all client error bodies.
- **Evaluation Gate**: Interactive benchmark runner testing citation accuracy. Deployments are flagged if empirical citation accuracy falls below **90%**. Full evaluation runs can be exported as downloadable JSON reports.

