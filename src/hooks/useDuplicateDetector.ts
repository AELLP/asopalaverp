import { useState, useMemo, useCallback } from 'react';
import { ExpenseVoucher, WalletLedger } from '@/types/database';

export type DuplicateSeverity = 'critical' | 'warning' | 'info';

export type DuplicateType =
  | 'SAME_NUMBER_SAME_MONTH'
  | 'RAPID_SUBMISSION'
  | 'SAME_BILL_NUMBER';

export interface EnrichedDuplicateVoucher extends ExpenseVoucher {
  isDebitedInLedger: boolean;
  ledgerSequence?: number;
}

export interface DuplicateCluster {
  id: string;
  type: DuplicateType;
  severity: DuplicateSeverity;
  title: string;
  description: string;
  timeDiffSeconds?: number;
  timeDiffDisplay?: string;
  totalAtRiskAmount: number;
  vouchers: EnrichedDuplicateVoucher[];
}

const DISMISSED_CLUSTERS_STORAGE_KEY = 'asopalav_dismissed_duplicate_clusters';

export function useDuplicateDetector(
  vouchers: ExpenseVoucher[],
  ledgerEntries: WalletLedger[]
) {
  const [dismissedClusterIds, setDismissedClusterIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(DISMISSED_CLUSTERS_STORAGE_KEY);
      if (stored) {
        return new Set(JSON.parse(stored));
      }
    } catch {
      // fallback
    }
    return new Set<string>();
  });

  const ledgerRefs = useMemo(() => {
    const map = new Map<string, number>();
    ledgerEntries.forEach((l) => {
      if (l.reference_number) {
        map.set(l.reference_number, l.ledger_sequence);
      }
    });
    return map;
  }, [ledgerEntries]);

  // Helper to extract core voucher number digits (e.g. 'ASI-2608-g5yjg' -> 'ASI-2608')
  const getCoreVoucherPrefix = useCallback((vNum?: string | null): string => {
    if (!vNum) return '';
    const parts = vNum.split('-');
    if (parts.length >= 2) {
      return `${parts[0]}-${parts[1]}`.toUpperCase();
    }
    return vNum.toUpperCase();
  }, []);

  const clusters = useMemo(() => {
    // Only inspect vouchers that are not already voided
    const active = vouchers.filter((v) => v.status !== 'Voided');
    const detected: DuplicateCluster[] = [];

    // -------------------------------------------------------------------------
    // 1. RULE: Same Core Voucher Number in the Same Calendar Month
    // -------------------------------------------------------------------------
    const monthNumMap = new Map<string, ExpenseVoucher[]>();

    active.forEach((v) => {
      const month = (v.payment_date || v.created_at || '').slice(0, 7); // 'YYYY-MM'
      const core = getCoreVoucherPrefix(v.voucher_number);
      if (!core || !month) return;

      const branch = v.branch_code || v.branch_id || 'DEFAULT';
      const key = `${branch}_${month}_${core}`;

      if (!monthNumMap.has(key)) {
        monthNumMap.set(key, []);
      }
      monthNumMap.get(key)!.push(v);
    });

    monthNumMap.forEach((group, key) => {
      if (group.length > 1) {
        const first = group[0];
        const core = getCoreVoucherPrefix(first.voucher_number);
        const clusterId = `cluster-num-${key}`;

        const enriched: EnrichedDuplicateVoucher[] = group.map((v) => ({
          ...v,
          isDebitedInLedger: ledgerRefs.has(v.voucher_number),
          ledgerSequence: ledgerRefs.get(v.voucher_number),
        }));

        // Compute time difference between the first two if available
        let timeDiffSeconds: number | undefined;
        let timeDiffDisplay: string | undefined;
        if (group[0].created_at && group[1].created_at) {
          const t1 = new Date(group[0].created_at).getTime();
          const t2 = new Date(group[1].created_at).getTime();
          timeDiffSeconds = Math.abs(Math.round((t2 - t1) / 1000));
          if (timeDiffSeconds < 60) {
            timeDiffDisplay = `${timeDiffSeconds} seconds apart`;
          } else if (timeDiffSeconds < 3600) {
            timeDiffDisplay = `${Math.round(timeDiffSeconds / 60)} minutes apart`;
          } else {
            timeDiffDisplay = `${(timeDiffSeconds / 3600).toFixed(1)} hours apart`;
          }
        }

        const atRisk = enriched
          .filter((v) => !v.isDebitedInLedger || enriched.length > 1)
          .reduce((sum, v) => sum + (Number(v.total_amount) || 0), 0);

        detected.push({
          id: clusterId,
          type: 'SAME_NUMBER_SAME_MONTH',
          severity: 'critical',
          title: `Same Voucher Number Clash (#${core})`,
          description: `Voucher #${core} was submitted ${group.length} times in the same calendar month.`,
          timeDiffSeconds,
          timeDiffDisplay,
          totalAtRiskAmount: atRisk,
          vouchers: enriched,
        });
      }
    });

    // -------------------------------------------------------------------------
    // 2. RULE: Rapid Double-Click / Exact Same Amount + Payee Within 15 Minutes
    // -------------------------------------------------------------------------
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const v1 = active[i];
        const v2 = active[j];

        // Skip if already in the same-number cluster
        if (getCoreVoucherPrefix(v1.voucher_number) === getCoreVoucherPrefix(v2.voucher_number)) {
          continue;
        }

        // Only inspect recent vouchers (last 48 hours) to avoid false alerts on old historical bills
        const now = Date.now();
        const t1 = new Date(v1.created_at || v1.payment_date || '').getTime();
        const t2 = new Date(v2.created_at || v2.payment_date || '').getTime();
        if (now - t1 > 48 * 3600 * 1000 && now - t2 > 48 * 3600 * 1000) {
          continue;
        }

        if (Number(v1.total_amount) !== Number(v2.total_amount)) continue;
        if (Number(v1.total_amount) <= 0) continue;

        const d1 = (v1.payment_date || v1.created_at || '').slice(0, 10);
        const d2 = (v2.payment_date || v2.created_at || '').slice(0, 10);
        if (d1 !== d2) continue;

        const p1 = (v1.recipient_name || '').trim().toLowerCase();
        const p2 = (v2.recipient_name || '').trim().toLowerCase();
        const r1 = (v1.remarks || '').trim().toLowerCase();
        const r2 = (v2.remarks || '').trim().toLowerCase();

        const matchPayee = p1 && p1 === p2;
        const matchRemarks = r1 && r1 === r2;

        if (!matchPayee && !matchRemarks) continue;

        // Check timestamp difference
        if (v1.created_at && v2.created_at) {
          const t1 = new Date(v1.created_at).getTime();
          const t2 = new Date(v2.created_at).getTime();
          const diffSec = Math.abs(Math.round((t2 - t1) / 1000));

          // Within 15 minutes (900 seconds)
          if (diffSec <= 900) {
            const clusterId = `cluster-rapid-${[v1.id, v2.id].sort().join('-')}`;

            const timeDiffDisplay =
              diffSec < 60
                ? `${diffSec} seconds apart`
                : `${Math.round(diffSec / 60)} minutes apart`;

            const enriched: EnrichedDuplicateVoucher[] = [v1, v2].map((v) => ({
              ...v,
              isDebitedInLedger: ledgerRefs.has(v.voucher_number),
              ledgerSequence: ledgerRefs.get(v.voucher_number),
            }));

            detected.push({
              id: clusterId,
              type: 'RAPID_SUBMISSION',
              severity: 'warning',
              title: `Rapid Duplicate Submission (${v1.recipient_name || v1.remarks})`,
              description: `Identical amount (₹${v1.total_amount}) submitted within ${timeDiffDisplay}.`,
              timeDiffSeconds: diffSec,
              timeDiffDisplay,
              totalAtRiskAmount: Number(v1.total_amount) || 0,
              vouchers: enriched,
            });
          }
        }
      }
    }

    return detected;
  }, [vouchers, ledgerRefs, getCoreVoucherPrefix]);

  // Active un-dismissed clusters
  const activeClusters = useMemo(() => {
    return clusters.filter((c) => !dismissedClusterIds.has(c.id));
  }, [clusters, dismissedClusterIds]);

  const dismissCluster = useCallback((clusterId: string) => {
    setDismissedClusterIds((prev) => {
      const next = new Set(prev);
      next.add(clusterId);
      try {
        localStorage.setItem(DISMISSED_CLUSTERS_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const restoreDismissedClusters = useCallback(() => {
    setDismissedClusterIds(new Set());
    localStorage.removeItem(DISMISSED_CLUSTERS_STORAGE_KEY);
  }, []);

  const totalAtRiskAmount = useMemo(() => {
    return activeClusters.reduce((sum, c) => sum + c.totalAtRiskAmount, 0);
  }, [activeClusters]);

  return {
    clusters: activeClusters,
    allClustersCount: clusters.length,
    activeCount: activeClusters.length,
    totalAtRiskAmount,
    dismissCluster,
    restoreDismissedClusters,
  };
}
