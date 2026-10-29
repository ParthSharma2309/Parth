import React from 'react';
import {
  Check,
  AlertCircle,
  Loader2,
  Clock,
  Trash2,
  AlertTriangle,
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
  const iconSize = isSmall ? 11 : 13;

  switch (status) {
    case 'Verified':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-sans font-semibold rounded-full bg-[color-mix(in_srgb,var(--teal)_16%,transparent)] text-[var(--teal)] border border-[color-mix(in_srgb,var(--teal)_40%,transparent)] ${
            isSmall ? 'text-[11px] px-2.5 py-0.5' : 'text-xs px-3 py-1'
          }`}
          title="Direct quote verified against source document text"
        >
          <Check size={iconSize} className="stroke-[2.5]" aria-hidden="true" />
          <span>{customText || 'Verified'}</span>
        </span>
      );

    case 'Unverified':
      return (
        <span
          className={`inline-flex items-center gap-1.5 mono rounded-full bg-[color-mix(in_srgb,var(--err)_12%,transparent)] text-[var(--err)] border border-[color-mix(in_srgb,var(--err)_40%,transparent)] ${
            isSmall ? 'text-[10px] px-2.5 py-0.5' : 'text-[11px] px-3 py-1'
          }`}
          title="Quote could not be verbatim matched in passage text"
        >
          <AlertTriangle size={iconSize} className="shrink-0" aria-hidden="true" />
          <span>{customText || 'Unverified'}</span>
        </span>
      );

    case 'Failed':
      return (
        <span
          className={`inline-flex items-center gap-1.5 mono rounded-full bg-[color-mix(in_srgb,var(--err)_12%,transparent)] text-[var(--err)] border border-[var(--err)] ${
            isSmall ? 'text-[10px] px-2.5 py-0.5' : 'text-[11px] px-3 py-1'
          }`}
        >
          <AlertCircle size={iconSize} className="shrink-0" aria-hidden="true" />
          <span>{customText || 'Failed'}</span>
        </span>
      );

    case 'No Text':
      return (
        <span
          className={`inline-flex items-center gap-1.5 mono rounded-full bg-[color-mix(in_srgb,var(--mute)_15%,transparent)] text-[var(--mute)] border border-[color-mix(in_srgb,var(--mute)_30%,transparent)] ${
            isSmall ? 'text-[10px] px-2.5 py-0.5' : 'text-[11px] px-3 py-1'
          }`}
        >
          <span>{customText || 'No text'}</span>
        </span>
      );

    case 'Ready':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-sans font-semibold rounded-full bg-[color-mix(in_srgb,var(--teal)_12%,transparent)] text-[var(--ink)] border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] ${
            isSmall ? 'text-[11px] px-2.5 py-0.5' : 'text-xs px-3 py-1'
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--teal)]" aria-hidden="true" />
          <span>{customText || 'Indexed & Ready'}</span>
        </span>
      );

    case 'Processing':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-sans font-medium rounded-full bg-[color-mix(in_srgb,var(--a1)_12%,transparent)] text-[var(--a1)] border border-[color-mix(in_srgb,var(--a1)_30%,transparent)] ${
            isSmall ? 'text-[11px] px-2.5 py-0.5' : 'text-xs px-3 py-1'
          }`}
        >
          <Loader2 size={iconSize} className="animate-spin shrink-0" aria-hidden="true" />
          <span>{customText || 'Reading...'}</span>
        </span>
      );

    case 'Uploaded':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-sans font-medium rounded-full bg-[var(--card)] text-[var(--mute)] border border-[color-mix(in_srgb,var(--mute)_24%,transparent)] ${
            isSmall ? 'text-[11px] px-2.5 py-0.5' : 'text-xs px-3 py-1'
          }`}
        >
          <Clock size={iconSize} className="shrink-0" aria-hidden="true" />
          <span>{customText || 'In queue'}</span>
        </span>
      );

    case 'Source Deleted':
      return (
        <span
          className={`inline-flex items-center gap-1 font-sans rounded-full bg-[var(--card)] text-[var(--mute)] border border-[color-mix(in_srgb,var(--mute)_24%,transparent)] line-through ${
            isSmall ? 'text-[11px] px-2.5 py-0.5' : 'text-xs px-3 py-1'
          }`}
          title="Original source document has been removed"
        >
          <Trash2 size={iconSize} className="shrink-0" aria-hidden="true" />
          <span>{customText || 'Removed'}</span>
        </span>
      );

    default:
      return null;
  }
};
