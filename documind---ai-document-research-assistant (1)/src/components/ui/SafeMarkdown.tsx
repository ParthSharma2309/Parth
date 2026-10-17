import React from 'react';

interface SafeMarkdownProps {
  content: string;
  onCitationClick?: (marker: number) => void;
  activeMarker?: number | null;
}

/**
 * Renders markdown text safely without dangerouslySetInnerHTML,
 * strips unsafe HTML and remote images, and transforms [1], [2] citation markers
 * into interactive vermilion citation chips.
 */
export const SafeMarkdown: React.FC<SafeMarkdownProps> = ({
  content,
  onCitationClick,
  activeMarker,
}) => {
  // Split into paragraphs / lines
  const blocks = content.split(/\n\n+/);

  return (
    <div className="space-y-3.5 text-[#f2efeb] leading-[1.65] font-sans text-sm max-w-full overflow-hidden">
      {blocks.map((block, bIdx) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        // Code blocks with properly scoped overflow
        if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
          const codeContent = trimmed.replace(/^```[a-z]*\n?/, '').replace(/```$/, '');
          return (
            <pre
              key={bIdx}
              className="p-3.5 bg-[#0e0e0f] text-[#f2efeb] rounded-[4px] text-xs font-mono overflow-x-auto my-2.5 border border-[rgba(242,239,235,0.15)] max-w-full min-w-0"
            >
              <code>{codeContent}</code>
            </pre>
          );
        }

        // Headers
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={bIdx} className="font-syne text-sm font-bold text-[#f2efeb] uppercase pt-2 pb-0.5 tracking-tight">
              {renderInline(trimmed.slice(4), onCitationClick, activeMarker)}
            </h4>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={bIdx} className="font-syne text-base font-bold text-[#f2efeb] uppercase pt-3 pb-1 border-b border-[rgba(242,239,235,0.1)] tracking-tight">
              {renderInline(trimmed.slice(3), onCitationClick, activeMarker)}
            </h3>
          );
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h2 key={bIdx} className="font-syne text-lg font-extrabold text-[#f2efeb] uppercase pt-4 pb-1.5 tracking-tight">
              {renderInline(trimmed.slice(2), onCitationClick, activeMarker)}
            </h2>
          );
        }

        // Blockquotes
        if (trimmed.startsWith('> ')) {
          return (
            <blockquote
              key={bIdx}
              className="border-l-2 border-[#ff4d00] pl-3 py-1.5 italic text-[#f2efeb]/80 bg-[#ff4d00]/5 my-2 rounded-r-[2px] break-words"
            >
              {renderInline(trimmed.slice(2), onCitationClick, activeMarker)}
            </blockquote>
          );
        }

        // Bullet lists
        if (trimmed.split('\n').every((line) => line.trim().startsWith('- ') || line.trim().startsWith('* '))) {
          const items = trimmed.split('\n').filter((l) => l.trim().length > 0);
          return (
            <ul key={bIdx} className="list-disc pl-5 space-y-1.5 text-[#f2efeb] break-words">
              {items.map((item, itemIdx) => {
                const text = item.replace(/^[-*]\s+/, '');
                return (
                  <li key={itemIdx}>
                    {renderInline(text, onCitationClick, activeMarker)}
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
            <ol key={bIdx} className="list-decimal pl-5 space-y-1.5 text-[#f2efeb] break-words">
              {items.map((item, itemIdx) => {
                const text = item.replace(/^\d+\.\s+/, '');
                return (
                  <li key={itemIdx}>
                    {renderInline(text, onCitationClick, activeMarker)}
                  </li>
                );
              })}
            </ol>
          );
        }

        // Regular paragraph with inline citation chips
        return (
          <p key={bIdx} className="break-words overflow-wrap-anywhere">
            {renderInline(trimmed, onCitationClick, activeMarker)}
          </p>
        );
      })}
    </div>
  );
};

/**
 * Safely parses inline formatting:
 * - Citation markers: [1], [2]
 * - Markdown links: [link text](url)
 * - Bold: **text**
 * - Inline code: `text`
 */
function renderInline(
  text: string,
  onCitationClick?: (marker: number) => void,
  activeMarker?: number | null
): React.ReactNode[] {
  // Regex matches:
  // Group 1 & 2: Citation [1]
  // Group 3 & 4 & 5: Markdown link [label](url)
  // Group 6 & 7: Bold **text**
  // Group 8 & 9: Code `text`
  const tokenRegex = /(\[(\d+)\])|(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.substring(lastIndex, match.index));
    }

    if (match[1]) {
      // Citation marker: [n] in technical orange
      const markerNum = parseInt(match[2], 10);
      const isActive = activeMarker === markerNum;
      nodes.push(
        <button
          key={`cit-${match.index}`}
          type="button"
          onClick={() => onCitationClick?.(markerNum)}
          className={`inline-flex items-center justify-center font-mono font-semibold text-xs px-1.5 py-0.2 mx-0.5 rounded-[2px] transition-all duration-150 cursor-pointer ${
            isActive
              ? 'bg-[#ff4d00] text-white ring-2 ring-[#ff4d00]/40 shadow-xs'
              : 'bg-[#ff4d00]/15 text-[#ff4d00] hover:bg-[#ff4d00]/25 border border-[#ff4d00]/30'
          }`}
          title={`Jump to Citation [${markerNum}] in Folio PDF`}
          aria-label={`Citation ${markerNum}`}
        >
          [{markerNum}]
        </button>
      );
    } else if (match[3]) {
      // Markdown link: [text](url)
      const linkText = match[4];
      const rawUrl = match[5].trim();
      const isSafe = /^(https?:\/\/|mailto:|#)/i.test(rawUrl);
      const isExternal = /^https?:\/\//i.test(rawUrl);

      if (isSafe) {
        nodes.push(
          <a
            key={`link-${match.index}`}
            href={rawUrl}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noopener noreferrer' : undefined}
            className="text-[#ff4d00] hover:text-[#ff6622] underline underline-offset-2 break-all font-medium transition-colors"
          >
            {linkText}
          </a>
        );
      } else {
        nodes.push(linkText);
      }
    } else if (match[6]) {
      // Bold text
      nodes.push(
        <strong key={`bold-${match.index}`} className="font-semibold text-[#f2efeb]">
          {match[7]}
        </strong>
      );
    } else if (match[8]) {
      // Inline code
      nodes.push(
        <code
          key={`code-${match.index}`}
          className="bg-[#0e0e0f] text-[#ff7733] text-xs px-1.5 py-0.5 rounded-[2px] font-mono border border-[rgba(242,239,235,0.15)] break-words"
        >
          {match[9]}
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
