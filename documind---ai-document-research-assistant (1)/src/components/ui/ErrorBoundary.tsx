import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
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
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F3EEE4] flex items-center justify-center p-6 text-[#1C1914]">
          <div className="max-w-md w-full bg-[#FBF8F2] rounded-[8px] border border-[#D9D0C3] p-6 shadow-xs text-center">
            <div className="w-10 h-10 rounded-[4px] bg-[#9F1239]/10 border border-[#9F1239]/30 flex items-center justify-center text-[#9F1239] mx-auto mb-4">
              <AlertCircle size={20} />
            </div>
            <h2 className="font-serif text-lg font-bold text-[#1C1914] mb-1">Application Exception</h2>
            <p className="text-xs text-[#5C564C] mb-4 leading-relaxed">
              An unexpected error occurred while rendering the research interface. Your stored primary sources and conversation ledger in IndexedDB remain secure.
            </p>
            {this.state.error?.message && (
              <div className="bg-white border border-[#D9D0C3] p-2.5 rounded-[4px] text-[11px] font-mono text-[#1C1914] text-left mb-4 max-h-24 overflow-y-auto">
                {this.state.error.message}
              </div>
            )}
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1E4336] hover:bg-[#16352B] text-white rounded-[4px] text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <RotateCcw size={13} />
              <span>Reload DocuMind Terminal</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
