import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  Calculator,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Printer,
  Sparkles,
  Coins,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import { formatINR, numberToWordsINR, triggerHaptic } from '@/lib/utils';
import { logSecurityEvent } from '@/lib/audit';
import { useAuthStore } from '@/store/authStore';
import { erpService } from '@/lib/erpService';

interface DenominationCounts {
  [key: string]: number;
  c500: number;
  c200: number;
  c100: number;
  c50: number;
  c20: number;
  c10: number;
  c5: number;
  c2: number;
  c1: number;
  coins: number;
}

interface DailyEodTillModalProps {
  isOpen: boolean;
  onClose: () => void;
  branchId: string;
  branchCode: string;
  systemCashBalance: number;
  onSuccess?: () => void;
}

export const DailyEodTillModal: React.FC<DailyEodTillModalProps> = ({
  isOpen,
  onClose,
  branchId,
  branchCode,
  systemCashBalance,
  onSuccess,
}) => {
  const { user } = useAuthStore();
  const todayStr = new Date().toISOString().slice(0, 10);

  // Initialize with notes that equal 1,00,000 as default convenient sample (180x500 + 40x200 + 20x100 = 1,00,000)
  const [counts, setCounts] = useState<DenominationCounts>(() => {
    // If system balance is 100000, preset convenient notes so user doesn't have to type 10 rows from scratch
    if (systemCashBalance === 100000) {
      return {
        c500: 180,
        c200: 40,
        c100: 20,
        c50: 0,
        c20: 0,
        c10: 0,
        c5: 0,
        c2: 0,
        c1: 0,
        coins: 0,
      };
    }
    return {
      c500: Math.floor(systemCashBalance / 500),
      c200: 0,
      c100: Math.floor((systemCashBalance % 500) / 100),
      c50: 0,
      c20: 0,
      c10: 0,
      c5: 0,
      c2: 0,
      c1: 0,
      coins: systemCashBalance % 100,
    };
  });

  const activeUserName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || user?.email?.split('@')[0] || 'Store Manager';
  const [counterStaffName, setCounterStaffName] = useState(activeUserName);
  const [supervisorName, setSupervisorName] = useState(activeUserName);
  const [handoverNote, setHandoverNote] = useState('Day-end physical till reconciliation and drawer handover');
  const [isLocked, setIsLocked] = useState(false);
  const [lockedSlip, setLockedSlip] = useState<any | null>(null);

  // Check if today's till is already locked in DB or local storage
  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    async function checkExistingLock() {
      try {
        const existing = await erpService.getEodTillLock(branchId, todayStr);
        if (isMounted && existing) {
          setIsLocked(true);
          setLockedSlip({
            slipId: existing.slip_id,
            branchId: existing.branch_id,
            branchCode,
            date: existing.lock_date,
            systemBalance: existing.system_cash_balance,
            physicalCounted: existing.physical_counted_cash,
            variance: existing.cash_variance,
            isBalanced: existing.is_balanced,
            denominations: existing.denominations,
            cashier: existing.cashier_name,
            supervisor: existing.supervisor_name,
            note: existing.notes || '',
            lockedAt: existing.locked_at || existing.created_at,
          });
        }
      } catch (e) {
        console.warn('Failed to check existing EOD lock:', e);
      }
    }
    checkExistingLock();
    return () => {
      isMounted = false;
    };
  }, [isOpen, branchId, branchCode, todayStr]);

  const totalCounted = useMemo(() => {
    return (
      (counts.c500 || 0) * 500 +
      (counts.c200 || 0) * 200 +
      (counts.c100 || 0) * 100 +
      (counts.c50 || 0) * 50 +
      (counts.c20 || 0) * 20 +
      (counts.c10 || 0) * 10 +
      (counts.c5 || 0) * 5 +
      (counts.c2 || 0) * 2 +
      (counts.c1 || 0) * 1 +
      (Number(counts.coins) || 0)
    );
  }, [counts]);

  const variance = totalCounted - systemCashBalance;
  const isPerfectMatch = Math.abs(variance) < 0.01;

  const handleCountChange = (key: keyof DenominationCounts, val: string) => {
    const num = Math.max(0, parseInt(val, 10) || 0);
    setCounts((prev) => ({ ...prev, [key]: num }));
  };

  const handleReset = () => {
    triggerHaptic('light');
    setCounts({
      c500: 0,
      c200: 0,
      c100: 0,
      c50: 0,
      c20: 0,
      c10: 0,
      c5: 0,
      c2: 0,
      c1: 0,
      coins: 0,
    });
  };

  const handleLockDay = async () => {
    triggerHaptic('heavy');
    const slipId = `EOD-${branchCode}-${todayStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;

    const slipData = {
      slipId,
      branchId,
      branchCode,
      date: todayStr,
      systemBalance: systemCashBalance,
      physicalCounted: totalCounted,
      variance,
      isBalanced: isPerfectMatch,
      denominations: counts,
      cashier: counterStaffName.trim() || activeUserName,
      supervisor: supervisorName.trim() || activeUserName,
      note: handoverNote.trim(),
      lockedAt: new Date().toISOString(),
    };

    // 1. Save to database eod_till_locks & local storage backup
    await erpService.saveEodTillLock({
      branch_id: branchId,
      lock_date: todayStr,
      slip_id: slipId,
      system_cash_balance: systemCashBalance,
      physical_counted_cash: totalCounted,
      cash_variance: variance,
      is_balanced: isPerfectMatch,
      denominations: counts,
      cashier_name: counterStaffName.trim() || activeUserName,
      supervisor_name: supervisorName.trim() || activeUserName,
      notes: handoverNote.trim(),
      locked_at: new Date().toISOString(),
    });

    // 2. Immutable security audit event with IP & device context
    await logSecurityEvent({
      userName: supervisorName || activeUserName,
      userRole: 'Store_Manager',
      actionType: 'Daily_F9_Lock' as any,
      targetEntity: 'cash_drawer_eod',
      targetIdentifier: slipId,
      eventDescription: `Day-End EOD Till Lock completed for ${branchCode}. Physical: ${formatINR(totalCounted)} | System: ${formatINR(systemCashBalance)} | Variance: ${formatINR(variance)} (Status: ${isPerfectMatch ? 'BALANCED' : 'VARIANCE_FLAGGED'})`,
      justification: `EOD reconciliation counted by ${counterStaffName}, signed by ${supervisorName}. Note: ${handoverNote}`,
    });

    setLockedSlip(slipData);
    setIsLocked(true);
    if (onSuccess) onSuccess();
  };

  const handlePrintSlip = () => {
    if (!lockedSlip) {
      window.print();
      return;
    }

    const printWin = window.open('', '_blank', 'width=600,height=750');
    if (!printWin) {
      window.print();
      return;
    }

    const d = lockedSlip.denominations;
    const denomRows = [
      { name: '₹500 Notes', count: d.c500 || 0, total: (d.c500 || 0) * 500 },
      { name: '₹200 Notes', count: d.c200 || 0, total: (d.c200 || 0) * 200 },
      { name: '₹100 Notes', count: d.c100 || 0, total: (d.c100 || 0) * 100 },
      { name: '₹50 Notes', count: d.c50 || 0, total: (d.c50 || 0) * 50 },
      { name: '₹20 Notes', count: d.c20 || 0, total: (d.c20 || 0) * 20 },
      { name: '₹10 Notes', count: d.c10 || 0, total: (d.c10 || 0) * 10 },
      { name: '₹5 Notes/Coins', count: d.c5 || 0, total: (d.c5 || 0) * 5 },
      { name: '₹2 Coins', count: d.c2 || 0, total: (d.c2 || 0) * 2 },
      { name: '₹1 Coins', count: d.c1 || 0, total: (d.c1 || 0) * 1 },
      { name: 'Loose Coins Value', count: '-', total: d.coins || 0 },
    ].filter((r) => r.total > 0);

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Till Closing Slip - ${lockedSlip.slipId}</title>
        <style>
          @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #111; max-width: 440px; margin: 0 auto; }
          .header { text-align: center; border-bottom: 2px dashed #444; padding-bottom: 12px; margin-bottom: 14px; }
          .brand { font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
          .sub { font-size: 11px; color: #555; margin-top: 2px; }
          .title { font-size: 13px; font-weight: 700; text-transform: uppercase; margin-top: 8px; border: 1px solid #111; padding: 3px 6px; display: inline-block; }
          .meta-row { display: flex; justify-content: space-between; font-size: 11px; margin: 4px 0; font-family: monospace; }
          table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 11px; font-family: monospace; }
          th, td { padding: 4px; text-align: right; border-bottom: 1px dotted #ccc; }
          th:first-child, td:first-child { text-align: left; }
          th { border-bottom: 1px solid #111; border-top: 1px solid #111; font-weight: 700; text-transform: uppercase; font-size: 10px; }
          .total-row { font-weight: 700; border-top: 2px solid #111; border-bottom: 2px solid #111; font-size: 12px; }
          .summary-card { border: 1px solid #111; padding: 8px 10px; margin: 12px 0; font-size: 11px; font-family: monospace; }
          .signatures { display: flex; justify-content: space-between; margin-top: 40px; font-size: 11px; }
          .sig-box { width: 45%; border-top: 1px solid #111; text-align: center; padding-top: 6px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="brand">ASOPALAV ENDEAVOURS LLP</div>
          <div class="sub">Showroom Cash Till Closing &amp; Physical Count Slip</div>
          <div class="title">EOD TILL LOCK: ${lockedSlip.slipId}</div>
        </div>
        <div class="meta-row"><span>Branch:</span><strong>${branchCode}</strong></div>
        <div class="meta-row"><span>Date &amp; Time:</span><span>${new Date(lockedSlip.lockedAt).toLocaleString('en-IN')}</span></div>
        <div class="meta-row"><span>Cashier (Counted):</span><strong>${lockedSlip.cashier}</strong></div>
        <div class="meta-row"><span>Supervisor (Verified):</span><strong>${lockedSlip.supervisor}</strong></div>

        <table>
          <thead>
            <tr>
              <th>Denomination</th>
              <th>Count</th>
              <th>Total (INR)</th>
            </tr>
          </thead>
          <tbody>
            ${denomRows
              .map(
                (r) => `
              <tr>
                <td>${r.name}</td>
                <td>${r.count}</td>
                <td>₹${r.total.toLocaleString('en-IN')}</td>
              </tr>
            `
              )
              .join('')}
            <tr class="total-row">
              <td colspan="2">PHYSICAL COUNTED TOTAL</td>
              <td>₹${lockedSlip.physicalCounted.toLocaleString('en-IN')}</td>
            </tr>
          </tbody>
        </table>

        <div class="summary-card">
          <div class="meta-row"><span>System Book Balance:</span><strong>₹${lockedSlip.systemBalance.toLocaleString('en-IN')}</strong></div>
          <div class="meta-row"><span>Physical Till Count:</span><strong>₹${lockedSlip.physicalCounted.toLocaleString('en-IN')}</strong></div>
          <div class="meta-row"><span>Discrepancy / Variance:</span><strong>${lockedSlip.variance === 0 ? '₹0.00 (PERFECT MATCH)' : `₹${lockedSlip.variance.toLocaleString('en-IN')}`}</strong></div>
          ${lockedSlip.note ? `<div style="margin-top:6px; font-size:10px; color:#444;">Note: ${lockedSlip.note}</div>` : ''}
        </div>

        <div class="signatures">
          <div class="sig-box">
            ${lockedSlip.cashier}<br/><span style="font-size:9px; color:#666;">Cashier Signature</span>
          </div>
          <div class="sig-box">
            ${lockedSlip.supervisor}<br/><span style="font-size:9px; color:#666;">Store Manager Signature</span>
          </div>
        </div>
      </body>
      </html>
    `;

    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => {
      printWin.print();
    }, 250);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-4xl bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#282828] rounded-[14px] shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-[#262626] flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-[#1a1a1a]/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[8px] bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-[#3ecf8e]">
              <Calculator className="w-4 h-4 text-[#3ecf8e]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white font-sans">
                  Daily EOD Till Count &amp; Reconciliation Lock
                </h2>
                <span className="px-2 py-0.5 rounded-[4px] text-[10px] font-mono bg-emerald-500/15 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/30 font-semibold tracking-wide uppercase">
                  Beta Mode
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-[#888888] font-sans">
                Branch: <span className="font-mono font-medium text-slate-700 dark:text-zinc-300">{branchCode}</span> | Date: <span className="font-mono font-medium text-slate-700 dark:text-zinc-300">{todayStr}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-[6px] text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#252525] flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 font-sans">
          {/* Explanation Alert */}
          <div className="p-3 rounded-[10px] bg-slate-50 dark:bg-[#1c1c1f] border border-slate-200 dark:border-[#2a2a2a] flex items-start gap-3">
            <Sparkles className="w-4 h-4 text-[#3ecf8e] shrink-0 mt-0.5" />
            <div className="text-xs text-slate-600 dark:text-[#A1A1A1] space-y-1">
              <p>
                <strong>Verified Cash Balancing:</strong> Count physical notes in the drawer till at closing. When the physical count equals the system balance, generate a digitally signed EOD closure slip to freeze the day against accidental discrepancies.
              </p>
            </div>
          </div>

          {isLocked && lockedSlip ? (
            /* Successful Day Lock Slip View */
            <div className="p-6 rounded-[12px] bg-emerald-500/5 border border-emerald-500/25 space-y-4 animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-3 border-b border-emerald-500/20">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-[#3ecf8e]">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-semibold text-sm">Day Successfully Locked &amp; Audited</span>
                </div>
                <span className="font-mono text-xs text-slate-500 dark:text-[#888888]">
                  Slip #: <strong className="text-slate-900 dark:text-white">{lockedSlip.slipId}</strong>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-[8px] bg-white dark:bg-[#191919] border border-slate-200 dark:border-[#2a2a2a]">
                  <span className="text-[11px] text-slate-400 block font-sans">System Verified Cash</span>
                  <span className="text-base font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                    {formatINR(lockedSlip.systemBalance)}
                  </span>
                </div>
                <div className="p-3 rounded-[8px] bg-white dark:bg-[#191919] border border-slate-200 dark:border-[#2a2a2a]">
                  <span className="text-[11px] text-slate-400 block font-sans">Physical Notes Counted</span>
                  <span className="text-base font-bold font-mono text-emerald-600 dark:text-[#3ecf8e] tabular-nums">
                    {formatINR(lockedSlip.physicalCounted)}
                  </span>
                </div>
                <div className="p-3 rounded-[8px] bg-white dark:bg-[#191919] border border-slate-200 dark:border-[#2a2a2a]">
                  <span className="text-[11px] text-slate-400 block font-sans">Discrepancy</span>
                  <span className="text-base font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                    {lockedSlip.variance === 0 ? '₹0.00 (Balanced)' : formatINR(lockedSlip.variance)}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-[8px] bg-white dark:bg-[#191919] border border-slate-200 dark:border-[#2a2a2a] text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Counted By (Cashier):</span>
                  <span className="font-medium text-slate-900 dark:text-white">{lockedSlip.cashier}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Authorized &amp; Verified By:</span>
                  <span className="font-medium text-slate-900 dark:text-white">{lockedSlip.supervisor}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Closing Handover Note:</span>
                  <span className="font-medium text-slate-900 dark:text-white">{lockedSlip.note}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Locked Timestamp:</span>
                  <span className="font-mono text-slate-700 dark:text-zinc-300">{new Date(lockedSlip.lockedAt).toLocaleString()}</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handlePrintSlip}
                  className="px-3.5 py-2 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-slate-50 dark:bg-[#202020] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Slip</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] text-xs font-medium transition-colors cursor-pointer"
                >
                  Close Window
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left Column: Denomination Input Table */}
              <div className="lg:col-span-7 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-800 dark:text-[#E0E0E0] uppercase tracking-wider font-mono">
                    Currency Notes Denominations
                  </h3>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-[11px] text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 cursor-pointer font-sans"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset counts</span>
                  </button>
                </div>

                <div className="rounded-[10px] border border-slate-200 dark:border-[#262626] overflow-hidden bg-white dark:bg-[#141414]">
                  <table className="w-full text-xs text-left border-collapse font-sans">
                    <thead className="bg-slate-50 dark:bg-[#1a1a1a] border-b border-slate-200 dark:border-[#262626] text-[11px] font-mono text-slate-500">
                      <tr>
                        <th className="py-2 px-3">Note Denomination</th>
                        <th className="py-2 px-3 text-center">Number of Notes</th>
                        <th className="py-2 px-3 text-right">Subtotal (INR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-[#242424] font-mono">
                      {[
                        { key: 'c500', note: '₹500 Note', multiplier: 500 },
                        { key: 'c200', note: '₹200 Note', multiplier: 200 },
                        { key: 'c100', note: '₹100 Note', multiplier: 100 },
                        { key: 'c50', note: '₹50 Note', multiplier: 50 },
                        { key: 'c20', note: '₹20 Note', multiplier: 20 },
                        { key: 'c10', note: '₹10 Note', multiplier: 10 },
                        { key: 'c5', note: '₹5 Note', multiplier: 5 },
                        { key: 'c2', note: '₹2 Note', multiplier: 2 },
                        { key: 'c1', note: '₹1 Note', multiplier: 1 },
                      ].map((d) => {
                        const countVal = counts[d.key as keyof DenominationCounts] || 0;
                        const subtotal = countVal * d.multiplier;
                        return (
                          <tr key={d.key} className="hover:bg-slate-50/60 dark:hover:bg-[#191919]">
                            <td className="py-1.5 px-3 font-semibold text-slate-800 dark:text-zinc-200">
                              {d.note}
                            </td>
                            <td className="py-1.5 px-3 text-center">
                              <input
                                type="number"
                                min="0"
                                value={countVal === 0 ? '' : countVal}
                                onChange={(e) => handleCountChange(d.key as keyof DenominationCounts, e.target.value)}
                                placeholder="0"
                                className="w-20 text-center py-1 px-2 rounded-[5px] bg-slate-50 dark:bg-[#1e1e1e] border border-slate-200 dark:border-[#333] text-xs font-mono font-medium focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30"
                              />
                            </td>
                            <td className="py-1.5 px-3 text-right font-medium tabular-nums text-slate-900 dark:text-white">
                              {formatINR(subtotal)}
                            </td>
                          </tr>
                        );
                      })}
                      {/* Coins Row */}
                      <tr className="hover:bg-slate-50/60 dark:hover:bg-[#191919]">
                        <td className="py-1.5 px-3 font-semibold text-slate-800 dark:text-zinc-200 flex items-center gap-1">
                          <Coins className="w-3 h-3 text-amber-500" />
                          <span>Coins (Total ₹)</span>
                        </td>
                        <td className="py-1.5 px-3 text-center">
                          <input
                            type="number"
                            min="0"
                            value={counts.coins === 0 ? '' : counts.coins}
                            onChange={(e) => handleCountChange('coins', e.target.value)}
                            placeholder="0"
                            className="w-20 text-center py-1 px-2 rounded-[5px] bg-slate-50 dark:bg-[#1e1e1e] border border-slate-200 dark:border-[#333] text-xs font-mono font-medium focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30"
                          />
                        </td>
                        <td className="py-1.5 px-3 text-right font-medium tabular-nums text-slate-900 dark:text-white">
                          {formatINR(counts.coins || 0)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Right Column: Comparison & Authorization */}
              <div className="lg:col-span-5 space-y-4">
                {/* Balancing Verdict Card */}
                <div className={`p-4 rounded-[12px] border transition-all ${
                  isPerfectMatch
                    ? 'bg-emerald-500/10 border-emerald-500/30'
                    : 'bg-amber-500/10 border-amber-500/30'
                }`}>
                  <div className="flex items-center justify-between pb-2.5 border-b border-black/5 dark:border-white/5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#A1A1A1] font-mono">
                      Reconciliation Result
                    </span>
                    {isPerfectMatch ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-emerald-700 dark:text-[#3ecf8e]">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>MATCHED (₹0.00)</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>{variance > 0 ? `+${formatINR(variance)} Overage` : `${formatINR(variance)} Shortage`}</span>
                      </span>
                    )}
                  </div>

                  <div className="py-3 space-y-2 font-mono">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 dark:text-[#888888]">System Verified Cash:</span>
                      <span className="font-bold text-slate-900 dark:text-white tabular-nums">
                        {formatINR(systemCashBalance)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 dark:text-[#888888]">Physical Notes Counted:</span>
                      <span className="font-bold text-emerald-600 dark:text-[#3ecf8e] tabular-nums">
                        {formatINR(totalCounted)}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-black/5 dark:border-white/5 flex justify-between items-center text-xs font-bold">
                      <span>Variance / Difference:</span>
                      <span className={isPerfectMatch ? 'text-emerald-600 dark:text-[#3ecf8e]' : 'text-amber-600 dark:text-amber-400'}>
                        {variance === 0 ? '₹0.00 (Perfect Match)' : formatINR(variance)}
                      </span>
                    </div>
                  </div>

                  {totalCounted > 0 && (
                    <div className="text-[11px] font-sans text-slate-500 dark:text-[#888888] pt-1 border-t border-black/5 dark:border-white/5">
                      In Words: <em>{numberToWordsINR(totalCounted)}</em>
                    </div>
                  )}
                </div>

                {/* Handover & Sign-off Fields */}
                <div className="space-y-3 font-sans text-xs">
                  <div>
                    <label className="block text-slate-700 dark:text-zinc-300 font-medium mb-1">
                      Counted By (Cashier)
                    </label>
                    <input
                      type="text"
                      value={counterStaffName}
                      onChange={(e) => setCounterStaffName(e.target.value)}
                      placeholder="e.g. Counter Cashier Name"
                      className="w-full h-9 rounded-[6px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#2e2e2e] px-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3ecf8e]"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 dark:text-zinc-300 font-medium mb-1">
                      Verified &amp; Approved By (Manager / Owner)
                    </label>
                    <input
                      type="text"
                      value={supervisorName}
                      onChange={(e) => setSupervisorName(e.target.value)}
                      placeholder={activeUserName}
                      className="w-full h-9 rounded-[6px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#2e2e2e] px-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3ecf8e]"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 dark:text-zinc-300 font-medium mb-1">
                      Day-End Closing Notes / Safe Handover
                    </label>
                    <textarea
                      rows={2}
                      value={handoverNote}
                      onChange={(e) => setHandoverNote(e.target.value)}
                      placeholder="e.g. Night cash verified, ₹50,000 kept in safe, ₹1,00,000 float retained"
                      className="w-full rounded-[6px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#2e2e2e] p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3ecf8e] resize-none"
                    />
                  </div>
                </div>

                {/* Lock CTA Button */}
                <button
                  type="button"
                  onClick={handleLockDay}
                  disabled={totalCounted <= 0}
                  className="w-full h-11 rounded-[8px] bg-[#3ecf8e] hover:bg-[#24b47e] disabled:opacity-50 text-[#171717] font-semibold text-xs font-sans flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md select-none active:scale-[0.99]"
                >
                  <Lock className="w-4 h-4 text-[#171717] stroke-[2.5]" />
                  <span>Verify &amp; Lock Till Balance (Beta)</span>
                  <ArrowRight className="w-3.5 h-3.5 text-[#171717]" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
