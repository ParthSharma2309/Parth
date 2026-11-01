// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { DocumentLibrary } from '../../src/components/documents/DocumentLibrary.js';
import { ToastProvider } from '../../src/components/ui/Toast.js';
import { DocumentRecord, CollectionRecord } from '../../src/types/index.js';

// Mock storage and cloudSync services
export const mockDeleteDocument = vi.fn().mockResolvedValue(undefined);
export const mockDeleteCloudDocument = vi.fn().mockResolvedValue(true);
export const mockGetDocumentBlob = vi.fn().mockResolvedValue(null);
export const mockGetChunksByDocument = vi.fn().mockResolvedValue([]);

vi.mock('../../src/services/storage.js', () => ({
  deleteDocument: (id: string) => mockDeleteDocument(id),
  saveDocument: vi.fn(),
  saveChunks: vi.fn(),
  getChunksByDocument: (id: string) => mockGetChunksByDocument(id),
  getDocumentBlob: (id: string) => mockGetDocumentBlob(id),
  saveCollection: vi.fn(),
}));

vi.mock('../../src/services/cloudSync.js', () => ({
  deleteCloudDocument: (id: string) => mockDeleteCloudDocument(id),
  downloadDocumentFile: vi.fn().mockResolvedValue(true),
}));

export const mockRetryProcessDocument = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/docProcessor.js', () => ({
  retryProcessDocument: (id: string, cb?: any) => mockRetryProcessDocument(id, cb),
}));

vi.mock('../../src/lib/firebase.js', () => ({
  auth: { currentUser: null }, // Guest session by default
  isFirebaseConfigured: false,
}));

// Mock Dropzone
vi.mock('../../src/components/documents/Dropzone.js', () => ({
  Dropzone: () => <div data-testid="mock-dropzone">Dropzone Mock</div>,
}));

describe('DocumentLibrary Card & Delete Interactions (tests/unit/documentLibraryInteraction.test.tsx)', () => {
  const sampleDocs: DocumentRecord[] = [
    {
      id: 'doc_1',
      name: 'Quantum Computing Overview.pdf',
      size: 1048576,
      pageCount: 5,
      status: 'Ready',
      uploadedAt: Date.now(),
      modelUsed: 'gemini-embedding-2-preview',
      hasExtractableText: true,
      extractedCharacters: 1200,
      avgCharactersPerPage: 240,
    },
    {
      id: 'doc_2',
      name: 'Machine Learning Survey.pdf',
      size: 2048576,
      pageCount: 12,
      status: 'Ready',
      uploadedAt: Date.now(),
      modelUsed: 'gemini-embedding-2-preview',
      hasExtractableText: true,
      extractedCharacters: 5000,
      avgCharactersPerPage: 416,
    },
    {
      id: 'doc_ocr',
      name: 'Scanned Archive.pdf',
      size: 524288,
      pageCount: 1,
      status: 'Failed',
      uploadedAt: Date.now(),
      modelUsed: 'gemini-embedding-2-preview',
      hasExtractableText: false,
      extractedCharacters: 15,
      avgCharactersPerPage: 15,
    },
  ];

  const sampleCollections: CollectionRecord[] = [];
  const mockRefresh = vi.fn();
  const mockOpenWorkspace = vi.fn();
  const mockOpenInReadingDesk = vi.fn();
  const mockDeleteDocCallback = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = () => {
    return render(
      <ToastProvider>
        <DocumentLibrary
          documents={sampleDocs}
          collections={sampleCollections}
          onRefresh={mockRefresh}
          onOpenDocumentInWorkspace={mockOpenWorkspace}
          onOpenInReadingDesk={mockOpenInReadingDesk}
          onDeleteDocument={mockDeleteDocCallback}
        />
      </ToastProvider>
    );
  };

  it('1. clicking the front-face delete button opens the confirmation modal without flipping the card', async () => {
    renderComponent();

    const card = screen.getByTestId('doc-card-doc_1');
    expect(card.classList.contains('flipped')).toBe(false);

    // Front-face delete button
    const frontDeleteBtn = screen.getByTestId('delete-btn-front-doc_1');
    expect(frontDeleteBtn).toBeTruthy();

    // Click delete button on front face
    fireEvent.click(frontDeleteBtn);

    // Card MUST NOT be flipped
    expect(card.classList.contains('flipped')).toBe(false);

    // Confirmation modal MUST be open displaying document name
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: /Delete Document/i })).toBeTruthy();
    expect(within(dialog).getByText(/Quantum Computing Overview\.pdf/i)).toBeTruthy();
  });

  it('2. clicking the back-face delete button opens the same confirmation modal without flipping the card', async () => {
    renderComponent();

    const card = screen.getByTestId('doc-card-doc_1');

    // First flip the card by clicking the normal card area
    fireEvent.click(card);
    expect(card.classList.contains('flipped')).toBe(true);

    // Back-face delete button
    const backDeleteBtn = screen.getByTestId('delete-btn-back-doc_1');
    expect(backDeleteBtn).toBeTruthy();

    // Click back delete button
    fireEvent.click(backDeleteBtn);

    // Card MUST remain in its current state (flipped) without toggling back
    expect(card.classList.contains('flipped')).toBe(true);

    // Modal MUST be open
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText(/Quantum Computing Overview\.pdf/i)).toBeTruthy();
  });

  it('3. clicking the normal card area still flips the card back and forth', async () => {
    renderComponent();

    const card = screen.getByTestId('doc-card-doc_1');
    expect(card.classList.contains('flipped')).toBe(false);

    // Click card body -> flips to back
    fireEvent.click(card);
    expect(card.classList.contains('flipped')).toBe(true);

    // Modal is NOT open
    expect(screen.queryByRole('dialog')).toBeNull();

    // Click card body again -> flips back to front
    fireEvent.click(card);
    expect(card.classList.contains('flipped')).toBe(false);
  });

  it('4. clicking Cancel closes the modal without deleting anything', async () => {
    renderComponent();

    const frontDeleteBtn = screen.getByTestId('delete-btn-front-doc_1');
    fireEvent.click(frontDeleteBtn);

    expect(screen.getByRole('dialog')).toBeTruthy();

    // Click Cancel
    const cancelBtn = screen.getByTestId('cancel-delete-btn');
    fireEvent.click(cancelBtn);

    // Modal is dismissed
    expect(screen.queryByRole('dialog')).toBeNull();

    // Delete functions were NOT called
    expect(mockDeleteDocument).not.toHaveBeenCalled();
    expect(mockDeleteDocCallback).not.toHaveBeenCalled();
  });

  it('5. confirming deletion calls the deletion handler exactly once and triggers UI refresh', async () => {
    renderComponent();

    const frontDeleteBtn = screen.getByTestId('delete-btn-front-doc_1');
    fireEvent.click(frontDeleteBtn);

    const confirmBtn = screen.getByTestId('confirm-delete-btn');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      // deleteDocument was called exactly once for doc_1
      expect(mockDeleteDocument).toHaveBeenCalledTimes(1);
      expect(mockDeleteDocument).toHaveBeenCalledWith('doc_1');
      expect(mockDeleteDocCallback).toHaveBeenCalledTimes(1);
      expect(mockDeleteDocCallback).toHaveBeenCalledWith('doc_1');
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    // Modal is closed after successful deletion
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('6. card retains visibility and does NOT have the reveal class on the card container that caused opacity loss', () => {
    renderComponent();

    const card = screen.getByTestId('doc-card-doc_1');
    // Ensure the card container does NOT have 'reveal' directly on it (which caused the card to vanish when re-rendered)
    expect(card.classList.contains('reveal')).toBe(false);
    expect(card.classList.contains('fl')).toBe(true);

    // Flip card
    fireEvent.click(card);
    expect(card.classList.contains('flipped')).toBe(true);
    expect(card.classList.contains('reveal')).toBe(false);

    // Verify content is still present and accessible
    expect(screen.getByText('Quantum Computing Overview.pdf')).toBeTruthy();
  });

  it('7. repeated flips never remove or filter out any document from the list', () => {
    renderComponent();

    const card = screen.getByTestId('doc-card-doc_1');

    // Perform multiple rapid flips
    for (let i = 0; i < 6; i++) {
      fireEvent.click(card);
    }

    // Both doc_1 and doc_2 remain in the DOM
    expect(screen.getByTestId('doc-card-doc_1')).toBeTruthy();
    expect(screen.getByTestId('doc-card-doc_2')).toBeTruthy();
    expect(mockDeleteDocument).not.toHaveBeenCalled();
    expect(mockDeleteDocCallback).not.toHaveBeenCalled();
  });

  it('8. other document cards remain unaffected when one card is flipped', () => {
    renderComponent();

    const card1 = screen.getByTestId('doc-card-doc_1');
    const card2 = screen.getByTestId('doc-card-doc_2');

    expect(card1.classList.contains('flipped')).toBe(false);
    expect(card2.classList.contains('flipped')).toBe(false);

    // Flip card 1
    fireEvent.click(card1);

    expect(card1.classList.contains('flipped')).toBe(true);
    expect(card2.classList.contains('flipped')).toBe(false); // card 2 unaffected

    // Flip card 2
    fireEvent.click(card2);

    expect(card1.classList.contains('flipped')).toBe(false); // card 1 collapses as card 2 expands
    expect(card2.classList.contains('flipped')).toBe(true);
  });

  it('9. keyboard navigation (Enter/Space) flips card reliably without triggering delete', () => {
    renderComponent();

    const card = screen.getByTestId('doc-card-doc_1');
    expect(card.classList.contains('flipped')).toBe(false);

    // Press Enter on card
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(card.classList.contains('flipped')).toBe(true);

    // Modal is NOT open
    expect(screen.queryByRole('dialog')).toBeNull();

    // Press Space on card
    fireEvent.keyDown(card, { key: ' ' });
    expect(card.classList.contains('flipped')).toBe(false);

    expect(mockDeleteDocument).not.toHaveBeenCalled();
  });

  it('10. parent doc-grid does NOT have reveal class to prevent grid invisibility after re-renders', () => {
    renderComponent();

    const card = screen.getByTestId('doc-card-doc_1');
    const parentGrid = card.parentElement;
    expect(parentGrid).toBeTruthy();
    expect(parentGrid?.classList.contains('doc-grid')).toBe(true);
    // Grid must not depend on imperative reveal/visible class
    expect(parentGrid?.classList.contains('reveal')).toBe(false);
  });

  it('11. mobile touch interaction on delete buttons stops propagation and opens modal without flipping', () => {
    renderComponent();

    const card = screen.getByTestId('doc-card-doc_1');
    const frontDeleteBtn = screen.getByTestId('delete-btn-front-doc_1');

    // Simulate mobile touch sequence: touchstart -> touchend -> click
    fireEvent.touchStart(frontDeleteBtn);
    fireEvent.touchEnd(frontDeleteBtn);
    fireEvent.click(frontDeleteBtn);

    // Card did NOT flip
    expect(card.classList.contains('flipped')).toBe(false);

    // Modal opened
    expect(screen.getByRole('dialog')).toBeTruthy();

    // Dismiss modal
    fireEvent.click(screen.getByTestId('cancel-delete-btn'));
    expect(screen.queryByRole('dialog')).toBeNull();

    // Now flip card to back
    fireEvent.click(card);
    expect(card.classList.contains('flipped')).toBe(true);

    // Test back-face delete with touch sequence
    const backDeleteBtn = screen.getByTestId('delete-btn-back-doc_1');
    fireEvent.touchStart(backDeleteBtn);
    fireEvent.touchEnd(backDeleteBtn);
    fireEvent.click(backDeleteBtn);

    // Card remains flipped, did not flip back
    expect(card.classList.contains('flipped')).toBe(true);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('12. repeatedly flipping back and forth preserves document data and DOM presence', () => {
    renderComponent();

    const card = screen.getByTestId('doc-card-doc_1');

    // 10 cycles of flipping
    for (let i = 0; i < 10; i++) {
      fireEvent.click(card);
      expect(card.classList.contains('flipped')).toBe(true);
      fireEvent.click(card);
      expect(card.classList.contains('flipped')).toBe(false);
    }

    // Still in document list with correct details
    expect(screen.getByText('Quantum Computing Overview.pdf')).toBeTruthy();
    expect(within(card).getAllByText(/5 pages/i).length).toBeGreaterThan(0);
    expect(mockDeleteDocument).not.toHaveBeenCalled();
  });

  it('13. clicking Run OCR on front face triggers retryProcessDocument and does not flip the card', async () => {
    renderComponent();

    const ocrCard = screen.getByTestId('doc-card-doc_ocr');
    expect(ocrCard.classList.contains('flipped')).toBe(false);

    const runOcrFront = screen.getByTestId('run-ocr-front-doc_ocr');
    expect(runOcrFront).toBeTruthy();

    fireEvent.click(runOcrFront);

    await waitFor(() => {
      expect(mockRetryProcessDocument).toHaveBeenCalledTimes(1);
      expect(mockRetryProcessDocument).toHaveBeenCalledWith('doc_ocr', expect.any(Function));
    });

    // Card MUST remain unflipped
    expect(ocrCard.classList.contains('flipped')).toBe(false);
  });

  it('14. clicking Run OCR on back face triggers retryProcessDocument and preserves flipped state', async () => {
    renderComponent();

    const ocrCard = screen.getByTestId('doc-card-doc_ocr');

    // Flip card to back
    fireEvent.click(ocrCard);
    expect(ocrCard.classList.contains('flipped')).toBe(true);

    const runOcrBack = screen.getByTestId('run-ocr-back-doc_ocr');
    expect(runOcrBack).toBeTruthy();

    fireEvent.click(runOcrBack);

    await waitFor(() => {
      expect(mockRetryProcessDocument).toHaveBeenCalledTimes(1);
      expect(mockRetryProcessDocument).toHaveBeenCalledWith('doc_ocr', expect.any(Function));
    });

    // Card MUST remain flipped
    expect(ocrCard.classList.contains('flipped')).toBe(true);
  });

  it('15. Run OCR prevents duplicate execution while already in progress', async () => {
    // Return a pending promise to simulate in-flight OCR job
    let resolveJob: () => void = () => {};
    mockRetryProcessDocument.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveJob = resolve; })
    );

    renderComponent();

    const runOcrFront = screen.getByTestId('run-ocr-front-doc_ocr');

    // First click triggers OCR
    fireEvent.click(runOcrFront);
    expect(mockRetryProcessDocument).toHaveBeenCalledTimes(1);

    // Second immediate click should be ignored while running
    fireEvent.click(runOcrFront);
    expect(mockRetryProcessDocument).toHaveBeenCalledTimes(1);

    // Resolve the job
    resolveJob();
  });

  it('16. clicking Reading Desk on front face calls onOpenInReadingDesk with correct doc ID without flipping', () => {
    renderComponent();

    const card = screen.getByTestId('doc-card-doc_1');
    expect(card.classList.contains('flipped')).toBe(false);

    const deskFrontBtn = screen.getByTestId('open-desk-front-doc_1');
    expect(deskFrontBtn).toBeTruthy();

    fireEvent.click(deskFrontBtn);

    // Reading desk handler called with doc_1
    expect(mockOpenInReadingDesk).toHaveBeenCalledTimes(1);
    expect(mockOpenInReadingDesk).toHaveBeenCalledWith('doc_1');

    // Card did NOT flip
    expect(card.classList.contains('flipped')).toBe(false);
  });

  it('17. clicking Open in Reading Desk on back face calls onOpenInReadingDesk with correct doc ID without flipping back', () => {
    renderComponent();

    const card = screen.getByTestId('doc-card-doc_1');

    // Flip card first
    fireEvent.click(card);
    expect(card.classList.contains('flipped')).toBe(true);

    const deskBackBtn = screen.getByTestId('open-desk-back-doc_1');
    expect(deskBackBtn).toBeTruthy();

    fireEvent.click(deskBackBtn);

    // Reading desk handler called with doc_1
    expect(mockOpenInReadingDesk).toHaveBeenCalledTimes(1);
    expect(mockOpenInReadingDesk).toHaveBeenCalledWith('doc_1');

    // Card remains flipped (did not flip back to front)
    expect(card.classList.contains('flipped')).toBe(true);
  });
});
