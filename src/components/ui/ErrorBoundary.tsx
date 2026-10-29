import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  pageName?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`ErrorBoundary caught an error in ${this.props.pageName || 'app'}:`, error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    } else {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      const title = this.props.pageName ? `${this.props.pageName} Encountered an Issue` : 'Application Exception';
      return (
        <div className="w-full h-full min-h-[360px] flex items-center justify-center p-6 text-[var(--ink)]">
          <div
            style={{
              borderRadius: '28px',
              padding: '28px',
              background: 'var(--card)',
              boxShadow: 'var(--sh)',
            }}
            className="max-w-md w-full border border-[color-mix(in_srgb,var(--mute)_20%,transparent)] text-center animate-in fade-in"
          >
            <div className="w-12 h-12 rounded-2xl bg-[var(--err)]/15 text-[var(--err)] flex items-center justify-center mx-auto mb-3">
              <AlertCircle size={24} />
            </div>
            <h3 className="font-bold text-base text-[var(--ink)] mb-1">{title}</h3>
            <p className="text-xs text-[var(--mute)] mb-4 leading-relaxed">
              An unexpected error occurred while rendering this section. Your documents and indexed findings in IndexedDB are completely safe.
            </p>
            {this.state.error?.message && (
              <div className="bg-[color-mix(in_srgb,var(--mute)_8%,transparent)] border border-[color-mix(in_srgb,var(--mute)_20%,transparent)] p-2.5 rounded-xl text-[11px] font-mono text-[var(--ink)] text-left mb-4 max-h-24 overflow-y-auto">
                {this.state.error.message}
              </div>
            )}
            <button
              type="button"
              onClick={this.handleReset}
              className="btn sm"
            >
              <RotateCcw size={13} />
              <span>Retry {this.props.pageName || 'View'}</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

