import React from 'react';
import { cn } from '@/lib/utils';
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';

export interface ErrorBannerProps {
  type?: 'error' | 'warning' | 'info' | 'success';
  title?: string;
  message: string;
  actionText?: string;
  onAction?: () => void;
  onClose?: () => void;
  className?: string;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  type = 'error',
  title,
  message,
  actionText,
  onAction,
  onClose,
  className,
}) => {
  const styles = {
    error: {
      container: 'bg-rose-500/10 dark:bg-rose-950/25 border-rose-500/30 text-rose-900 dark:text-rose-200',
      icon: <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />,
      btn: 'bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white',
    },
    warning: {
      container: 'bg-amber-500/10 dark:bg-amber-950/25 border-amber-500/30 text-amber-900 dark:text-amber-200',
      icon: <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />,
      btn: 'bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white',
    },
    info: {
      container: 'bg-sky-500/10 dark:bg-sky-950/25 border-sky-500/30 text-sky-900 dark:text-sky-200',
      icon: <Info className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />,
      btn: 'bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white',
    },
    success: {
      container: 'bg-emerald-500/10 dark:bg-emerald-950/25 border-emerald-500/30 text-emerald-900 dark:text-emerald-200',
      icon: <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-[#3ecf8e] shrink-0 mt-0.5" />,
      btn: 'bg-[#3ecf8e] hover:bg-[#24b47e] active:bg-[#1fa672] text-[#171717]',
    },
  };

  const currentStyle = styles[type];

  return (
    <div
      role="alert"
      className={cn(
        'p-3 sm:p-3.5 rounded-[8px] border text-xs font-sans transition-all duration-150 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs',
        currentStyle.container,
        className
      )}
    >
      <div className="flex items-start gap-2.5 min-w-0 flex-1">
        {currentStyle.icon}
        <div className="min-w-0 flex-1">
          {title && (
            <p className="font-semibold text-xs leading-snug tracking-tight mb-0.5">
              {title}
            </p>
          )}
          <p className="text-xs leading-relaxed opacity-90">{message}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto pl-6 sm:pl-0">
        {actionText && onAction && (
          <button
            type="button"
            onClick={onAction}
            className={cn(
              'px-3 py-1.5 rounded-[6px] text-xs font-medium tracking-tight shadow-xs transition-transform duration-100 active:scale-95 cursor-pointer inline-flex items-center gap-1.5',
              currentStyle.btn
            )}
          >
            <span>{actionText}</span>
            <span aria-hidden="true">→</span>
          </button>
        )}

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss banner"
            className="p-1 rounded-[4px] opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
