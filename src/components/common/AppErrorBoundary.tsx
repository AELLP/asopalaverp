import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RotateCcw, Terminal } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught Asopalav ERP runtime error:', error, errorInfo);
    this.setState({ errorInfo });

    // Auto-recover from stale Vite deployment chunks (Failed to fetch dynamically imported module)
    const isChunkLoadFailed =
      error?.message?.includes('Failed to fetch dynamically imported module') ||
      error?.message?.includes('dynamically imported module') ||
      error?.name === 'ChunkLoadError';

    if (isChunkLoadFailed) {
      const hasRetried = sessionStorage.getItem('asopalav_chunk_reload');
      if (!hasRetried) {
        sessionStorage.setItem('asopalav_chunk_reload', 'true');
        window.location.reload();
      }
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = window.location.pathname;
  };

  private handleHardReload = () => {
    try {
      localStorage.removeItem('asopalav_session_user');
      localStorage.removeItem('asopalav_session_timestamp');
      localStorage.removeItem('asopalav_custom_pins');
      localStorage.removeItem('asopalav-erp-cache');
      sessionStorage.clear();
    } catch {}
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-white dark:bg-[#141414] text-slate-900 dark:text-[#EDEDED] font-sans antialiased selection:bg-[#3ecf8e]/20 selection:text-[#3ecf8e] p-4 sm:p-8 flex flex-col items-center justify-center select-none">
          <div className="max-w-xl w-full p-8 rounded-[12px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] shadow-md space-y-6">
            {/* Status Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-[6px] bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-xs font-mono font-medium">
              <span>SYSTEM EXCEPTION</span>
              <span>•</span>
              <span>Runtime Intercepted</span>
            </div>

            {/* Icon & Heading */}
            <div className="space-y-2 text-center">
              <div className="w-12 h-12 rounded-[10px] bg-rose-500/10 dark:bg-rose-500/15 border border-rose-500/20 flex items-center justify-center text-rose-600 dark:text-rose-400 mx-auto shadow-xs">
                <AlertOctagon className="w-6 h-6 stroke-[2]" />
              </div>
              <h1 className="text-xl font-medium text-slate-900 dark:text-white tracking-tight font-sans">
                Application State Exception
              </h1>
              <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed font-sans max-w-md mx-auto">
                An unexpected execution error occurred. The application safe state was preserved.
              </p>
            </div>

            {/* Stack Trace Box */}
            <div className="p-4 rounded-[8px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#242424] text-left text-xs font-mono space-y-2">
              <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-zinc-500 uppercase tracking-wider font-medium">
                <span className="flex items-center gap-1.5">
                  <Terminal className="w-3 h-3 text-rose-500" />
                  Exception Stack Trace
                </span>
              </div>

              <p className="text-rose-600 dark:text-rose-400 font-medium break-all">
                {this.state.error?.name}: {this.state.error?.message}
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="flex-1 h-9 px-4 rounded-[6px] bg-[#3ecf8e] hover:bg-[#34b27b] text-[#171717] font-sans text-xs font-medium cursor-pointer transition-all inline-flex items-center justify-center gap-2 shadow-2xs"
              >
                <RotateCcw className="w-3.5 h-3.5 stroke-[2]" />
                <span>Reload Showroom Canvas</span>
              </button>

              <button
                type="button"
                onClick={this.handleHardReload}
                className="h-9 px-4 rounded-[6px] border border-slate-300 dark:border-[#2e2e2e] hover:bg-slate-100 dark:hover:bg-[#1f1f1f] text-slate-800 dark:text-zinc-200 font-sans text-xs font-medium cursor-pointer transition-all inline-flex items-center justify-center gap-2"
              >
                <span>Clear Cache & Reset</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
