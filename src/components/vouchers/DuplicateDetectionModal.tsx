import React, { useState } from 'react';
import {
  X,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  Trash2,
  Check,
  Eye,
  Clock,  Sparkles,} from 'lucide-react';
import { formatINR, cn, triggerHaptic, formatVoucherNumber } from '@/lib/utils';
import { format } from 'date-fns';
import { DuplicateCluster, EnrichedDuplicateVoucher } from '@/hooks/useDuplicateDetector';
import { erpService } from '@/lib/erpService';
import { showToast } from '@/components/ui/ToastContainer';
import { useAuthStore, isPrivilegedAdminRole } from '@/store/authStore';
import { useDialogStore } from '@/store/dialogStore';
import { useUIStore } from '@/store/uiStore';

interface DuplicateDetectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  clusters: DuplicateCluster[];
  onDismiss: (clusterId: string) => void;
  onRefresh: () => void;
}

export const DuplicateDetectionModal: React.FC<DuplicateDetectionModalProps> = ({
  isOpen,
  onClose,
  clusters,
  onDismiss,
  onRefresh,
}) => {
  const { user } = useAuthStore();
  const { openConfirm } = useDialogStore();
  const { openLightbox } = useUIStore();
  const [isVoiding, setIsVoiding] = useState<string | null>(null);

  const isAuditor = user?.role_code === 'Auditor';
  const isStoreManager = user?.role_code === 'Store_Manager';
  const isPrivileged = isPrivilegedAdminRole(user?.role_code);
  const todayStr = new Date().toISOString().slice(0, 10);

  if (!isOpen) return null;

  const totalAtRisk = clusters.reduce((sum, c) => sum + c.totalAtRiskAmount, 0);

  const handleVoidVoucher = (v: EnrichedDuplicateVoucher, cluster: DuplicateCluster) => {
    triggerHaptic('medium');
    openConfirm({
      title: `Void Duplicate Voucher #${formatVoucherNumber(v.voucher_number)}?`,
      message: `Are you sure you want to mark ${v.voucher_number} (${formatINR(v.total_amount)}) as VOIDED? This will deactivate the voucher and log a permanent audit record.`,
      confirmText: 'Yes, Void Voucher',
      cancelText: 'Keep As Is',
      variant: 'danger',
      onConfirm: async () => {
        try {
          setIsVoiding(v.id);
          const userName = `${user?.first_name || 'Admin'} ${user?.last_name || ''}`.trim();
          const userRole = user?.role_code || 'Store_Manager';
          const reason = `Voided via Duplicate Detection System: ${cluster.description || 'Duplicate entry'}`;

          await erpService.voidVoucher(v, reason, userName, userRole);

          showToast({
            type: 'success',
            title: 'Voucher Voided',
            message: `Voucher #${formatVoucherNumber(v.voucher_number)} has been voided.`,
          });
          triggerHaptic('heavy');
          onRefresh();
        } catch (err: any) {
          console.error('Error voiding voucher:', err);
          showToast({
            type: 'error',
            title: 'Could Not Void',
            message: err?.message || 'Failed to void duplicate voucher.',
          });
          triggerHaptic('error');
        } finally {
          setIsVoiding(null);
        }
      },
    });
  };

  const handleMarkLegitimate = (cluster: DuplicateCluster) => {
    triggerHaptic('light');
    onDismiss(cluster.id);
    showToast({
      type: 'info',
      title: 'Marked as Legitimate',
      message: 'Both entries have been marked genuine and dismissed from alerts.',
    });
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-200">
        <div
          role="dialog"
          aria-modal="true"
          className="bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] text-slate-900 dark:text-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden font-sans"
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-[#242424] flex items-start justify-between gap-4 bg-slate-50/80 dark:bg-[#181818]/60 shrink-0">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 shrink-0 mt-0.5">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="text-base sm:text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
                    Duplicate Detection & Resolution Studio
                  </h2>
                  {clusters.length > 0 ? (
                    <span className="px-2 py-0.5 rounded-[4px] bg-rose-500/15 border border-rose-500/30 text-rose-600 dark:text-rose-400 font-mono text-[11px] font-medium">
                      {clusters.length} Suspicious {clusters.length === 1 ? 'Cluster' : 'Clusters'}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-[4px] bg-[#3ecf8e]/15 border border-[#3ecf8e]/30 text-[#3ecf8e] font-mono text-[11px] font-medium">
                      All Clear
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-[#A1A1A1] mt-1">
                  Active audit radar detecting same-month voucher clashes, rapid re-entries, and un-debited phantom vouchers.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {totalAtRisk > 0 && (
                <div className="hidden sm:flex flex-col items-end">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-[#888]">
                    At-Risk Exposure
                  </span>
                  <span className="font-mono text-sm font-semibold text-rose-500 dark:text-rose-400">
                    {formatINR(totalAtRisk)}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#202020] transition-colors"
                title="Close (ESC)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            {clusters.length === 0 ? (
              <div className="py-16 text-center space-y-3">
                <div className="w-14 h-14 rounded-full bg-[#3ecf8e]/10 border border-[#3ecf8e]/30 flex items-center justify-center text-[#3ecf8e] mx-auto">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-base font-medium text-slate-900 dark:text-white">
                    Zero Duplicates Detected
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-[#A1A1A1] max-w-md mx-auto mt-1">
                    Every voucher number and financial expense in this showroom is unique and verified against physical drawer debits.
                  </p>
                </div>
              </div>
            ) : (
              clusters.map((cluster, cIdx) => (
                <div
                  key={cluster.id}
                  className="rounded-xl border border-slate-200 dark:border-[#262626] bg-slate-50/50 dark:bg-[#181818]/80 overflow-hidden shadow-sm"
                >
                  {/* Cluster Header */}
                  <div className="p-3 sm:px-4 bg-slate-100/80 dark:bg-[#1e1e1e] border-b border-slate-200 dark:border-[#282828] flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-[4px] text-[10px] font-mono uppercase font-semibold tracking-wider',
                          cluster.severity === 'critical'
                            ? 'bg-rose-500/15 border border-rose-500/30 text-rose-600 dark:text-rose-400'
                            : 'bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400'
                        )}
                      >
                        {cluster.severity === 'critical' ? 'Critical Clash' : 'Rapid Repeat'}
                      </span>
                      <h3 className="text-xs sm:text-sm font-medium text-slate-900 dark:text-white">
                        {cluster.title}
                      </h3>
                      {cluster.timeDiffDisplay && (
                        <span className="text-[11px] font-mono text-slate-500 dark:text-[#888] flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          {cluster.timeDiffDisplay}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleMarkLegitimate(cluster)}
                      className="px-2.5 py-1 rounded-[6px] border border-slate-200 dark:border-[#333] hover:border-slate-300 dark:hover:border-[#444] bg-white dark:bg-[#202020] text-xs font-medium text-slate-600 dark:text-[#ccc] hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5 text-[#3ecf8e]" />
                      <span>Mark Both Legitimate</span>
                    </button>
                  </div>

                  {/* Vouchers Comparison Grid */}
                  <div className="p-3 sm:p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {cluster.vouchers.map((v, vIdx) => {
                      const isVoidingThis = isVoiding === v.id;
                      const hasPhoto = v.bill_photo_urls && v.bill_photo_urls.length > 0;

                      return (
                        <div
                          key={v.id || v.voucher_number}
                          className={cn(
                            'p-3.5 rounded-lg border flex flex-col justify-between space-y-3 transition-colors',
                            !v.isDebitedInLedger
                              ? 'bg-rose-500/[0.04] dark:bg-rose-950/[0.1] border-rose-500/30'
                              : 'bg-white dark:bg-[#1a1a1a] border-slate-200/80 dark:border-[#262626]'
                          )}
                        >
                          {/* Top row: Voucher #, Amount, Ledger status */}
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-xs font-semibold text-slate-900 dark:text-white">
                                    #{formatVoucherNumber(v.voucher_number)}
                                  </span>
                                  <span className="text-[10px] font-mono text-slate-400">
                                    ({v.voucher_number})
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-[#888] font-mono mt-0.5">
                                  {v.created_at ? format(new Date(v.created_at), 'dd MMM yyyy, hh:mm:ss a') : v.payment_date}
                                </p>
                              </div>

                              <div className="text-right">
                                <span className="font-mono text-sm font-semibold text-slate-900 dark:text-white">
                                  {formatINR(v.total_amount)}
                                </span>
                                <div className="text-[10px] font-mono text-slate-500 dark:text-[#888]">
                                  {v.payment_method === 'Physical_Cash' ? 'Physical Cash' : 'Online UPI'}
                                </div>
                              </div>
                            </div>

                            {/* Ledger Debit Badge */}
                            <div className="pt-1">
                              {v.isDebitedInLedger ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[#3ecf8e]/10 border border-[#3ecf8e]/30 text-[#3ecf8e] font-mono text-[10px]">
                                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                                  <span>Debited from Drawer (Seq #{v.ledgerSequence || 'OK'})</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-rose-500/15 border border-rose-500/30 text-rose-600 dark:text-rose-400 font-mono text-[10px] font-semibold">
                                  <AlertTriangle className="w-3 h-3 shrink-0" />
                                  <span>PHANTOM VOUCHER · No Ledger Debit (Recommended to Void)</span>
                                </span>
                              )}
                            </div>

                            {/* Details Table */}
                            <div className="space-y-1 text-xs border-t border-slate-100 dark:border-[#262626] pt-2">
                              <div className="flex justify-between text-slate-600 dark:text-[#aaa]">
                                <span>Payee / Vendor:</span>
                                <span className="font-medium text-slate-900 dark:text-white truncate max-w-[200px]">
                                  {v.recipient_name || '—'}
                                </span>
                              </div>
                              <div className="flex justify-between text-slate-600 dark:text-[#aaa]">
                                <span>Category & Dept:</span>
                                <span className="font-medium text-slate-900 dark:text-white truncate max-w-[200px]">
                                  {v.category_name} {v.department_name ? `(${v.department_name})` : ''}
                                </span>
                              </div>
                              <div className="flex justify-between text-slate-600 dark:text-[#aaa]">
                                <span>Recorded By:</span>
                                <span className="font-medium text-slate-900 dark:text-white">
                                  {v.created_by_name || 'Cashier'}
                                </span>
                              </div>
                              {v.remarks && (
                                <div className="text-slate-500 dark:text-[#888] italic text-[11px] pt-0.5">
                                  "{v.remarks}"
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Bottom Action: Bill Photo & Void Button */}
                          <div className="pt-2 border-t border-slate-100 dark:border-[#262626] flex items-center justify-between gap-2">
                            {hasPhoto ? (
                              <button
                                type="button"
                                onClick={() => openLightbox(v.bill_photo_urls![0])}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-[4px] bg-slate-100 dark:bg-[#242424] text-[11px] font-medium text-slate-700 dark:text-[#ccc] hover:text-slate-900 dark:hover:text-white transition-colors"
                              >
                                <Eye className="w-3.5 h-3.5 text-[#3ecf8e]" />
                                <span>View Receipt</span>
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic">No bill photo</span>
                            )}

                            {(() => {
                              const vDate = (v.payment_date || v.created_at || '').slice(0, 10);
                              const isTodayVoucher = vDate === todayStr;
                              const canVoidThis = !isAuditor && (isPrivileged || (isStoreManager && isTodayVoucher));

                              if (!canVoidThis) {
                                return (
                                  <span className="text-[11px] text-slate-400 dark:text-zinc-500 italic">
                                    {isAuditor ? 'Auditor View Only' : 'Past Bill (Locked)'}
                                  </span>
                                );
                              }

                              return (
                                <button
                                  type="button"
                                  disabled={isVoidingThis}
                                  onClick={() => handleVoidVoucher(v, cluster)}
                                  className="px-2.5 py-1 rounded-[6px] border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>{isVoidingThis ? 'Voiding...' : 'Void Duplicate'}</span>
                                </button>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="p-3 sm:p-4 border-t border-slate-200 dark:border-[#242424] flex items-center justify-between bg-slate-50 dark:bg-[#161616] text-xs text-slate-500 dark:text-[#888]">
            <div className="flex items-center gap-1.5 font-mono">
              <Sparkles className="w-3.5 h-3.5 text-[#3ecf8e]" />
              <span>Real-time DB integrity engine</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-[6px] bg-slate-200 dark:bg-[#242424] text-slate-700 dark:text-white hover:bg-slate-300 dark:hover:bg-[#2c2c2c] transition-colors font-medium cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
