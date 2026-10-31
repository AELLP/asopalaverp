import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDialogStore } from '@/store/dialogStore';
import { useScrollLock } from '@/hooks/useScrollLock';
import { X, Loader2 } from 'lucide-react';
import { Kbd } from '@/components/ui/Kbd';

export const ConfirmDialog: React.FC = () => {
  const { isOpen, options, isLoading, closeConfirm } = useDialogStore();
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  useScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(() => {
      confirmBtnRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        options?.onCancel?.();
        closeConfirm();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isLoading, options, closeConfirm]);

  if (!isOpen || !options) return null;

  const {
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'primary',
    onConfirm,
    onCancel,
  } = options;

  const handleCancel = () => {
    if (isLoading) return;
    onCancel?.();
    closeConfirm();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[999999] bg-black/85 backdrop-blur-[2px] flex items-center justify-center p-4 select-none font-sans animate-in fade-in duration-150"
      onClick={handleCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] rounded-[8px] shadow-2xl overflow-hidden text-slate-900 dark:text-[#ededed] font-sans flex flex-col animate-in zoom-in-95 duration-150"
      >
        {/* Header Bar */}
        <div className="px-4 py-3 border-b border-slate-100 dark:border-[#202020] flex items-center justify-between bg-slate-50/50 dark:bg-[#111111]">
          <div className="flex items-center gap-2">
            {variant === 'danger' && (
              <span className="w-2 h-2 rounded-full bg-[#e5484d] shrink-0" />
            )}
            {variant === 'warning' && (
              <span className="w-2 h-2 rounded-full bg-[#f59e0b] shrink-0" />
            )}
            {variant === 'primary' && (
              <span className="w-2 h-2 rounded-full bg-[#3ecf8e] shrink-0" />
            )}
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-[#888888] font-medium">
              {variant === 'danger' ? 'Confirm Danger Action' : variant === 'warning' ? 'Attention Required' : 'Action Confirmation'}
            </span>
          </div>

          <button
            type="button"
            disabled={isLoading}
            onClick={handleCancel}
            className="w-6 h-6 rounded-[4px] text-slate-400 dark:text-[#707070] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#202020] transition-colors cursor-pointer flex items-center justify-center disabled:opacity-50"
            title="Close (ESC)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-2">
          <h3 className="text-sm font-medium text-slate-900 dark:text-[#EDEDED] tracking-tight leading-snug font-sans">
            {title}
          </h3>
          <div className="text-xs text-slate-600 dark:text-[#A1A1A1] leading-relaxed font-sans">
            {message}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 bg-slate-50 dark:bg-[#111111] border-t border-slate-100 dark:border-[#202020] flex items-center justify-between gap-3">
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-[#707070] font-mono select-none">
            <Kbd size="xs">ESC</Kbd>
            <span>Cancel</span>
          </div>

          <div className="flex items-center gap-2 ml-auto w-full sm:w-auto justify-end">
            <button
              type="button"
              disabled={isLoading}
              onClick={handleCancel}
              className="h-8 px-3 rounded-[6px] text-xs font-medium border border-slate-300 dark:border-[#2e2e2e] bg-white dark:bg-transparent hover:bg-slate-100 dark:hover:bg-[#1f1f1f] text-slate-700 dark:text-[#a1a1a1] dark:hover:text-white transition-colors cursor-pointer disabled:opacity-50 select-none font-sans"
            >
              {cancelText}
            </button>

            <button
              ref={confirmBtnRef}
              type="button"
              disabled={isLoading}
              onClick={() => onConfirm()}
              className={
                variant === 'danger'
                  ? 'h-8 px-3.5 rounded-[6px] text-xs font-medium bg-[#e5484d] hover:bg-[#dc3b40] text-white transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50 select-none font-sans active:scale-[0.98]'
                  : variant === 'warning'
                  ? 'h-8 px-3.5 rounded-[6px] text-xs font-medium bg-[#f59e0b] hover:bg-[#d97706] text-[#171717] transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50 select-none font-sans active:scale-[0.98]'
                  : 'h-8 px-3.5 rounded-[6px] text-xs font-medium bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50 select-none font-sans active:scale-[0.98]'
              }
            >
              {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
              <span>{confirmText}</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
