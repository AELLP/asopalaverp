import React, { useState, useEffect, useRef } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useAuthStore } from '@/store/authStore';
import { erpService } from '@/lib/erpService';
import { formatINR, cn } from '@/lib/utils';
import { BillUploader } from '@/components/vouchers/BillUploader';
import { TouchSignatureCanvas } from '@/components/advances/TouchSignatureCanvas';
import { Avatar, AvatarFallback } from '@/components/ui/Avatar';
import { SlideOverDrawer } from '@/components/ui/SlideOverDrawer';
import {
  X,
  Check,
  AlertCircle,
  Receipt,
  Coins,
  CheckCircle2,
  FileCheck,
} from 'lucide-react';
import { showToast } from '@/components/ui/ToastContainer';
import { SubmitButton } from '@/components/ui/SubmitButton';

interface SettleAdvanceDrawerProps {
  onSuccess: () => void;
}

export const SettleAdvanceDrawer: React.FC<SettleAdvanceDrawerProps> = ({ onSuccess }) => {
  const { settleTargetAdvance, setSettleTargetAdvance } = useUIStore();
  const { user } = useAuthStore();

  const [billsAmount, setBillsAmount] = useState<number | ''>('');
  const [cashReturnAmount, setCashReturnAmount] = useState<number | ''>('');
  const [proofPhotos, setProofPhotos] = useState<string[]>([]);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [error, setError] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Reset state on open
  useEffect(() => {
    if (settleTargetAdvance) {
      setBillsAmount('');
      setCashReturnAmount('');
      setProofPhotos([]);
      setSignatureDataUrl('');
      setError('');
      setIsPreviewOpen(false);
    }
  }, [settleTargetAdvance]);

  if (!settleTargetAdvance) return null;

  const adv = settleTargetAdvance;
  const remainingToSettle = Number(adv.unsettled_balance) || 0;
  const bAmount = Number(billsAmount) || 0;
  const cAmount = Number(cashReturnAmount) || 0;
  const totalSettle = bAmount + cAmount;
  const isOverSettled = totalSettle > remainingToSettle;
  const newBalance = Math.max(0, remainingToSettle - totalSettle);
  const isFullySettled = totalSettle === remainingToSettle && remainingToSettle > 0;

  const handleClose = () => {
    setSettleTargetAdvance(null);
    setIsPreviewOpen(false);
  };

  const handleQuickSettleAllBills = () => {
    setBillsAmount(remainingToSettle);
    setCashReturnAmount('');
    setError('');
  };

  const handleQuickSettleAllCash = () => {
    setCashReturnAmount(remainingToSettle);
    setBillsAmount('');
    setError('');
  };

  const handleQuickSplitEqual = () => {
    const half = Math.floor(remainingToSettle / 2);
    setBillsAmount(half);
    setCashReturnAmount(remainingToSettle - half);
    setError('');
  };

  const handleValidateAndPreview = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (totalSettle <= 0) {
      const msg = 'Enter bills amount or cash return amount.';
      setError(msg);
      showToast({
        type: 'error',
        title: 'Amount Required',
        message: msg,
      });
      return;
    }

    if (isOverSettled) {
      const msg = `Total settlement (${formatINR(totalSettle)}) cannot exceed remaining due of ${formatINR(remainingToSettle)}.`;
      setError(msg);
      showToast({
        type: 'error',
        title: 'Amount Exceeded',
        message: msg,
      });
      return;
    }

    if (!signatureDataUrl) {
      const msg = 'Staff digital signature is required to verify advance settlement.';
      setError(msg);
      showToast({
        type: 'error',
        title: 'Signature Required',
        message: msg,
      });
      return;
    }

    setIsPreviewOpen(true);
  };

  const handleConfirmFinalSubmit = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    const allProofs = [...proofPhotos];
    if (signatureDataUrl) {
      allProofs.push(signatureDataUrl);
    }

    setSubmitting(true);
    try {
      const userName = `${user?.first_name || 'Store'} ${user?.last_name || 'Manager'}`.trim();
      const userRole = user?.role_code || 'Store_Manager';

      await erpService.settleStaffAdvance({
        advanceId: adv.id,
        receiptNumber: adv.receipt_number,
        staffCode: adv.staff_code,
        branchId: adv.branch_id,
        branchCode: adv.branch_code,
        billsSubmittedAmount: bAmount,
        cashReturnedAmount: cAmount,
        settlementProofs: allProofs,
        userName,
        userRole,
      });

      showToast({
        type: 'success',
        title: 'Settlement Saved',
        message: `₹${totalSettle.toLocaleString('en-IN')} settlement recorded for ${adv.staff_name}.`,
      });

      onSuccess();
      handleClose();
    } catch (err: any) {
      console.error('Error settling staff advance:', err);
      setError(err.message || 'Failed to record settlement.');
      showToast({
        type: 'error',
        title: 'Settlement Failed',
        message: err.message || 'Failed to record settlement.',
      });
    } finally {
      setSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  const staffInitials = adv.staff_name
    ? adv.staff_name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((n) => n[0])
        .join('')
        .toUpperCase()
    : 'ST';

  const drawerBadge = (
    <span className="inline-flex items-center px-2 py-0.5 rounded-[4px] badge-status-amber text-[11px] font-sans font-medium select-none">
      SETTLE
    </span>
  );

  const drawerFooter = (
    <>
      <div className="min-w-0">
        <div className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-zinc-400">
          Total Settlement
        </div>
        <div className="font-mono font-medium text-base sm:text-lg text-slate-900 dark:text-white tabular-nums truncate">
          {formatINR(totalSettle)}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleClose}
          className="inline-flex items-center gap-1.5 h-10 min-h-[40px] px-4 rounded-[6px] border border-slate-300 dark:border-[#2e2e2e] bg-white dark:bg-[#202020] text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-[#282828] text-xs font-medium font-sans cursor-pointer transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          <span>Cancel</span>
        </button>

        <button
          type="button"
          onClick={handleValidateAndPreview}
          disabled={submitting || isOverSettled || totalSettle <= 0}
          className={cn(
            'inline-flex items-center gap-1.5 h-10 min-h-[40px] px-4 rounded-[6px] text-xs font-medium font-sans transition-colors cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed',
            isOverSettled || totalSettle <= 0
              ? 'bg-slate-200 dark:bg-[#2a2a2a] text-slate-400 dark:text-zinc-500 shadow-none'
              : 'bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717]'
          )}
        >
          <Check className="w-3.5 h-3.5 text-[#171717] stroke-[2.5]" />
          <span>Settle</span>
        </button>
      </div>
    </>
  );

  return (
    <>
      <SlideOverDrawer
        isOpen={Boolean(settleTargetAdvance)}
        onClose={handleClose}
        title={`Settle Advance #${adv.receipt_number}`}
        subtitle={`${adv.staff_name} (${adv.staff_code}) • Advance: ${formatINR(adv.advance_amount)}`}
        badge={drawerBadge}
        size="full"
        footer={drawerFooter}
      >
        <form onSubmit={handleValidateAndPreview} className="max-w-4xl mx-auto w-full space-y-4">
          {/* Error notification */}
          {error && (
            <div className="p-3 rounded-[8px] badge-status-rose flex items-center gap-2 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span className="font-medium font-sans">{error}</span>
            </div>
          )}

          {/* Staff & Advance Summary Card */}
          <div className="p-4 rounded-[8px] bg-slate-50/60 dark:bg-[#161616] border border-slate-200 dark:border-[#262626] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar size="md" shape="circle">
                  <AvatarFallback>{staffInitials}</AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-slate-900 dark:text-white">
                      {adv.staff_name}
                    </span>
                    <span className="px-1.5 py-0.5 rounded-[4px] text-[10px] font-mono bg-slate-100 dark:bg-[#141414] text-slate-600 dark:text-zinc-400 font-medium border border-slate-200 dark:border-[#2e2e2e]">
                      {adv.staff_code}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-0.5">
                    {adv.department_name || 'Showroom'} · {adv.designation || 'Staff'} ({adv.branch_code})
                  </p>
                </div>
              </div>

              <div className="text-right">
                <span className="text-[10px] font-mono uppercase text-slate-400 block">Original Advance</span>
                <span className="font-mono text-sm font-medium text-slate-900 dark:text-white tabular-nums">
                  {formatINR(adv.advance_amount)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-[#262626]">
              <div className="p-2.5 rounded-[6px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#262626]">
                <span className="text-[10px] uppercase font-mono text-slate-400 block">Already Settled</span>
                <span className="text-xs font-mono font-medium text-emerald-600 dark:text-[#3ecf8e] tabular-nums">
                  {formatINR(Number(adv.advance_amount) - Number(adv.unsettled_balance))}
                </span>
              </div>
              <div className="p-2.5 rounded-[6px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#262626]">
                <span className="text-[10px] uppercase font-mono text-slate-400 block">Remaining Due</span>
                <span className="text-xs font-mono font-medium text-rose-600 dark:text-rose-400 tabular-nums">
                  {formatINR(remainingToSettle)}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Options */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-mono text-slate-500 dark:text-zinc-400">
              Quick Options:
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={handleQuickSettleAllBills}
                className="h-10 min-h-[40px] px-2 rounded-[6px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/20 text-xs font-medium font-sans transition-colors cursor-pointer text-center truncate flex items-center justify-center"
              >
                All Bills ({formatINR(remainingToSettle)})
              </button>
              <button
                type="button"
                onClick={handleQuickSettleAllCash}
                className="h-10 min-h-[40px] px-2 rounded-[6px] bg-sky-500/10 hover:bg-sky-500/20 text-sky-700 dark:text-sky-400 border border-sky-500/20 text-xs font-medium font-sans transition-colors cursor-pointer text-center truncate flex items-center justify-center"
              >
                All Cash ({formatINR(remainingToSettle)})
              </button>
              <button
                type="button"
                onClick={handleQuickSplitEqual}
                className="h-10 min-h-[40px] px-2 rounded-[6px] bg-slate-100 dark:bg-[#202020] hover:bg-slate-200 dark:hover:bg-[#282828] text-slate-700 dark:text-zinc-300 border border-slate-200 dark:border-[#2e2e2e] text-xs font-medium font-sans transition-colors cursor-pointer text-center truncate flex items-center justify-center"
              >
                Half & Half
              </button>
            </div>
          </div>

          {/* Settlement Inputs: Bills vs Cash */}
          <div className="space-y-3 p-4 rounded-[8px] bg-slate-50/60 dark:bg-[#161616] border border-slate-200 dark:border-[#262626]">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-800 dark:text-zinc-200 flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5 text-emerald-600 dark:text-[#3ecf8e]" />
                  <span>Bills Submitted (₹)</span>
                </label>
                {billsAmount !== '' && (
                  <button
                    type="button"
                    onClick={() => setBillsAmount('')}
                    className="text-[11px] font-mono text-rose-500 hover:underline cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="relative flex items-center rounded-[6px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] focus-within:border-[#3ecf8e] focus-within:ring-1 focus-within:ring-[#3ecf8e]/30 shadow-2xs h-10 min-h-[40px]">
                <span className="pl-3.5 text-sm font-mono text-slate-400">₹</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={billsAmount}
                  onChange={(e) => setBillsAmount(parseFloat(e.target.value) || '')}
                  placeholder="0.00"
                  className="w-full bg-transparent pl-2 pr-3.5 py-2 text-sm font-mono font-medium tabular-nums text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-[#262626]">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-800 dark:text-zinc-200 flex items-center gap-1.5">
                  <Coins className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                  <span>Cash Returned (₹)</span>
                </label>
                {cashReturnAmount !== '' && (
                  <button
                    type="button"
                    onClick={() => setCashReturnAmount('')}
                    className="text-[11px] font-mono text-rose-500 hover:underline cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="relative flex items-center rounded-[6px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] focus-within:border-[#3ecf8e] focus-within:ring-1 focus-within:ring-[#3ecf8e]/30 shadow-2xs h-10 min-h-[40px]">
                <span className="pl-3.5 text-sm font-mono text-slate-400">₹</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={cashReturnAmount}
                  onChange={(e) => setCashReturnAmount(parseFloat(e.target.value) || '')}
                  placeholder="0.00"
                  className="w-full bg-transparent pl-2 pr-3.5 py-2 text-sm font-mono font-medium tabular-nums text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Realtime Reconciliation Card */}
          <div
            className={cn(
              'p-4 rounded-[8px] border transition-all',
              isOverSettled
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300'
                : isFullySettled
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-[#3ecf8e]'
                : 'bg-slate-50 dark:bg-[#161616] border-slate-200 dark:border-[#262626] text-slate-800 dark:text-zinc-200'
            )}
          >
            <div className="flex items-center justify-between pb-2 border-b border-black/5 dark:border-white/5">
              <span className="text-xs font-medium font-sans">Total Settlement:</span>
              <span className="text-base font-mono font-medium tabular-nums">
                {formatINR(totalSettle)}
              </span>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs font-medium font-sans flex items-center gap-1.5">
                {isFullySettled ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-[#3ecf8e]" />
                    <span>Remaining Due: Fully Settled</span>
                  </>
                ) : (
                  <span>Remaining Due:</span>
                )}
              </span>
              <span
                className={cn(
                  'text-base font-mono font-medium tabular-nums',
                  isFullySettled ? 'text-emerald-600 dark:text-[#3ecf8e]' : 'text-amber-600 dark:text-amber-400'
                )}
              >
                {formatINR(newBalance)}
              </span>
            </div>

            {isOverSettled && (
              <div className="mt-2.5 pt-2 border-t border-rose-500/20 text-xs font-medium text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>
                  Exceeds due balance by {formatINR(totalSettle - remainingToSettle)}.
                </span>
              </div>
            )}
          </div>

          {/* Touch Digital Signature */}
          <div className="space-y-3 p-4 rounded-[8px] bg-slate-50/60 dark:bg-[#161616] border border-slate-200 dark:border-[#262626]">
            <div className="pb-1 border-b border-slate-200 dark:border-[#262626]">
              <label className="text-xs font-medium uppercase tracking-wider text-slate-700 dark:text-zinc-300 font-sans">
                Staff Signature <span className="text-rose-500">*</span>
              </label>
            </div>
            <TouchSignatureCanvas
              onSave={setSignatureDataUrl}
              staffName={adv.staff_name}
            />
          </div>

          {/* Bill / Slip Uploads */}
          <div className="space-y-2 p-4 rounded-[8px] bg-slate-50/60 dark:bg-[#161616] border border-slate-200 dark:border-[#262626]">
            <div className="pb-1 border-b border-slate-200 dark:border-[#262626]">
              <label className="text-xs font-medium uppercase tracking-wider text-slate-700 dark:text-zinc-300 font-sans">
                Attach Bills / Receipts
              </label>
            </div>
            <BillUploader photoUrls={proofPhotos} onChange={setProofPhotos} maxPhotos={3} />
          </div>
        </form>
      </SlideOverDrawer>

      {/* Pre-Commit Settlement Preview Modal */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#2e2e2e] rounded-[12px] shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 dark:border-[#242424] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-[#3ecf8e]" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white font-sans">
                  Confirm Settlement
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                className="p-1 rounded-[4px] text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Slip Content */}
            <div className="p-5 space-y-4 font-sans text-xs">
              <div className="p-3.5 rounded-[8px] bg-slate-50 dark:bg-[#181818] border border-slate-200 dark:border-[#262626] space-y-2 font-mono">
                <div className="flex justify-between items-center text-slate-500 dark:text-zinc-400">
                  <span>Staff Member</span>
                  <span className="font-medium text-slate-900 dark:text-white">{adv.staff_name}</span>
                </div>
                <div className="flex justify-between items-center text-slate-500 dark:text-zinc-400">
                  <span>Receipt No.</span>
                  <span className="font-medium text-slate-900 dark:text-white">#{adv.receipt_number}</span>
                </div>
                <div className="flex justify-between items-center text-slate-500 dark:text-zinc-400">
                  <span>Original Advance</span>
                  <span className="font-medium text-slate-900 dark:text-white">{formatINR(adv.advance_amount)}</span>
                </div>
              </div>

              <div className="p-3.5 rounded-[8px] bg-slate-50 dark:bg-[#181818] border border-slate-200 dark:border-[#262626] space-y-2 font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 dark:text-zinc-300">Bills Submitted</span>
                  <span className="font-semibold text-slate-900 dark:text-white tabular-nums">{formatINR(bAmount)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 dark:text-zinc-300">Cash Returned</span>
                  <span className="font-semibold text-slate-900 dark:text-white tabular-nums">{formatINR(cAmount)}</span>
                </div>
                <div className="pt-2 border-t border-slate-200 dark:border-[#262626] flex justify-between items-center">
                  <span className="text-slate-900 dark:text-white font-semibold">Total Settlement</span>
                  <span className="text-base font-bold text-emerald-600 dark:text-[#3ecf8e] tabular-nums">{formatINR(totalSettle)}</span>
                </div>
                <div className="flex justify-between items-center pt-1 text-slate-500 dark:text-zinc-400">
                  <span>Remaining Due</span>
                  <span className={cn('font-semibold tabular-nums', newBalance === 0 ? 'text-emerald-600 dark:text-[#3ecf8e]' : 'text-amber-500')}>
                    {formatINR(newBalance)}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="p-4 bg-slate-50/50 dark:bg-[#181818] border-t border-slate-200 dark:border-[#242424] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                className="px-3.5 py-1.5 rounded-[6px] border border-slate-300 dark:border-[#2e2e2e] bg-white dark:bg-[#202020] text-slate-700 dark:text-zinc-300 text-xs font-medium cursor-pointer"
              >
                Back & Edit
              </button>
              <SubmitButton
                type="button"
                loading={submitting}
                onClick={handleConfirmFinalSubmit}
                loadingText="Saving Settlement..."
                icon={<Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                className="px-4 py-1.5 text-xs font-semibold"
              >
                Confirm & Save
              </SubmitButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SettleAdvanceDrawer;
