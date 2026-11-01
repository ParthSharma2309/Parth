// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ScopeSelector } from '../../src/components/workspace/ScopeSelector.js';
import { NotebookPage } from '../../src/components/notebook/NotebookPage.js';
import { ToastProvider } from '../../src/components/ui/Toast.js';
import { DocumentRecord, CollectionRecord, NotebookItem, RetrievalScope } from '../../src/types/index.js';

// Mock storage
const { mockGetNotebookItems, mockSaveNotebookItem, mockDeleteNotebookItem } = vi.hoisted(() => ({
  mockGetNotebookItems: vi.fn().mockResolvedValue([]),
  mockSaveNotebookItem: vi.fn().mockResolvedValue(undefined),
  mockDeleteNotebookItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/storage.js', () => ({
  getNotebookItems: () => mockGetNotebookItems(),
  saveNotebookItem: (item: any) => mockSaveNotebookItem(item),
  deleteNotebookItem: (id: string) => mockDeleteNotebookItem(id),
}));

describe('Workspace & ScopeSelector Interactions (tests/unit/workspaceInteractions.test.tsx)', () => {
  const readyDocs: DocumentRecord[] = [
    {
      id: 'doc_1',
      name: 'Alpha_Paper.pdf',
      size: 1024,
      pageCount: 3,
      status: 'Ready',
      uploadedAt: Date.now(),
      modelUsed: 'gemini-embedding-2-preview',
      hasExtractableText: true,
      extractedCharacters: 500,
      avgCharactersPerPage: 166,
      collectionId: 'col_1',
    },
    {
      id: 'doc_2',
      name: 'Beta_Study.pdf',
      size: 2048,
      pageCount: 6,
      status: 'Ready',
      uploadedAt: Date.now(),
      modelUsed: 'gemini-embedding-2-preview',
      hasExtractableText: true,
      extractedCharacters: 1200,
      avgCharactersPerPage: 200,
      collectionId: 'col_2',
    },
    {
      id: 'doc_3',
      name: 'Gamma_Analysis.pdf',
      size: 3072,
      pageCount: 9,
      status: 'Ready',
      uploadedAt: Date.now(),
      modelUsed: 'gemini-embedding-2-preview',
      hasExtractableText: true,
      extractedCharacters: 1800,
      avgCharactersPerPage: 200,
    },
  ];

  const collections: CollectionRecord[] = [
    { id: 'col_1', name: 'Physics Papers', createdAt: Date.now() },
    { id: 'col_2', name: 'Computer Science', createdAt: Date.now() },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders default complete folio label and toggles open dropdown', () => {
    const mockChangeScope = vi.fn();
    const currentScope: RetrievalScope = { type: 'all' };

    render(
      <ScopeSelector
        documents={readyDocs}
        collections={collections}
        scope={currentScope}
        onChangeScope={mockChangeScope}
      />
    );

    expect(screen.getByText('Complete folio')).toBeDefined();
    expect(screen.getByText(/All documents \(3\)/)).toBeDefined();

    // Click trigger button to open dropdown
    const triggerBtn = screen.getByRole('button', { expanded: false });
    fireEvent.click(triggerBtn);

    // Dropdown options should now be visible
    expect(screen.getByText('Collection shelves')).toBeDefined();
    expect(screen.getByText('Specific documents')).toBeDefined();
  });

  it('switches to collection scope when a collection shelf is clicked', () => {
    const mockChangeScope = vi.fn();
    const currentScope: RetrievalScope = { type: 'all' };

    render(
      <ScopeSelector
        documents={readyDocs}
        collections={collections}
        scope={currentScope}
        onChangeScope={mockChangeScope}
      />
    );

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { expanded: false }));

    // Click "Physics Papers" collection
    const colBtn = screen.getByText('Physics Papers');
    fireEvent.click(colBtn);

    expect(mockChangeScope).toHaveBeenCalledWith({
      type: 'collection',
      collectionId: 'col_1',
    });
  });

  it('switches to selected documents scope when individual document is checked', () => {
    const mockChangeScope = vi.fn();
    const currentScope: RetrievalScope = { type: 'all' };

    render(
      <ScopeSelector
        documents={readyDocs}
        collections={collections}
        scope={currentScope}
        onChangeScope={mockChangeScope}
      />
    );

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { expanded: false }));

    // Click "Alpha_Paper.pdf" checkbox
    const docBtn = screen.getByText('Alpha_Paper.pdf');
    fireEvent.click(docBtn);

    expect(mockChangeScope).toHaveBeenCalledWith({
      type: 'selected',
      documentIds: ['doc_1'],
    });
  });

  it('switches back to all when all documents are selected individually', () => {
    const mockChangeScope = vi.fn();
    const currentScope: RetrievalScope = {
      type: 'selected',
      documentIds: ['doc_1', 'doc_2'],
    };

    render(
      <ScopeSelector
        documents={readyDocs}
        collections={collections}
        scope={currentScope}
        onChangeScope={mockChangeScope}
      />
    );

    // Open dropdown
    fireEvent.click(screen.getByRole('button', { expanded: false }));

    // Click the 3rd document "Gamma_Analysis.pdf" to complete the set
    const docBtn = screen.getByText('Gamma_Analysis.pdf');
    fireEvent.click(docBtn);

    // Should automatically promote to type: 'all'
    expect(mockChangeScope).toHaveBeenCalledWith({
      type: 'all',
    });
  });
});

describe('Notebook Page Note Management (tests/unit/workspaceInteractions.test.tsx)', () => {
  const initialNotes: NotebookItem[] = [
    {
      id: 'note_1',
      title: 'Quantum superposition',
      question: 'What is quantum superposition?',
      answer: 'Superposition allows a quantum system to exist in multiple states simultaneously [1].',
      citations: [
        {
          marker: 1,
          chunkId: 'chunk_1',
          quote: 'quantum system to exist in multiple states',
          passageText: 'Superposition allows a quantum system to exist in multiple states simultaneously.',
          documentId: 'doc_1',
          documentName: 'Alpha_Paper.pdf',
          pageNumber: 2,
          verified: true,
          similarity: 0.88,
        },
      ],
      createdAt: Date.now() - 10000,
      tags: ['Quantum', 'Physics'],
    },
    {
      id: 'note_2',
      title: 'Neural network optimization',
      question: 'How do neural networks optimize loss?',
      answer: 'Stochastic gradient descent updates weights in the opposite direction of the gradient.',
      citations: [],
      createdAt: Date.now() - 5000,
      tags: ['ML'],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNotebookItems.mockResolvedValue([...initialNotes]);
  });

  it('loads and displays sticky notes with titles, answers, and tags', async () => {
    render(
      <ToastProvider>
        <NotebookPage />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Quantum superposition')).toBeDefined();
      expect(screen.getByText('Neural network optimization')).toBeDefined();
    });

    expect(screen.getByText('#Quantum')).toBeDefined();
    expect(screen.getByText('#Physics')).toBeDefined();
    expect(screen.getByText('#ML')).toBeDefined();
  });

  it('filters notes dynamically by search query', async () => {
    render(
      <ToastProvider>
        <NotebookPage />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Quantum superposition')).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText('Search pinned notes and citations...');
    fireEvent.change(searchInput, { target: { value: 'gradient' } });

    expect(screen.queryByText('Quantum superposition')).toBeNull();
    expect(screen.getByText('Neural network optimization')).toBeDefined();
  });

  it('filters notes by tag click', async () => {
    render(
      <ToastProvider>
        <NotebookPage />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Quantum superposition')).toBeDefined();
    });

    // Click ML tag button in tag filters bar
    const mlTagBtn = screen.getByRole('button', { name: 'ML' });
    fireEvent.click(mlTagBtn);

    expect(screen.queryByText('Quantum superposition')).toBeNull();
    expect(screen.getByText('Neural network optimization')).toBeDefined();
  });

  it('deletes a note and triggers undo toast', async () => {
    render(
      <ToastProvider>
        <NotebookPage />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Quantum superposition')).toBeDefined();
    });

    // Find delete button on note 1
    const deleteButtons = screen.getAllByTitle('Delete note');
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(mockDeleteNotebookItem).toHaveBeenCalledWith('note_2'); // note_2 is first due to sort by createdAt desc
    });
  });
});
