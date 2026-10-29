import React from 'react';
import { Citation } from '../../types/index.ts';

interface SafeMarkdownProps {
  content: string;
  onCitationClick?: (marker: number) => void;
  activeMarker?: number | null;
  citations?: Citation[];
}

/**
 * Renders markdown text safely with DocuMind exact styling:
 * - Inline citations rendered as round pink pills (.cit-chip, doc-2 uses var(--a1))
 * - Highlighted evidence via <mark>
 * - Clean headers and lists
 */
export const SafeMarkdown: React.FC<SafeMarkdownProps> = ({
  content,
  onCitationClick,
  activeMarker,
  citations,
}) => {
  // Split into paragraphs / lines
  const blocks = content.split(/\n\n+/);

  return (
    <div className="space-y-4 text-[var(--ink)] leading-[1.7] font-sans text-[15px] max-w-full overflow-hidden">
      {blocks.map((block, bIdx) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        // Code blocks with properly scoped overflow
        if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
          const codeContent = trimmed.replace(/^```[a-z]*\n?/, '').replace(/```$/, '');
          return (
            <pre
              key={bIdx}
              className="p-4 bg-[var(--card-subtle)] text-[var(--ink)] rounded-[0_8px_8px_8px] text-xs font-mono overflow-x-auto my-3 border border-[var(--line)] max-w-full min-w-0"
            >
              <code>{codeContent}</code>
            </pre>
          );
        }

        // Headers
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={bIdx} className="font-serif text-base font-semibold text-[var(--ink)] pt-3 pb-1">
              {renderInline(trimmed.slice(4), onCitationClick, activeMarker, citations)}
            </h4>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={bIdx} className="font-serif text-lg font-semibold text-[var(--ink)] pt-4 pb-1.5 border-b border-[var(--line)]">
              {renderInline(trimmed.slice(3), onCitationClick, activeMarker, citations)}
            </h3>
          );
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h2 key={bIdx} className="font-serif text-xl font-semibold text-[var(--ink)] pt-5 pb-2">
              {renderInline(trimmed.slice(2), onCitationClick, activeMarker, citations)}
            </h2>
          );
        }

        // Blockquotes / Quoted evidence
        if (trimmed.startsWith('> ')) {
          return (
            <blockquote
              key={bIdx}
              className="border-l-3 border-[var(--sun)] pl-4 py-2 italic text-[var(--ink)] bg-[var(--sun)]/15 my-3 rounded-r-[4px] break-words"
            >
              <mark>
                {renderInline(trimmed.slice(2), onCitationClick, activeMarker, citations)}
              </mark>
            </blockquote>
          );
        }

        // Bullet lists
        if (trimmed.split('\n').every((line) => line.trim().startsWith('- ') || line.trim().startsWith('* '))) {
          const items = trimmed.split('\n').filter((l) => l.trim().length > 0);
          return (
            <ul key={bIdx} className="list-disc pl-5 space-y-1.5 text-[var(--ink)] break-words">
              {items.map((item, itemIdx) => {
                const text = item.replace(/^[-*]\s+/, '');
                return (
                  <li key={itemIdx}>
                    {renderInline(text, onCitationClick, activeMarker, citations)}
                  </li>
                );
              })}
            </ul>
          );
        }

        // Numbered lists
        if (trimmed.split('\n').every((line) => /^\d+\.\s+/.test(line.trim()))) {
          const items = trimmed.split('\n').filter((l) => l.trim().length > 0);
          return (
            <ol key={bIdx} className="list-decimal pl-5 space-y-1.5 text-[var(--ink)] break-words">
              {items.map((item, itemIdx) => {
                const text = item.replace(/^\d+\.\s+/, '');
                return (
                  <li key={itemIdx}>
                    {renderInline(text, onCitationClick, activeMarker, citations)}
                  </li>
                );
              })}
            </ol>
          );
        }

        // Regular paragraph
        return (
          <p key={bIdx} className="break-words leading-relaxed overflow-wrap-anywhere">
            {renderInline(trimmed, onCitationClick, activeMarker, citations)}
          </p>
        );
      })}
    </div>
  );
};

/**
 * Safely parses inline formatting:
 * - Citation markers: [1], [2] rendered as .cit-chip (round pink pill, doc-2 uses var(--a1))
 * - Highlighted evidence: ==text== rendered as <mark>
 * - Markdown links: [link text](url)
 * - Bold: **text**
 * - Inline code: `text`
 */
function renderInline(
  text: string,
  onCitationClick?: (marker: number) => void,
  activeMarker?: number | null,
  citations?: Citation[]
): React.ReactNode[] {
  const tokenRegex = /(\[(\d+)\])|(==([^=]+)==)|(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const uniqueDocs = citations ? Array.from(new Set(citations.map((c) => c.documentId || c.documentName))) : [];

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.substring(lastIndex, match.index));
    }

    if (match[1]) {
      // Citation marker: [N]
      const markerNum = parseInt(match[2], 10);
      const isActive = activeMarker === markerNum;
      const cit = citations?.find((c) => c.marker === markerNum);
      const isSecondDoc = cit ? uniqueDocs.indexOf(cit.documentId || cit.documentName) === 1 : false;

      nodes.push(
        <button
          key={`cit-${match.index}`}
          type="button"
          onClick={() => onCitationClick?.(markerNum)}
          className={`cit-chip ${isSecondDoc ? 'doc-2' : ''} ${isActive ? 'ring-2 ring-[var(--ink)]' : ''}`}
          title={`Citation [${markerNum}]${cit ? `: ${cit.documentName} (p.${cit.pageNumber})` : ''}`}
          aria-label={`Citation ${markerNum}`}
        >
          {markerNum}
        </button>
      );
    } else if (match[3]) {
      // Highlight: ==text==
      nodes.push(
        <mark key={`mark-${match.index}`}>
          {match[4]}
        </mark>
      );
    } else if (match[5]) {
      // Markdown link: [text](url)
      const linkText = match[6];
      const rawUrl = match[7].trim();
      const isSafe = /^(https?:\/\/|mailto:|#)/i.test(rawUrl);
      const isExternal = /^https?:\/\//i.test(rawUrl);

      if (isSafe) {
        nodes.push(
          <a
            key={`link-${match.index}`}
            href={rawUrl}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noopener noreferrer' : undefined}
            className="text-[var(--a1)] hover:opacity-80 underline underline-offset-3 break-all font-medium transition-colors"
          >
            {linkText}
          </a>
        );
      } else {
        nodes.push(linkText);
      }
    } else if (match[8]) {
      // Bold text
      nodes.push(
        <strong key={`bold-${match.index}`} className="font-semibold text-[var(--ink)]">
          {match[9]}
        </strong>
      );
    } else if (match[10]) {
      // Inline code
      nodes.push(
        <code
          key={`code-${match.index}`}
          className="bg-[var(--card-subtle)] text-[var(--ink)] text-xs px-1.5 py-0.5 rounded-[3px] font-mono border border-[var(--line)] break-words"
        >
          {match[11]}
        </code>
      );
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.substring(lastIndex));
  }

  return nodes;
}
