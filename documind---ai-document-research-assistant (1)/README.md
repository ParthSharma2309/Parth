# DocuMind - AI Document Research Assistant

DocuMind is an evidence-grounded document research assistant that parses real uploaded PDFs, generates vector embeddings, and answers questions with interactive, verifiable page-level citations.

## Architecture

- **Browser-Only Document Lifecycle:**
  - **Parsing:** Powered by PDF.js, extracting text page-by-page while preserving exact 1-based page indices.
  - **Magic Bytes Validation:** Every uploaded file is verified by checking the `%PDF` signature (`0x25, 0x50, 0x44, 0x46`) rather than relying on file extensions.
  - **Chunking:** Text is split into ~800 character windows with ~150 character overlap, strictly confined within individual pages (chunks never span across page boundaries).
  - **Storage:** IndexedDB (via `idb`) persistently stores original PDF blobs, document metadata, chunks, vector embeddings, chat sessions, feedback ratings, and evaluation benchmarks. Everything survives page refreshes and browser restarts.
  - **Retrieval:** Cosine similarity over stored vectors. Broad queries ("summarize", "compare") expand the retrieval budget and balance representation across all selected documents.
  - **Citation Protocol:** Retrieved passages are numbered `[1]`..`[k]` and verified in code. Any model quote is checked against source passage text (normalized whitespace). If unmatched, it is flagged as Unverified. If no valid citations exist, the assistant abstains.
  - **Abstention Discipline:** If top cosine similarity falls below the relevance threshold (default `0.45`) or if insufficient evidence exists, DocuMind returns a clear abstention notice:
    > *"I couldn't find sufficient evidence to answer this question in your selected documents. Try a more specific question or upload a document that covers this topic."*

## Limitations & Privacy

- **No OCR Support:** Scanned images or image-only PDFs without an embedded text layer cannot be parsed (OCR is not supported in browser-only mode). Documents averaging under 50 characters per page are flagged with `"No extractable text (OCR not supported)"`.
- **Data Privacy:** Your full PDF files never leave your device. Only text chunk passages and query embeddings are sent through the server proxy to the Gemini API (`gemini-embedding-2-preview` and `gemini-3.8-flash`).
- **File Limits:** Up to 25 MB per PDF file.
