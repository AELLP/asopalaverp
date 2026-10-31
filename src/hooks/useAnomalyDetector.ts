import { useMemo } from 'react';
import { ExpenseVoucher } from '@/types/database';

export interface AnomalyRecord {
  voucherId: string;
  voucherNumber: string;
  category: string;
  amount: number;
  categoryMedian: number;
  percentageOverMedian: number;
  zScore: number;
  reason: string;
  date?: string;
  recipientName?: string;
}

/**
 * Statistical Anomaly Radar (Google Cloud Monitoring / IQR & Z-Score Engine)
 * Automatically evaluates every voucher against its expense head's historical distribution.
 * Flags transactions that deviate significantly from category median and standard deviation.
 */
export function useAnomalyDetector(vouchers: ExpenseVoucher[]) {
  return useMemo(() => {
    // 1. Group valid non-voided vouchers by category
    const catMap = new Map<string, number[]>();
    const validVouchers = vouchers.filter(
      (v) =>
        v.status !== 'Voided' &&
        v.status !== 'Pending_Approval' &&
        v.payment_type !== 'Advance_Settlement' &&
        Number(v.total_amount) > 0
    );

    validVouchers.forEach((v) => {
      const cat = (v.category_name || 'Other').trim();
      const arr = catMap.get(cat) || [];
      arr.push(Number(v.total_amount));
      catMap.set(cat, arr);
    });

    // 2. Compute statistical median, mean, and standard deviation per category
    const catStats = new Map<
      string,
      { median: number; mean: number; stdDev: number; count: number }
    >();

    catMap.forEach((amounts, cat) => {
      if (amounts.length < 3) return; // Need at least 3 historical points to form a baseline
      const sorted = [...amounts].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 !== 0
          ? sorted[mid]
          : (sorted[mid - 1] + sorted[mid]) / 2;
      const mean = sorted.reduce((sum, val) => sum + val, 0) / sorted.length;
      const variance =
        sorted.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
        sorted.length;
      const stdDev = Math.sqrt(variance);

      catStats.set(cat, {
        median: Math.round(median),
        mean: Math.round(mean),
        stdDev: Math.round(stdDev),
        count: sorted.length,
      });
    });

    // 3. Scan all vouchers for statistical anomalies
    const anomaliesMap = new Map<string, AnomalyRecord>();
    const anomalyList: AnomalyRecord[] = [];

    validVouchers.forEach((v) => {
      const cat = (v.category_name || 'Other').trim();
      const stat = catStats.get(cat);
      if (!stat || stat.median <= 0) return;

      const amt = Number(v.total_amount);

      // Anomaly Condition:
      // Amount is >= 2.5x the category median AND exceeds mean + 1.8*stdDev, with a minimum absolute difference of ₹1,000
      const isOutlier =
        amt >= stat.median * 2.5 &&
        amt >= stat.mean + 1.8 * stat.stdDev &&
        amt - stat.median >= 1000;

      if (isOutlier) {
        const pct = Math.round(((amt - stat.median) / stat.median) * 100);
        const z =
          stat.stdDev > 0
            ? Math.round(((amt - stat.mean) / stat.stdDev) * 10) / 10
            : 2.5;

        const record: AnomalyRecord = {
          voucherId: v.id,
          voucherNumber: v.voucher_number,
          category: cat,
          amount: amt,
          categoryMedian: stat.median,
          percentageOverMedian: pct,
          zScore: z,
          reason: `+${pct}% above ${cat} median (₹${stat.median.toLocaleString('en-IN')})`,
          date: v.payment_date || (v.created_at ? v.created_at.slice(0, 10) : ''),
          recipientName: v.recipient_name,
        };

        anomaliesMap.set(v.id, record);
        anomalyList.push(record);
      }
    });

    // Sort anomaly list descending by percentage over median
    anomalyList.sort((a, b) => b.percentageOverMedian - a.percentageOverMedian);

    return {
      anomaliesMap,
      anomalyList,
      anomalyCount: anomalyList.length,
      categoryBaselines: catStats,
    };
  }, [vouchers]);
}
