import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useScrollLock } from '@/hooks/useScrollLock';
import { useUIStore } from '@/store/uiStore';
import { cn, formatINR, triggerHaptic } from '@/lib/utils';
import { animateModalOpen, animateModalClose } from '@/lib/animations';
import { showToast } from '@/components/ui/ToastContainer';
import { SegmentedControl } from '@/components/ui';
import {
  Calculator,
  X,
  Tag,
  Percent,
} from 'lucide-react';

type CalcMode = 'math' | 'pro';

export const PosQuickCalculator: React.FC = () => {
  const { isCalculatorOpen, setCalculatorOpen } = useUIStore();
  useScrollLock(isCalculatorOpen);

  const [mode, setMode] = useState<CalcMode>('math');
  const [expression, setExpression] = useState<string>('0');

  // Pro Mode: Discount State (Only 5% and 10% quick presets)
  const [originalPrice, setOriginalPrice] = useState<string>('');
  const [discountPercent, setDiscountPercent] = useState<string>('10');

  const modalRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  // Auto-clear all state on exit / close
  const resetAllState = useCallback(() => {
    setExpression('0');
    setOriginalPrice('');
    setDiscountPercent('10');
    setMode('math');
  }, []);

  const handleClose = useCallback(() => {
    animateModalClose(modalRef.current, backdropRef.current, () => {
      resetAllState();
      setCalculatorOpen(false);
    });
  }, [setCalculatorOpen, resetAllState]);

  // Handle Open animation
  useEffect(() => {
    if (isCalculatorOpen) {
      animateModalOpen(modalRef.current, backdropRef.current);
    }
  }, [isCalculatorOpen]);

  // Safe Math Evaluator
  const evaluateMath = (expr: string): number => {
    try {
      const sanitized = expr
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .replace(/,/g, '')
        .replace(/[^-()\d/*+.]/g, '');
      if (!sanitized || sanitized === '-') return 0;
      const fn = new Function(`return (${sanitized})`);
      const val = fn();
      return typeof val === 'number' && !isNaN(val) && isFinite(val) ? Math.round(val * 100) / 100 : 0;
    } catch {
      return 0;
    }
  };

  const currentMathResult = useMemo(() => evaluateMath(expression), [expression]);

  // Handle calculator key press
  const handleKeyClick = (key: string) => {
    triggerHaptic('light');

    if (key === 'C') {
      setExpression('0');
      return;
    }

    if (key === 'DEL') {
      if (expression.length <= 1) {
        setExpression('0');
      } else {
        setExpression(expression.slice(0, -1));
      }
      return;
    }

    if (key === '+/-') {
      try {
        const val = evaluateMath(expression);
        setExpression(String(-val));
      } catch {
        // ignore
      }
      return;
    }

    if (key === '%') {
      try {
        const val = evaluateMath(expression);
        const percentVal = Math.round((val / 100) * 10000) / 10000;
        setExpression(String(percentVal));
      } catch {
        // ignore
      }
      return;
    }

    if (key === '=') {
      const res = evaluateMath(expression);
      setExpression(String(res));
      return;
    }

    if (expression === '0' && !['+', '-', '×', '÷', '.'].includes(key)) {
      setExpression(key);
    } else {
      const lastChar = expression.slice(-1);
      if (['+', '-', '×', '÷'].includes(lastChar) && ['+', '-', '×', '÷'].includes(key)) {
        setExpression(expression.slice(0, -1) + key);
      } else {
        setExpression((prev) => prev + key);
      }
    }
  };

  // Add GST Percentage (+5%, +18%, +28%)
  const handleAddGst = (gstPercent: 5 | 18 | 28) => {
    triggerHaptic('selection');
    const base = evaluateMath(expression);
    if (base > 0) {
      const withTax = Math.round(base * (1 + gstPercent / 100) * 100) / 100;
      const gstTax = Math.round((withTax - base) * 100) / 100;
      setExpression(String(withTax));
      showToast({
        type: 'info',
        title: `+${gstPercent}% GST Added`,
        message: `₹${base.toLocaleString('en-IN')} + GST ₹${gstTax.toLocaleString('en-IN')} = ₹${withTax.toLocaleString('en-IN')}`,
      });
    }
  };

  // Remove / Cut GST Percentage (-5%, -18%, -28% Reverse GST Extraction)
  const handleRemoveGst = (gstPercent: 5 | 18 | 28) => {
    triggerHaptic('selection');
    const gross = evaluateMath(expression);
    if (gross > 0) {
      // Reverse GST formula: Taxable Base = Gross / (1 + Rate / 100)
      const baseTaxable = Math.round((gross / (1 + gstPercent / 100)) * 100) / 100;
      const taxRemoved = Math.round((gross - baseTaxable) * 100) / 100;
      setExpression(String(baseTaxable));
      showToast({
        type: 'info',
        title: `-${gstPercent}% GST Removed (Cut)`,
        message: `Gross ₹${gross.toLocaleString('en-IN')} − Tax ₹${taxRemoved.toLocaleString('en-IN')} = Base ₹${baseTaxable.toLocaleString('en-IN')}`,
      });
    }
  };

  // Pro Discount Calculation
  const discountCalculations = useMemo(() => {
    const original = parseFloat(originalPrice.replace(/,/g, '')) || 0;
    const disc = parseFloat(discountPercent.replace(/,/g, '')) || 0;
    if (original <= 0) return { original: 0, savings: 0, finalPrice: 0, percent: disc };
    const savings = Math.round(((original * disc) / 100) * 100) / 100;
    const finalPrice = Math.max(0, Math.round((original - savings) * 100) / 100);
    return {
      original,
      savings,
      finalPrice,
      percent: disc,
    };
  }, [originalPrice, discountPercent]);

  // Keyboard Shortcuts inside modal
  useEffect(() => {
    if (!isCalculatorOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }

      if (mode === 'math') {
        if (e.key >= '0' && e.key <= '9') {
          handleKeyClick(e.key);
        } else if (e.key === '+') {
          handleKeyClick('+');
        } else if (e.key === '-') {
          handleKeyClick('-');
        } else if (e.key === '*' || e.key === 'x') {
          handleKeyClick('×');
        } else if (e.key === '/') {
          e.preventDefault();
          handleKeyClick('÷');
        } else if (e.key === '.' || e.key === ',') {
          handleKeyClick('.');
        } else if (e.key === '%') {
          handleKeyClick('%');
        } else if (e.key === 'Enter' || e.key === '=') {
          e.preventDefault();
          handleKeyClick('=');
        } else if (e.key === 'Backspace') {
          handleKeyClick('DEL');
        } else if (e.key.toLowerCase() === 'c') {
          handleKeyClick('C');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCalculatorOpen, mode, expression, handleClose]);

  if (!isCalculatorOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quick Calculator"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
    >
      {/* Backdrop */}
      <div
        ref={backdropRef}
        onClick={handleClose}
        className="fixed inset-0 bg-black/75 transition-opacity duration-200"
      />

      {/* Modal Dialog */}
      <div
        ref={modalRef}
        className="relative w-full max-w-md bg-white dark:bg-[#18181a] border border-slate-200 dark:border-[#282828] rounded-[12px] shadow-2xl overflow-hidden flex flex-col z-10 transition-all font-sans select-none"
      >
        {/* iOS Grabber (Mobile indicator) */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-0.5">
          <div className="w-9 h-1 rounded-full bg-black/20 dark:bg-white/20" />
        </div>

        {/* 1. Header with Mode Tabs */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-[#262626] bg-slate-50/70 dark:bg-[#141414]/70">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-[6px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-[#3ecf8e] flex items-center justify-center">
              <Calculator className="w-4 h-4 stroke-[2]" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-white tracking-tight flex items-center gap-1.5">
                <span>Quick Calculator</span>
                {mode === 'pro' && (
                  <span className="px-1.5 py-0.2 rounded-[4px] bg-[#3ecf8e]/10 text-emerald-700 dark:text-[#3ecf8e] text-[9px] font-mono font-bold border border-[#3ecf8e]/30">
                    DISCOUNT PRO
                  </span>
                )}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Mode Switcher: Math vs Pro */}
            <div className="w-36">
              <SegmentedControl<CalcMode>
                size="sm"
                options={[
                  { id: 'math', label: 'Math' },
                  { id: 'pro', label: 'Pro' },
                ]}
                value={mode}
                onChange={(val) => {
                  triggerHaptic('selection');
                  setMode(val);
                }}
              />
            </div>

            {/* Close Button */}
            <button
              type="button"
              onClick={handleClose}
              className="w-7 h-7 flex items-center justify-center rounded-[6px] text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-[#242424] hover:bg-slate-200 dark:hover:bg-[#2c2c2c] transition-colors cursor-pointer"
              title="Close and Clear Calculator"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 2. Main Body */}
        {mode === 'math' ? (
          /* ========================================================================= */
          /* MATH (SIMPLE) MODE                                                        */
          /* ========================================================================= */
          <div className="p-4 flex flex-col gap-3">
            {/* Display Screen */}
            <div className="bg-slate-50 dark:bg-[#121214] border border-slate-200 dark:border-[#262626] rounded-[10px] p-3.5 flex flex-col justify-end items-end min-h-[88px] relative overflow-hidden shadow-inner">
              <div className="text-xs font-mono text-slate-400 dark:text-[#8e8e93] truncate max-w-full">
                {expression}
              </div>
              <div className="text-2xl sm:text-3xl font-mono font-bold tabular-nums text-slate-900 dark:text-white tracking-tight flex items-baseline gap-1">
                {formatINR(currentMathResult)}
              </div>
            </div>

            {/* GST Add & Cut Chips (5%, 18%, 28%) */}
            <div className="space-y-1.5">
              {/* Row 1: Add GST */}
              <div className="grid grid-cols-3 gap-1.5">
                {[5, 18, 28].map((gst) => (
                  <button
                    key={`add-${gst}`}
                    type="button"
                    onClick={() => handleAddGst(gst as 5 | 18 | 28)}
                    className="py-1.5 px-2 text-xs font-mono font-semibold rounded-[6px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/20 transition-all cursor-pointer ios-press active:scale-95"
                    title={`Add +${gst}% GST on top of ₹${expression}`}
                  >
                    +{gst}% GST
                  </button>
                ))}
              </div>

              {/* Row 2: Remove / Cut GST (Reverse GST Extraction) */}
              <div className="grid grid-cols-3 gap-1.5">
                {[5, 18, 28].map((gst) => (
                  <button
                    key={`cut-${gst}`}
                    type="button"
                    onClick={() => handleRemoveGst(gst as 5 | 18 | 28)}
                    className="py-1.5 px-2 text-xs font-mono font-semibold rounded-[6px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-400 border border-rose-500/20 transition-all cursor-pointer ios-press active:scale-95"
                    title={`Remove / Cut -${gst}% GST from inclusive gross amount ₹${expression}`}
                  >
                    -{gst}% GST Cut
                  </button>
                ))}
              </div>
            </div>

            {/* Keypad Grid (4x5) */}
            <div className="grid grid-cols-4 gap-2 font-mono text-sm select-none">
              <button
                type="button"
                onClick={() => handleKeyClick('C')}
                className="h-11 rounded-[6px] bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 font-bold cursor-pointer ios-press text-sm"
              >
                C
              </button>
              <button
                type="button"
                onClick={() => handleKeyClick('DEL')}
                className="h-11 rounded-[6px] bg-slate-100 dark:bg-[#202024] text-slate-700 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-[#2a2a2e] border border-slate-200 dark:border-[#2e2e32] cursor-pointer ios-press font-semibold"
              >
                ⌫
              </button>
              <button
                type="button"
                onClick={() => handleKeyClick('%')}
                className="h-11 rounded-[6px] bg-slate-100 dark:bg-[#202024] text-slate-700 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-[#2a2a2e] border border-slate-200 dark:border-[#2e2e32] font-semibold cursor-pointer ios-press"
              >
                %
              </button>
              <button
                type="button"
                onClick={() => handleKeyClick('÷')}
                className="h-11 rounded-[6px] bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] hover:bg-emerald-500/20 border border-emerald-500/20 font-bold cursor-pointer ios-press text-base"
              >
                ÷
              </button>

              {['7', '8', '9'].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => handleKeyClick(n)}
                  className="h-11 rounded-[6px] bg-white dark:bg-[#202024] text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-[#26262a] border border-slate-200 dark:border-[#2e2e32] text-base font-semibold shadow-2xs cursor-pointer ios-press"
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleKeyClick('×')}
                className="h-11 rounded-[6px] bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] hover:bg-emerald-500/20 border border-emerald-500/20 font-bold cursor-pointer ios-press text-base"
              >
                ×
              </button>

              {['4', '5', '6'].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => handleKeyClick(n)}
                  className="h-11 rounded-[6px] bg-white dark:bg-[#202024] text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-[#26262a] border border-slate-200 dark:border-[#2e2e32] text-base font-semibold shadow-2xs cursor-pointer ios-press"
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleKeyClick('-')}
                className="h-11 rounded-[6px] bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] hover:bg-emerald-500/20 border border-emerald-500/20 font-bold cursor-pointer ios-press text-base"
              >
                -
              </button>

              {['1', '2', '3'].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => handleKeyClick(n)}
                  className="h-11 rounded-[6px] bg-white dark:bg-[#202024] text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-[#26262a] border border-slate-200 dark:border-[#2e2e32] text-base font-semibold shadow-2xs cursor-pointer ios-press"
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleKeyClick('+')}
                className="h-11 rounded-[6px] bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] hover:bg-emerald-500/20 border border-emerald-500/20 font-bold cursor-pointer ios-press text-base"
              >
                +
              </button>

              <button
                type="button"
                onClick={() => handleKeyClick('+/-')}
                className="h-11 rounded-[6px] bg-slate-100 dark:bg-[#202024] text-slate-800 dark:text-zinc-200 hover:bg-slate-200 dark:hover:bg-[#26262a] border border-slate-200 dark:border-[#2e2e32] text-sm font-semibold shadow-2xs cursor-pointer ios-press"
              >
                ±
              </button>
              <button
                type="button"
                onClick={() => handleKeyClick('0')}
                className="h-11 rounded-[6px] bg-white dark:bg-[#202024] text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-[#26262a] border border-slate-200 dark:border-[#2e2e32] text-base font-semibold shadow-2xs cursor-pointer ios-press"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => handleKeyClick('.')}
                className="h-11 rounded-[6px] bg-white dark:bg-[#202024] text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-[#26262a] border border-slate-200 dark:border-[#2e2e32] text-base font-bold shadow-2xs cursor-pointer ios-press"
              >
                .
              </button>
              <button
                type="button"
                onClick={() => handleKeyClick('=')}
                className="h-11 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#141414] font-bold text-lg shadow-sm cursor-pointer ios-press"
              >
                =
              </button>
            </div>
          </div>
        ) : (
          /* ========================================================================= */
          /* PRO MODE (Fast Discount Calculator with 5% & 10% Quick Chips)             */
          /* ========================================================================= */
          <div className="p-4 flex flex-col gap-3.5">
            {/* Input 1: Original MRP / Price */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-[#EDEDED] flex items-center justify-between">
                <span>Original MRP / Bill Amount (₹)</span>
                <span className="text-[10px] text-slate-400 font-mono">Before Discount</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={originalPrice}
                  onChange={(e) => setOriginalPrice(e.target.value)}
                  placeholder="e.g. 4500"
                  className="w-full h-10 min-h-[40px] px-3.5 rounded-[6px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] font-mono text-base font-bold text-slate-900 dark:text-white focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 tabular-nums shadow-2xs"
                />
                {originalPrice && (
                  <button
                    type="button"
                    onClick={() => setOriginalPrice('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-white font-mono cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Input 2: Discount Percentage (%) with ONLY 5% and 10% Quick Preset Chips */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-[#EDEDED] flex items-center justify-between">
                <span>Discount Percentage (%)</span>
                <span className="text-[10px] text-slate-400 font-mono">5% / 10% Quick or Custom</span>
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(e.target.value)}
                    placeholder="10"
                    className="w-full h-10 min-h-[40px] px-3 pr-7 rounded-[6px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] font-mono text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 tabular-nums shadow-2xs"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-mono pointer-events-none">
                    %
                  </span>
                </div>

                {/* ONLY 5% and 10% Preset Chips */}
                <div className="flex gap-1.5 shrink-0">
                  {[5, 10].map((dPct) => (
                    <button
                      key={dPct}
                      type="button"
                      onClick={() => {
                        triggerHaptic('light');
                        setDiscountPercent(String(dPct));
                      }}
                      className={cn(
                        'w-20 h-10 rounded-[6px] text-xs font-mono font-bold transition-all cursor-pointer border',
                        Number(discountPercent) === dPct
                          ? 'bg-[#3ecf8e] text-[#141414] border-[#3ecf8e] shadow-xs'
                          : 'bg-slate-100 dark:bg-[#202024] text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-[#2e2e32] hover:bg-slate-200 dark:hover:bg-[#28282c]'
                      )}
                    >
                      {dPct}% OFF
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Result Summary Card */}
            <div className="p-4 rounded-[10px] bg-slate-50 dark:bg-[#121214] border border-slate-200 dark:border-[#262626] space-y-2.5">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-[#222226]">
                <div>
                  <span className="text-xs text-slate-500 dark:text-[#8e8e93] block">Final Payable Price</span>
                  <strong className="text-2xl font-mono font-bold text-emerald-700 dark:text-[#3ecf8e] tabular-nums">
                    {formatINR(discountCalculations.finalPrice)}
                  </strong>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs pt-0.5">
                <div className="p-2 rounded-[6px] bg-rose-500/10 border border-rose-500/20">
                  <span className="text-[10px] text-rose-600 dark:text-rose-400 font-mono block">Customer Savings:</span>
                  <strong className="font-mono text-sm text-rose-600 dark:text-rose-400">
                    -{formatINR(discountCalculations.savings)}
                  </strong>
                </div>
                <div className="p-2 rounded-[6px] bg-slate-100 dark:bg-[#202024] border border-slate-200 dark:border-[#2e2e32]">
                  <span className="text-[10px] text-slate-500 dark:text-[#8e8e93] font-mono block">Discount Rate:</span>
                  <strong className="font-mono text-sm text-slate-800 dark:text-zinc-200">
                    {discountCalculations.percent}% OFF
                  </strong>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3. Footer Bar */}
        <div className="p-3 border-t border-slate-200 dark:border-[#242424] bg-slate-50/80 dark:bg-[#141414] flex items-center justify-between gap-2">
          <div className="text-xs text-slate-500 dark:text-[#8e8e93] flex items-center gap-1 font-mono">
            <span>Result:</span>
            <strong className="font-mono text-slate-900 dark:text-white tabular-nums">
              {formatINR(mode === 'math' ? currentMathResult : discountCalculations.finalPrice)}
            </strong>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 h-8 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:text-slate-900 dark:hover:text-white rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] hover:bg-slate-100 dark:hover:bg-[#202020] transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PosQuickCalculator;
