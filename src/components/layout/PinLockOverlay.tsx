import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/authStore';
import { Lock, Key, LogOut, Eye, EyeOff, ArrowRight, Delete, RotateCcw } from 'lucide-react';
import { AsopalavLogo } from '@/components/icons/AsopalavLogo';
import { animateModalOpen, animateShake } from '@/lib/animations';
import { cn, triggerHaptic } from '@/lib/utils';
import { UserAvatar } from '@/components/ui/UserAvatar';

export const PinLockOverlay: React.FC = () => {
  const {
    isLocked,
    unlockScreen,
    user,
    logout,
  } = useAuthStore();

  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  // L-4 Security: Track failed PIN attempts; force full logout after 5 failures
  const [failedAttempts, setFailedAttempts] = useState(0);
  const MAX_PIN_ATTEMPTS = 5;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isLocked) {
      animateModalOpen(cardRef.current, backdropRef.current);
      setPin('');
      setShowPin(false);
      setError(false);
      setErrorMessage('');
      setFailedAttempts(0);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isLocked]);

  if (!isLocked) return null;

  const handleKeypadPress = (val: string) => {
    triggerHaptic('light');
    setError(false);
    setErrorMessage('');
    if (pin.length < 8) {
      const newPin = pin + val;
      setPin(newPin);
      if (newPin.length === 4) {
        // Auto-check on 4 digits
        setTimeout(() => triggerUnlock(newPin), 100);
      }
    }
  };

  const handleBackspace = () => {
    triggerHaptic('medium');
    setError(false);
    setErrorMessage('');
    setPin((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    triggerHaptic('medium');
    setError(false);
    setErrorMessage('');
    setPin('');
    inputRef.current?.focus();
  };

  const triggerUnlock = (pinToTest: string) => {
    if (!pinToTest.trim()) {
      inputRef.current?.focus();
      return;
    }

    const success = unlockScreen(pinToTest);
    if (!success) {
      triggerHaptic('error');
      const newAttempts = failedAttempts + 1;
      setFailedAttempts(newAttempts);

      // L-4 Security: After 5 failed attempts, force full logout
      if (newAttempts >= MAX_PIN_ATTEMPTS) {
        setErrorMessage(`Too many incorrect PIN attempts (${MAX_PIN_ATTEMPTS}/${MAX_PIN_ATTEMPTS}). Signing out for security.`);
        setError(true);
        animateShake(cardRef.current);
        setTimeout(() => {
          logout('Too many incorrect PIN attempts. Please sign in with your full credentials.');
        }, 1200);
        return;
      }

      const remaining = MAX_PIN_ATTEMPTS - newAttempts;
      setError(true);
      setErrorMessage(`Incorrect PIN. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before sign-out.`);
      animateShake(cardRef.current);
      setTimeout(() => {
        setPin('');
        setError(false);
        inputRef.current?.focus();
      }, 800);
    } else {
      triggerHaptic('heavy');
      setFailedAttempts(0);
    }
  };

  const handleFormSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    triggerUnlock(pin);
  };

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center p-3 select-none font-sans overflow-y-auto"
    >
      <div
        ref={cardRef}
        className="w-full max-w-[420px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] rounded-[12px] p-6 shadow-2xl flex flex-col items-center text-center space-y-4 relative text-slate-900 dark:text-white animate-in fade-in zoom-in-95 duration-200 my-auto"
      >
        {/* Top Brand Logo & Lock Indicator */}
        <div className="flex items-center justify-between w-full pb-2 border-b border-slate-100 dark:border-[#242424]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-[6px] bg-slate-50 dark:bg-[#181818] border border-slate-200 dark:border-[#242424] flex items-center justify-center shadow-xs">
              <AsopalavLogo size={16} />
            </div>
            <div className="text-left">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-zinc-400 block font-semibold leading-tight">
                Asopalav ERP
              </span>
              <span className="text-xs font-medium text-slate-900 dark:text-white leading-tight">
                Screen Lock
              </span>
            </div>
          </div>

          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-[10px] font-mono font-medium">
            <Lock className="w-3 h-3" />
            <span>Screen Locked</span>
          </div>
        </div>

        {/* Current User Detail Banner */}
        <div className="w-full p-3 rounded-[8px] bg-slate-50 dark:bg-[#181818] border border-slate-200 dark:border-[#242424] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <UserAvatar
              src={user?.avatar_url}
              firstName={user?.first_name}
              lastName={user?.last_name}
              name={user?.username}
              size={36}
              shape="square"
              className="border border-emerald-500/20 shrink-0"
            />
            <div className="text-left">
              <h3 className="text-xs font-medium text-slate-900 dark:text-white leading-tight">
                {user?.first_name} {user?.last_name || ''}
              </h3>
              <p className="text-[10px] text-slate-500 dark:text-zinc-400 font-sans leading-tight mt-0.5">
                {user?.role_code ? user.role_code.replace(/_/g, ' ') : 'Cashier'}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 dark:text-zinc-400 px-2 py-0.5 rounded-[4px] bg-slate-100 dark:bg-[#252525] border border-slate-200 dark:border-[#333]">
            <Key className="w-3 h-3 text-slate-400 dark:text-zinc-500" />
            <span>4-Digit PIN</span>
          </span>
        </div>

        {/* PIN Input & Visual Indicators */}
        <form onSubmit={handleFormSubmit} className="w-full space-y-3">
          <div className="space-y-1">
            <div className="relative flex items-center">
              <input
                id="lock-screen-pin"
                ref={inputRef}
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                value={pin}
                onChange={(e) => {
                  const sanitized = e.target.value.replace(/[^0-9]/g, '');
                  setPin(sanitized);
                  setError(false);
                  setErrorMessage('');
                  if (sanitized.length === 4) {
                    setTimeout(() => triggerUnlock(sanitized), 100);
                  }
                }}
                placeholder="• • • •"
                className={cn(
                  'w-full h-10 min-h-[40px] bg-white dark:bg-[#141414] border rounded-[6px] px-3 text-center text-base font-mono tracking-[0.4em] text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-zinc-600 focus:outline-none transition-colors shadow-2xs',
                  error
                    ? 'border-rose-500 focus:border-rose-500 ring-1 ring-rose-500/30'
                    : 'border-slate-200 dark:border-[#282828] focus:border-emerald-500 dark:focus:border-[#3ecf8e] focus:ring-1 focus:ring-emerald-500/30'
                )}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute right-3 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                title={showPin ? 'Hide PIN' : 'Show PIN'}
              >
                {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {error && (
              <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400 text-center pt-0.5">
                {errorMessage || 'Incorrect PIN. Please try again.'}
              </p>
            )}
          </div>

          {/* On-Screen Touch Keypad (POS Counter Ergonomics) */}
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => handleKeypadPress(digit)}
                className="h-10 rounded-[6px] border border-slate-200 dark:border-[#242424] bg-slate-50/70 dark:bg-[#181818] hover:bg-slate-100 dark:hover:bg-[#222222] active:bg-slate-200 dark:active:bg-[#282828] text-sm font-mono font-medium text-slate-900 dark:text-white transition-colors cursor-pointer shadow-2xs flex items-center justify-center select-none active:scale-[0.98]"
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              onClick={handleClear}
              className="h-10 rounded-[6px] border border-slate-200 dark:border-[#242424] bg-slate-100/50 dark:bg-[#181818] hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:border-rose-300 dark:hover:border-rose-800 text-xs font-mono text-slate-600 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer shadow-2xs flex items-center justify-center select-none active:scale-[0.98]"
              title="Clear PIN"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleKeypadPress('0')}
              className="h-10 rounded-[6px] border border-slate-200 dark:border-[#242424] bg-slate-50/70 dark:bg-[#181818] hover:bg-slate-100 dark:hover:bg-[#222222] active:bg-slate-200 dark:active:bg-[#282828] text-sm font-mono font-medium text-slate-900 dark:text-white transition-colors cursor-pointer shadow-2xs flex items-center justify-center select-none active:scale-[0.98]"
            >
              0
            </button>
            <button
              type="button"
              onClick={handleBackspace}
              className="h-10 rounded-[6px] border border-slate-200 dark:border-[#242424] bg-slate-100/50 dark:bg-[#181818] hover:bg-slate-100 dark:hover:bg-[#222222] text-xs font-mono text-slate-600 dark:text-zinc-400 transition-colors cursor-pointer shadow-2xs flex items-center justify-center select-none active:scale-[0.98]"
              title="Backspace"
            >
              <Delete className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Primary Unlock CTA Button */}
          <button
            type="submit"
            className="w-full h-10 px-4 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-medium text-xs font-sans flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer active:scale-[0.99] mt-2"
          >
            <span>Unlock Counter Screen (Enter)</span>
            <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
        </form>

        {/* Footer: Sign out / Password login */}
        <div className="pt-2 border-t border-slate-100 dark:border-[#242424] w-full flex items-center justify-center">
          <button
            type="button"
            onClick={() => logout()}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500" />
            <span>Sign in with full password credentials</span>
          </button>
        </div>
      </div>
    </div>
  );
};
