import React from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  ShieldCheck,
  AlertTriangle,
  FileQuestion,
  Trash2,
} from 'lucide-react';
import { DocumentStatus } from '../../types/index.ts';

interface StatusBadgeProps {
  status: DocumentStatus | 'Verified' | 'Unverified' | 'Source Deleted' | 'No Text';
  size?: 'sm' | 'md';
  customText?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = 'md',
  customText,
}) => {
  const isSmall = size === 'sm';
  const sizeClasses = isSmall
    ? 'text-[10px] font-mono px-2 py-0.5 gap-1 rounded-[2px]'
    : 'text-xs font-mono font-medium px-2.5 py-0.5 gap-1.5 rounded-[2px]';
  const iconSize = isSmall ? 10 : 12;

  switch (status) {
    case 'Ready':
      return (
        <span
          className={`inline-flex items-center bg-[#22c55e]/10 text-[#4ade80] border border-[#22c55e]/30 ${sizeClasses}`}
        >
          <CheckCircle2 size={iconSize} className="shrink-0" aria-hidden="true" />
          <span>{customText || 'Ready'}</span>
        </span>
      );

    case 'Processing':
      return (
        <span
          className={`inline-flex items-center bg-[#ff4d00]/15 text-[#ff7733] border border-[#ff4d00]/30 ${sizeClasses}`}
        >
          <Loader2 size={iconSize} className="animate-spin shrink-0" aria-hidden="true" />
          <span>{customText || 'Processing'}</span>
        </span>
      );

    case 'Failed':
      return (
        <span
          className={`inline-flex items-center bg-[#ef4444]/15 text-[#f87171] border border-[#ef4444]/30 ${sizeClasses}`}
        >
          <AlertCircle size={iconSize} className="shrink-0" aria-hidden="true" />
          <span>{customText || 'Failed'}</span>
        </span>
      );

    case 'Uploaded':
      return (
        <span
          className={`inline-flex items-center bg-[rgba(242,239,235,0.06)] text-[#f2efeb]/70 border border-[rgba(242,239,235,0.15)] ${sizeClasses}`}
        >
          <Clock size={iconSize} className="shrink-0" aria-hidden="true" />
          <span>{customText || 'Uploaded'}</span>
        </span>
      );

    case 'Verified':
      return (
        <span
          className={`inline-flex items-center bg-[#22c55e]/15 text-[#4ade80] border border-[#22c55e]/30 font-medium ${sizeClasses}`}
          title="Direct quote verified against source document text"
        >
          <ShieldCheck size={iconSize} className="shrink-0" aria-hidden="true" />
          <span>{customText || 'Verified Quote'}</span>
        </span>
      );

    case 'Unverified':
      return (
        <span
          className={`inline-flex items-center bg-[#f59e0b]/15 text-[#fbbf24] border border-[#f59e0b]/30 font-medium ${sizeClasses}`}
          title="Quote could not be verbatim matched in passage text"
        >
          <AlertTriangle size={iconSize} className="shrink-0" aria-hidden="true" />
          <span>{customText || 'Unverified Quote'}</span>
        </span>
      );

    case 'Source Deleted':
      return (
        <span
          className={`inline-flex items-center bg-[rgba(242,239,235,0.06)] text-[#f2efeb]/40 border border-[rgba(242,239,235,0.12)] line-through ${sizeClasses}`}
          title="Original source document has been removed"
        >
          <Trash2 size={iconSize} className="shrink-0" aria-hidden="true" />
          <span>{customText || 'Source Deleted'}</span>
        </span>
      );

    case 'No Text':
      return (
        <span
          className={`inline-flex items-center bg-[#ef4444]/15 text-[#f87171] border border-[#ef4444]/30 ${sizeClasses}`}
        >
          <FileQuestion size={iconSize} className="shrink-0" aria-hidden="true" />
          <span>{customText || 'No text extracted'}</span>
        </span>
      );

    default:
      return null;
  }
};
