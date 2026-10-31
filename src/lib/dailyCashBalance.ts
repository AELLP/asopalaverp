import { WalletLedger } from '@/types/database';
import { format } from 'date-fns';

export interface DayCashRecord {
  date: string; // 'YYYY-MM-DD'
  displayDate: string; // '16 Oct 2026, Fri'
  opening: number;
  inflow: number;
  outflow: number;
  net: number;
  closing: number;
  count: number;
  entries: WalletLedger[];
}

export interface PeriodCashSummary {
  periodOpening: number;
  periodInflows: number;
  periodOutflows: number;
  periodNet: number;
  periodClosing: number;
  currentWalletCash: number;
  days: DayCashRecord[];
  today: {
    opening: number;
    inflow: number;
    outflow: number;
    net: number;
    closing: number;
  };
}

/**
 * Calculates exact Day-by-Day Opening and Closing Cash Balances from immutable wallet ledger entries
 * anchored to the physical verified drawer balance.
 *
 * Mathematical Guarantee:
 *   Day Closing = Day Opening + Day Inflows - Day Outflows
 *   Next Day Opening = Previous Day Closing
 */
export function calculateDailyCashBalances(
  ledgerEntries: WalletLedger[],
  currentWalletCash: number,
  startDate?: string,
  endDate?: string
): PeriodCashSummary {
  // Filter exclusively for Cash transactions
  const cashEntries = ledgerEntries.filter((l) => l.wallet_type === 'Cash');

  // Group cash entries by calendar day (YYYY-MM-DD)
  const daysMap = new Map<
    string,
    { date: string; inflow: number; outflow: number; count: number; entries: WalletLedger[] }
  >();

  cashEntries.forEach((entry) => {
    const d = entry.created_at ? entry.created_at.slice(0, 10) : '';
    if (!d) return;

    if (!daysMap.has(d)) {
      daysMap.set(d, { date: d, inflow: 0, outflow: 0, count: 0, entries: [] });
    }
    const day = daysMap.get(d)!;
    day.inflow += Number(entry.credit_amount) || 0;
    day.outflow += Number(entry.debit_amount) || 0;
    day.count += 1;
    day.entries.push(entry);
  });

  // Ensure today's date exists in the timeline
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  if (!daysMap.has(todayStr)) {
    daysMap.set(todayStr, { date: todayStr, inflow: 0, outflow: 0, count: 0, entries: [] });
  }

  // Sort all active transaction days chronologically
  const sortedDays = Array.from(daysMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Compute backwards from the current verified wallet cash balance
  // The closing balance of the most recent day equals the current verified drawer cash!
  let runningClosing = currentWalletCash;
  const computedDaysMap = new Map<string, DayCashRecord>();

  for (let i = sortedDays.length - 1; i >= 0; i--) {
    const day = sortedDays[i];
    const net = day.inflow - day.outflow;
    const closing = runningClosing;
    const opening = closing - net;

    let displayDate = day.date;
    try {
      const parsedDate = new Date(`${day.date}T12:00:00`);
      displayDate = format(parsedDate, 'dd MMM yyyy, EEE');
    } catch {
      // Fallback
    }

    const record: DayCashRecord = {
      date: day.date,
      displayDate,
      opening,
      inflow: day.inflow,
      outflow: day.outflow,
      net,
      closing,
      count: day.count,
      entries: day.entries,
    };

    computedDaysMap.set(day.date, record);
    runningClosing = opening; // Previous day's closing is this day's opening
  }

  // Today's summary
  const todayRecord = computedDaysMap.get(todayStr) || {
    date: todayStr,
    displayDate: format(new Date(), 'dd MMM yyyy, EEE'),
    opening: currentWalletCash,
    inflow: 0,
    outflow: 0,
    net: 0,
    closing: currentWalletCash,
    count: 0,
    entries: [],
  };

  // Filter days by the requested date range bounds
  let filteredDays = Array.from(computedDaysMap.values()).sort((a, b) => b.date.localeCompare(a.date)); // Newest first

  if (startDate) {
    filteredDays = filteredDays.filter((d) => d.date >= startDate);
  }
  if (endDate) {
    filteredDays = filteredDays.filter((d) => d.date <= endDate);
  }

  // If filteredDays has entries, compute overall period opening, inflows, outflows, and closing
  let periodOpening = currentWalletCash;
  let periodClosing = currentWalletCash;
  let periodInflows = 0;
  let periodOutflows = 0;

  if (filteredDays.length > 0) {
    // Chronological order for bounds:
    const chrono = [...filteredDays].sort((a, b) => a.date.localeCompare(b.date));
    periodOpening = chrono[0].opening;
    periodClosing = chrono[chrono.length - 1].closing;
    periodInflows = chrono.reduce((sum, d) => sum + d.inflow, 0);
    periodOutflows = chrono.reduce((sum, d) => sum + d.outflow, 0);
  }

  return {
    periodOpening,
    periodInflows,
    periodOutflows,
    periodNet: periodInflows - periodOutflows,
    periodClosing,
    currentWalletCash,
    days: filteredDays,
    today: {
      opening: todayRecord.opening,
      inflow: todayRecord.inflow,
      outflow: todayRecord.outflow,
      net: todayRecord.net,
      closing: todayRecord.closing,
    },
  };
}

export interface TreasuryDailyBreakdown {
  cash: {
    opening: number;
    inflow: number;
    outflow: number;
    closing: number;
  };
  upi: {
    opening: number;
    inflow: number;
    outflow: number;
    closing: number;
  };
  total: {
    opening: number;
    inflow: number;
    outflow: number;
    closing: number;
  };
}

export function calculateDailyTreasuryBalances(
  ledgerEntries: WalletLedger[],
  currentWalletCash: number,
  currentWalletUpi: number
): TreasuryDailyBreakdown {
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  let cashInflowToday = 0;
  let cashOutflowToday = 0;
  let upiInflowToday = 0;
  let upiOutflowToday = 0;

  ledgerEntries.forEach((entry) => {
    const d = entry.created_at ? entry.created_at.slice(0, 10) : '';
    if (d !== todayStr) return;

    const credit = Number(entry.credit_amount) || 0;
    const debit = Number(entry.debit_amount) || 0;

    if (entry.wallet_type === 'UPI') {
      upiInflowToday += credit;
      upiOutflowToday += debit;
    } else {
      cashInflowToday += credit;
      cashOutflowToday += debit;
    }
  });

  const cashClosing = currentWalletCash;
  const upiClosing = currentWalletUpi;

  const cashOpening = Math.max(0, cashClosing - cashInflowToday + cashOutflowToday);
  const upiOpening = Math.max(0, upiClosing - upiInflowToday + upiOutflowToday);

  return {
    cash: {
      opening: cashOpening,
      inflow: cashInflowToday,
      outflow: cashOutflowToday,
      closing: cashClosing,
    },
    upi: {
      opening: upiOpening,
      inflow: upiInflowToday,
      outflow: upiOutflowToday,
      closing: upiClosing,
    },
    total: {
      opening: cashOpening + upiOpening,
      inflow: cashInflowToday + upiInflowToday,
      outflow: cashOutflowToday + upiOutflowToday,
      closing: cashClosing + upiClosing,
    },
  };
}
