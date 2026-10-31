import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { format as formatDateFns, startOfWeek, startOfMonth, startOfQuarter, subDays, subMonths } from 'date-fns';
import { useAuthStore, isPrivilegedAdminRole } from '@/store/authStore';
import { useBranchStore } from '@/store/branchStore';
import { useUIStore } from '@/store/uiStore';
import { useVoucherStore } from '@/store/voucherStore';
import { erpService } from '@/lib/erpService';
import { calculateDailyCashBalances } from '@/lib/dailyCashBalance';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { formatINR, formatCompactINR, numberToWordsINR, formatDate, formatVoucherNumber, cn, triggerHaptic } from '@/lib/utils';
import { DailyEodTillModal } from '@/components/treasury/DailyEodTillModal';
import { DailyCashDrawerStatement } from '@/components/treasury/DailyCashDrawerStatement';
import { TreasuryPassbookTable } from '@/components/treasury/TreasuryPassbookTable';
import { DatePicker } from '@/components/ui/DatePicker';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { MetricCard } from '@/components/ui/MetricCard';
import { AccessDeniedView } from '@/components/common/AccessDeniedView';
import {
  Wallet,
  Coins,
  Calculator,  Building2,
  TrendingUp,  Receipt,  Check,  RotateCcw,  Search,  FileSpreadsheet,  X,  FileText,  RefreshCw,  Copy,} from 'lucide-react';
import { useGsapContext } from '@/hooks/useGsap';
import { animateStaggerCards } from '@/lib/animations';

type DateFilter = 'this_month' | 'today' | 'yesterday' | 'week' | 'all' | 'custom';
type ScopeFilter = 'ALL' | 'INFLOW' | 'OUTFLOW' | 'Float_Topup' | 'Expense_Voucher' | 'Safe_Drop' | 'Adjustment';
type SortOption = 'newest' | 'oldest' | 'highest_amount' | 'lowest_amount';

export const CashDrawerTreasuryPage: React.FC = () => {
  const { user, getAllowedBranches, isBranchAllowed } = useAuthStore();
  const { branches, selectedBranchId, getActiveBranch } = useBranchStore();
  const { setActivePage } = useUIStore();

  const isPrivileged = isPrivilegedAdminRole(user?.role_code);
  const isCashier = user?.role_code === 'Cashier' && !isPrivileged;
  const isDeveloper = isPrivileged || user?.role_code === 'Developer';

  const allowedBranches = getAllowedBranches(branches);
  const activeBranch = getActiveBranch();
  const initialBranch = (selectedBranchId && isBranchAllowed(selectedBranchId))
    ? selectedBranchId
    : (allowedBranches[0]?.branch_id || activeBranch?.branch_id || 'Aellp-ASI');

  const [selectedBranch, setSelectedBranch] = useState(initialBranch);
  const [entryDate, setEntryDate] = useState<string>(formatDateFns(new Date(), 'yyyy-MM-dd'));
  const [walletType, setWalletType] = useState<'Cash' | 'UPI'>('Cash');
  const [amount, setAmount] = useState<number | ''>('');
  const [transferMode, setTransferMode] = useState('');
  const [referenceNotes, setReferenceNotes] = useState('');

  const [currentCashBalance, setCurrentCashBalance] = useState(0);
  const [currentUpiBalance, setCurrentUpiBalance] = useState(0);
  const [allLedgerEntries, setAllLedgerEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Pro Enterprise Ledger View & Filter State
  const [scopeFilter] = useState<ScopeFilter>('ALL');  const [dateFilter, setDateFilter] = useState<DateFilter>('this_month');
  const [customDate, setCustomDate] = useState<string>(formatDateFns(new Date(), 'yyyy-MM-dd'));
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [selectedDayFilter, setSelectedDayFilter] = useState<string | null>(null);
    const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerWalletFilter, setLedgerWalletFilter] = useState<'ALL' | 'Cash' | 'UPI' | 'Float_Topup'>('ALL');
  const [sortBy] = useState<SortOption>('newest');  const [activeRowDropdownId, setActiveRowDropdownId] = useState<string | null>(null);
      const [viewLedgerEntry, setViewLedgerEntry] = useState<any | null>(null);
  const [copiedRef, setCopiedRef] = useState<string | null>(null);
  
  const [isEodModalOpen, setIsEodModalOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const containerRef = useGsapContext(() => {
    animateStaggerCards(containerRef.current, '.stagger-card', 0.03);
  }, [selectedBranch]);

  useEffect(() => {
    setSelectedBranch(selectedBranchId || activeBranch?.branch_id || 'Aellp-ASI');
  }, [selectedBranchId, activeBranch?.branch_id]);

  // Global keyboard shortcuts ('/' to search ledger, ESC to close popovers)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setActiveRowDropdownId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      if (
        activeRowDropdownId &&
        !(e.target as HTMLElement).closest(`[data-dropdown-id="${activeRowDropdownId}"]`)
      ) {
        setActiveRowDropdownId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeRowDropdownId]);

  const loadTreasuryData = useCallback(async () => {
    if (isCashier) return;
    setLoading(true);
    try {
      const [wallet, ledger] = await Promise.all([
        erpService.getBranchWallet(selectedBranch),
        erpService.getWalletLedger(selectedBranch),
        useVoucherStore.getState().fetchVouchers(selectedBranch),
      ]);
      setCurrentCashBalance(wallet?.cash_balance ?? 0);
      setCurrentUpiBalance(wallet?.upi_balance ?? 0);
      setAllLedgerEntries(ledger || []);
    } catch (err) {
      console.warn('Error loading treasury data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedBranch, isCashier]);

  useEffect(() => {
    loadTreasuryData();
    let timeoutId: any = null;
    const handleUpdates = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        loadTreasuryData();
      }, 300);
    };
    window.addEventListener('asopalav:wallet-updated', handleUpdates);
    window.addEventListener('asopalav:ledger-updated', handleUpdates);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('asopalav:wallet-updated', handleUpdates);
      window.removeEventListener('asopalav:ledger-updated', handleUpdates);
    };
  }, [loadTreasuryData, selectedBranch]);

  // Fast map of voucher details for ledger narration & category breakdown
  const voucherMap = useMemo(() => {
    const vStore = useVoucherStore.getState();
    const allCached = Object.values(vStore.vouchers).flat();
    const map = new Map<string, { category_name: string; recipient_name: string; total_amount: number; payment_method: string }>();
    allCached.forEach((v) => {
      if (v?.voucher_number) {
        map.set(v.voucher_number, {
          category_name: v.category_name,
          recipient_name: v.recipient_name,
          total_amount: Number(v.total_amount) || 0,
          payment_method: v.payment_method,
        });
      }
    });
    return map;
  }, [allLedgerEntries]);

  // Active statement date range bounds & label
  const dateBounds = useMemo(() => {
    const now = new Date();
    const todayStr = formatDateFns(now, 'yyyy-MM-dd');

    if (selectedDayFilter) {
      let label = selectedDayFilter;
      try {
        label = formatDateFns(new Date(`${selectedDayFilter}T12:00:00`), 'dd MMM yyyy, EEE');
      } catch {}
      return { start: selectedDayFilter, end: selectedDayFilter, label };
    }

    switch (dateFilter) {
      case 'today':
        return { start: todayStr, end: todayStr, label: 'Today' };
      case 'yesterday': {
        const yest = formatDateFns(subDays(now, 1), 'yyyy-MM-dd');
        return { start: yest, end: yest, label: 'Yesterday' };
      }
      case 'week': {
        const startOfWeekStr = formatDateFns(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
        return { start: startOfWeekStr, end: todayStr, label: 'Last 7 Days' };
      }
      case 'this_month': {
        const startOfMonthStr = formatDateFns(startOfMonth(now), 'yyyy-MM-dd');
        return { start: startOfMonthStr, end: todayStr, label: 'This Month' };
      }
      case 'custom': {
        const s = customStartDate || customDate || undefined;
        const e = customEndDate || customDate || undefined;
        let label = 'Custom Range';
        if (s && e) {
          if (s === e) {
            try {
              label = formatDateFns(new Date(`${s}T12:00:00`), 'dd MMM yyyy');
            } catch {}
          } else {
            try {
              label = `${formatDateFns(new Date(`${s}T12:00:00`), 'dd MMM')} – ${formatDateFns(new Date(`${e}T12:00:00`), 'dd MMM yyyy')}`;
            } catch {}
          }
        }
        return { start: s, end: e, label };
      }
      case 'all':
      default:
        return { start: undefined, end: undefined, label: 'All Time' };
    }
  }, [dateFilter, customDate, customStartDate, customEndDate, selectedDayFilter]);

  // Mathematical Day-by-Day Cash Balance Engine
  const dailyCashSummary = useMemo(() => {
    return calculateDailyCashBalances(
      allLedgerEntries,
      currentCashBalance,
      dateBounds.start,
      dateBounds.end
    );
  }, [allLedgerEntries, currentCashBalance, dateBounds.start, dateBounds.end]);

  // Dynamically compute running balance anchored backwards from the verified drawer balance
    // Cross-reference vouchers against ledger to detect any cash check discrepancies
    // Filtered allocations for Pro Enterprise Timeline / Feed & Full Table
  const filteredAllocations = useMemo(() => {
    let list = allLedgerEntries;

    if (scopeFilter === 'INFLOW') {
      list = list.filter((l) => (Number(l.credit_amount) || 0) > 0);
    } else if (scopeFilter === 'OUTFLOW') {
      list = list.filter((l) => (Number(l.debit_amount) || 0) > 0);
    } else if (scopeFilter !== 'ALL') {
      list = list.filter((l) => l.transaction_type === scopeFilter);
    }

    if (ledgerWalletFilter !== 'ALL') {
      list = list.filter((l) =>
        ledgerWalletFilter === 'Float_Topup'
          ? l.transaction_type === 'Float_Topup' || (Number(l.credit_amount) > 0 && !l.transaction_type)
          : l.wallet_type === ledgerWalletFilter
      );
    }

    if (selectedDayFilter) {
      list = list.filter((l) => (l.created_at || '').trim().slice(0, 10) === selectedDayFilter.trim());
    } else {
      if (dateBounds.start) {
        list = list.filter((l) => (l.created_at || '').trim().slice(0, 10) >= dateBounds.start!);
      }
      if (dateBounds.end) {
        list = list.filter((l) => (l.created_at || '').trim().slice(0, 10) <= dateBounds.end!);
      }
    }

    if (ledgerSearch.trim()) {
      const q = ledgerSearch.toLowerCase();
      list = list.filter(
        (l) =>
          (l.remarks && l.remarks.toLowerCase().includes(q)) ||
          (l.cashier_name && l.cashier_name.toLowerCase().includes(q)) ||
          (l.authorized_by_name && l.authorized_by_name.toLowerCase().includes(q)) ||
          (l.id && String(l.id).toLowerCase().includes(q)) ||
          (l.reference_number && String(l.reference_number).toLowerCase().includes(q)) ||
          (l.transaction_type && String(l.transaction_type).toLowerCase().includes(q)) ||
          (l.wallet_type && String(l.wallet_type).toLowerCase().includes(q)) ||
          String(l.credit_amount || l.debit_amount || '').includes(q)
      );
    }

    // Sort order
    const sorted = [...list].sort((a, b) => {
      if (sortBy === 'oldest') {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      if (sortBy === 'highest_amount') {
        const aAmt = Math.max(Number(a.credit_amount) || 0, Number(a.debit_amount) || 0);
        const bAmt = Math.max(Number(b.credit_amount) || 0, Number(b.debit_amount) || 0);
        return bAmt - aAmt;
      }
      if (sortBy === 'lowest_amount') {
        const aAmt = Math.max(Number(a.credit_amount) || 0, Number(a.debit_amount) || 0);
        const bAmt = Math.max(Number(b.credit_amount) || 0, Number(b.debit_amount) || 0);
        return aAmt - bAmt;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return sorted;
  }, [allLedgerEntries, scopeFilter, ledgerWalletFilter, dateBounds, selectedDayFilter, ledgerSearch, sortBy]);

  // Comprehensive Treasury Flow Summary (Top-ups, Inflow, Outflow, Net Position)
  const treasurySummary = useMemo(() => {
    let totalCashIn = 0;
    let totalCashOut = 0;
    let totalUpiIn = 0;
    let totalUpiOut = 0;
    let totalFloatTopups = 0;
    let topupCount = 0;
    let cashTopupCount = 0;
    let upiTopupCount = 0;
    let totalSafeDrops = 0;
    let safeDropCount = 0;
    let totalExpenses = 0;
    let expenseCount = 0;
    let cashExpenseCount = 0;
    let upiExpenseCount = 0;
    let totalAdjustments = 0;
    let adjustmentCount = 0;
    let creditCount = 0;
    let debitCount = 0;

    allLedgerEntries.forEach((entry) => {
      const credit = Number(entry.credit_amount) || 0;
      const debit = Number(entry.debit_amount) || 0;
      const isCash = entry.wallet_type === 'Cash' || !entry.wallet_type;
      const isUpi = entry.wallet_type === 'UPI';

      if (credit > 0) {
        creditCount++;
        if (isCash) {
          totalCashIn += credit;
          cashTopupCount++;
        }
        if (isUpi) {
          totalUpiIn += credit;
          upiTopupCount++;
        }
      }
      if (debit > 0) {
        debitCount++;
        if (isCash) {
          totalCashOut += debit;
          if (entry.transaction_type === 'Expense_Voucher') cashExpenseCount++;
        }
        if (isUpi) {
          totalUpiOut += debit;
          if (entry.transaction_type === 'Expense_Voucher') upiExpenseCount++;
        }
      }

      if (entry.transaction_type === 'Float_Topup' || (credit > 0 && !entry.transaction_type)) {
        topupCount++;
        totalFloatTopups += credit;
      } else if (entry.transaction_type === 'Safe_Drop') {
        safeDropCount++;
        totalSafeDrops += debit;
      } else if (entry.transaction_type === 'Expense_Voucher') {
        expenseCount++;
        totalExpenses += debit;
      } else if (entry.transaction_type === 'Adjustment') {
        adjustmentCount++;
        totalAdjustments += (credit || debit);
      }
    });

    return {
      totalCashIn,
      totalCashOut,
      netCash: totalCashIn - totalCashOut,
      totalUpiIn,
      totalUpiOut,
      netUpi: totalUpiIn - totalUpiOut,
      totalMoneyIn: totalCashIn + totalUpiIn,
      totalMoneyOut: totalCashOut + totalUpiOut,
      netTotalFlow: totalCashIn + totalUpiIn - (totalCashOut + totalUpiOut),
      totalFloatTopups,
      topupCount,
      cashTopupCount,
      upiTopupCount,
      totalSafeDrops,
      safeDropCount,
      totalExpenses,
      expenseCount,
      cashExpenseCount,
      upiExpenseCount,
      totalAdjustments,
      adjustmentCount,
      creditCount,
      debitCount,
    };
  }, [allLedgerEntries]);

  const handleCopyRef = (refText: string) => {
    navigator.clipboard.writeText(refText);
    setCopiedRef(refText);
    triggerHaptic('light');
    setTimeout(() => setCopiedRef(null), 2000);
  };

                const handleResetForm = () => {
    triggerHaptic('light');
    setAmount('');
    setReferenceNotes('');
    setTransferMode('');
    setEntryDate(formatDateFns(new Date(), 'yyyy-MM-dd'));
    setFeedback(null);
  };

  const handleOpenPreview = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const amountToAdd = Number(amount) || 0;

    if (amountToAdd <= 0) {
      setFeedback({ type: 'error', message: 'Please enter a valid amount greater than ₹0.' });
      return;
    }

    setIsPreviewOpen(true);
  };

  const handleConfirmSubmit = async () => {
    const amountToAdd = Number(amount) || 0;
    if (amountToAdd <= 0) return;

    setSubmitting(true);
    setIsPreviewOpen(false);
    try {
      const isHistorical = entryDate !== formatDateFns(new Date(), 'yyyy-MM-dd');
      const dateTag = isHistorical ? ` [Date: ${entryDate}]` : '';
      const defaultNote = walletType === 'Cash' ? 'Cash Box Inflow' : 'UPI Float Inflow';
      const noteContent = referenceNotes.trim() || defaultNote;
      const modeTag = transferMode ? ` [Transfer Mode: ${transferMode}]` : '';
      const fullRemarks = `${noteContent}${modeTag}${dateTag}`.trim();

      const staffName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || user?.email?.split('@')[0] || 'Store Manager';
      const matchedBranch = branches.find((b) => b.branch_id === selectedBranch);
      const branchCode = matchedBranch?.branch_code || selectedBranch.replace(/^Aellp-/, '') || activeBranch.branch_code;

      await erpService.createFloatTopup({
        branchId: selectedBranch,
        branchCode,
        walletType,
        amount: amountToAdd,
        referenceNotes: fullRemarks,
        receivedByName: staffName,
        authorizedByName: staffName,
        createdAt: isHistorical ? new Date(`${entryDate}T12:00:00`).toISOString() : undefined,
      });

      triggerHaptic('heavy');
      setFeedback({
        type: 'success',
        message: `Successfully added ${formatINR(amountToAdd)} ${walletType === 'Cash' ? 'Cash' : 'UPI'}!`,
      });

      setAmount('');
      setReferenceNotes('');
      setEntryDate(formatDateFns(new Date(), 'yyyy-MM-dd'));
      loadTreasuryData();
      window.dispatchEvent(new Event('asopalav:wallet-updated'));
    } catch (err: any) {
      console.error('Error adding float:', err);
      setFeedback({ type: 'error', message: err.message || 'Failed to add float.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (isCashier) {
    return (
      <AccessDeniedView
        title="Access Restricted"
        message="Cash Drawer & Treasury management is restricted to Store Managers and Super Admins."
        pageName="Cash Drawer & UPI"
        onGoBack={() => setActivePage('dashboard')}
      />
    );
  }

  return (
    <div ref={containerRef} className="min-h-full flex-1 flex flex-col bg-white dark:bg-[#141414] text-slate-900 dark:text-[#EDEDED] font-sans antialiased selection:bg-[#3ecf8e]/20 selection:text-[#3ecf8e] select-none">
      {/* 1. Cash Drawer & UPI Header */}
      <div className="relative z-30 px-4 lg:px-6 py-3.5 border-b border-slate-200 dark:border-[#242424] bg-white dark:bg-[#141414]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          {/* Left Layer: Title, Status Badges & Subtitle */}
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-medium tracking-tight text-slate-900 dark:text-[#EDEDED] font-sans flex items-center gap-2">
                <Wallet className="w-5 h-5 text-[#3ecf8e]" />
                <span>Cash Drawer & UPI</span>
              </h1>
              <span className="px-2 py-0.5 rounded-[4px] text-[10px] tabular-nums font-mono bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/20 font-medium">
                {filteredAllocations.length} records
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-[#888888] font-sans mt-0.5">
              Manage cash in box, add float, and view history.
            </p>
          </div>

          {/* Right Layer: Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Daily EOD Till Count & Lock (Beta) */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic('selection');
                setIsEodModalOpen(true);
              }}
              className="h-8 px-3 py-1.5 rounded-[6px] border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-[#3ecf8e] text-xs font-medium font-sans flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
              title="Daily EOD physical notes count and reconciliation lock"
            >
              <Calculator className="w-3.5 h-3.5 text-[#3ecf8e]" />
              <span>Till Count Lock (Beta)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                triggerHaptic('selection');
                setActivePage('reports');
              }}
              className="h-8 px-3 py-1.5 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-slate-50 dark:bg-[#1c1c1f] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-[#EDEDED] hover:bg-slate-100 dark:hover:bg-[#242428] text-xs font-medium font-sans flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
              title="All Official Financial, Tally & CA Reports Hub (F5)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#3ecf8e]" />
              <span>Reports Hub (F5)</span>
            </button>

            <button
              type="button"
              onClick={loadTreasuryData}
              disabled={loading}
              className="h-8 w-8 flex items-center justify-center rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-slate-50 dark:bg-[#1c1c1f] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-[#EDEDED] hover:bg-slate-100 dark:hover:bg-[#242428] transition-all cursor-pointer shadow-2xs"
              title="Refresh"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin text-[#3ecf8e]")} />
            </button>
          </div>
        </div>
      </div>

      {/* 2. Main Studio Content Area */}
      <div className="px-4 lg:px-6 py-4 space-y-4 flex-1">
        {/* Tier 2: Filter Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-[12px] border border-slate-200 dark:border-[#242424] bg-slate-50/70 dark:bg-[#18181a]/70 shadow-2xs">
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="w-3.5 h-3.5 text-slate-400 dark:text-[#737373] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={ledgerSearch}
                onChange={(e) => setLedgerSearch(e.target.value)}
                placeholder="Search history..."
                className="w-full h-10 min-h-[40px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[6px] pl-8 pr-8 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-[#737373] focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 transition-colors font-sans shadow-2xs"
              />
              {ledgerSearch ? (
                <button
                  type="button"
                  onClick={() => setLedgerSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#737373] hover:text-slate-900 dark:hover:text-white text-xs"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : null}
            </div>

            {/* Scope / Activity Filter */}
            <div className="w-36">
              <SearchableSelect
                size="sm"
                options={[
                  { value: 'ALL', label: 'All Activity' },
                  { value: 'Float_Topup', label: 'Top-ups Only' },
                  { value: 'Cash', label: 'Cash Only' },
                  { value: 'UPI', label: 'UPI Only' },
                ]}
                value={ledgerWalletFilter}
                onChange={(val) => setLedgerWalletFilter(val as any)}
                placeholder="All Activity"
                searchPlaceholder="Search activity..."
                allowCustom={false}
              />
            </div>

            {/* Unified Airline-Style DateRangePicker for Date Range selection */}
            <DateRangePicker
              startDate={dateBounds.start || ''}
              endDate={dateBounds.end || ''}
              onChange={(range) => {
                setSelectedDayFilter(null);
                setCustomStartDate(range.startDate);
                setCustomEndDate(range.endDate);
                setDateFilter('custom');
              }}
              size="sm"
            />

            {(dateFilter !== 'all' || customStartDate || customEndDate || selectedDayFilter) && (
              <button
                type="button"
                onClick={() => {
                  setDateFilter('all');
                  setCustomDate('');
                  setCustomStartDate('');
                  setCustomEndDate('');
                  setSelectedDayFilter(null);
                }}
                className="h-8 px-2 py-1 rounded-[6px] border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium font-sans flex items-center gap-1 transition-colors cursor-pointer"
                title="Reset Date Range"
              >
                <X className="w-3 h-3" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            )}

            {/* Active Day Filter Indicator */}
            {selectedDayFilter && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-[#3ecf8e] text-xs font-mono font-medium animate-in fade-in">
                <span>Filter Day: {dateBounds.label}</span>
                <button
                  type="button"
                  onClick={() => setSelectedDayFilter(null)}
                  className="hover:opacity-75 cursor-pointer ml-1 text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  title="Clear day filter"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Branch Selector */}
          <div className="w-full sm:w-64">
            <SearchableSelect
              size="sm"
              value={selectedBranch}
              onChange={setSelectedBranch}
              options={allowedBranches.map((b) => ({
                value: b.branch_id,
                label: b.branch_code,
                sublabel: b.branch_name.replace(/^Asopalav\s*-\s*/i, ''),
              }))}
              placeholder="Select branch..."
            />
          </div>
      </div>

      {/* 2. Cash & UPI Balances Telemetry Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* KPI 1: Cash Drawer Till */}
        <MetricCard
          label="Cash Drawer Till"
          value={
            <>
              <span className="sm:hidden">{formatCompactINR(currentCashBalance)}</span>
              <span className="hidden sm:inline">{formatINR(currentCashBalance)}</span>
            </>
          }
          subValue="Verified Physical Drawer Cash"
          badge="CASH TILL"
          badgeColor="emerald"
          icon={Coins}
        />

        {/* KPI 2: UPI Float */}
        <MetricCard
          label="UPI Float"
          value={
            <>
              <span className="sm:hidden">{formatCompactINR(currentUpiBalance)}</span>
              <span className="hidden sm:inline">{formatINR(currentUpiBalance)}</span>
            </>
          }
          subValue="Verified Digital UPI Float"
          badge="ONLINE UPI"
          badgeColor="blue"
          icon={Building2}
        />

        {/* KPI 3: Cash Inflows (+ Credit) */}
        <MetricCard
          label="Cash Inflows (Credits)"
          value={
            <>
              <span className="sm:hidden">+{formatCompactINR(dailyCashSummary.periodInflows)}</span>
              <span className="hidden sm:inline">+{formatINR(dailyCashSummary.periodInflows)}</span>
            </>
          }
          subValue={`${treasurySummary.cashTopupCount} cash additions in period`}
          statusDotColor="#3ecf8e"
          badge="FLOAT IN"
          badgeColor="emerald"
          icon={TrendingUp}
        />

        {/* KPI 4: Cash Outflows (- Debit) */}
        <MetricCard
          label="Cash Outflows (Debits)"
          value={
            <>
              <span className="sm:hidden">-{formatCompactINR(dailyCashSummary.periodOutflows)}</span>
              <span className="hidden sm:inline">-{formatINR(dailyCashSummary.periodOutflows)}</span>
            </>
          }
          subValue={`${treasurySummary.cashExpenseCount} cash expense vouchers`}
          badge="SPENT"
          badgeColor="neutral"
          icon={Receipt}
        />
      </div>

      {/* 3. Top Action: Add Cash / UPI Inflow Card */}
      <div className="space-y-4">
        <form onSubmit={handleOpenPreview} className="stagger-card p-4 rounded-[12px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] space-y-3.5 shadow-xs">
          <div className="flex items-center justify-between pb-2.5 border-b border-slate-200 dark:border-[#242424] gap-2">
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-[#3ecf8e]" />
              <h2 className="text-xs font-semibold text-slate-900 dark:text-white font-sans">
                Add Cash / UPI Inflow
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-[6px] p-0.5 bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-[#242424]">
                <button
                  type="button"
                  onClick={() => setWalletType('Cash')}
                  className={cn(
                    'px-3 py-1 rounded-[4px] text-xs font-sans transition-all cursor-pointer font-medium',
                    walletType === 'Cash'
                      ? 'bg-white dark:bg-[#282828] text-slate-900 dark:text-white font-medium border border-slate-200 dark:border-[#383838] shadow-xs'
                      : 'text-slate-500 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-white border border-transparent'
                  )}
                >
                  Cash
                </button>
                <button
                  type="button"
                  onClick={() => setWalletType('UPI')}
                  className={cn(
                    'px-3 py-1 rounded-[4px] text-xs font-sans transition-all cursor-pointer font-medium',
                    walletType === 'UPI'
                      ? 'bg-white dark:bg-[#282828] text-slate-900 dark:text-white font-medium border border-slate-200 dark:border-[#383838] shadow-xs'
                      : 'text-slate-500 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-white border border-transparent'
                  )}
                >
                  Online UPI
                </button>
              </div>

              <button
                type="button"
                onClick={handleResetForm}
                className="h-8 w-8 flex items-center justify-center rounded-[6px] text-slate-500 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-[#242424] transition-all cursor-pointer shadow-xs shrink-0"
                title="Reset"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Form Fields in 3-Column Responsive Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* Amount Input */}
            <div className="space-y-1 font-sans">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-slate-800 dark:text-[#e0e0e0]">
                  {walletType === 'Cash' ? 'Cash Amount (₹) *' : 'UPI Amount (₹) *'}
                </label>
                {Number(amount) > 0 && (
                  <span className="text-[11px] font-mono text-emerald-600 dark:text-[#3ecf8e]">
                    {numberToWordsINR(Number(amount))}
                  </span>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono font-medium text-slate-400 dark:text-[#737373] text-sm">
                  ₹
                </span>
                <input
                  type="number"
                  min="1"
                  value={amount}
                  onChange={(e) => setAmount(parseFloat(e.target.value) || '')}
                  placeholder="0.00"
                  className="w-full h-10 min-h-[40px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[6px] pl-7 pr-3 text-sm font-mono font-medium tabular-nums text-slate-900 dark:text-white focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 shadow-2xs"
                />
              </div>
            </div>

            {/* Transaction Date */}
            <div className="space-y-1 font-sans">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-slate-800 dark:text-[#e0e0e0]">
                  Date
                </label>
                {entryDate !== formatDateFns(new Date(), 'yyyy-MM-dd') && (
                  <span className="text-[10.5px] font-mono px-2 py-0.5 rounded-[4px] bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 font-medium">
                    Past Date ({entryDate})
                  </span>
                )}
              </div>
              <DatePicker
                value={entryDate}
                onChange={(val) => setEntryDate(val)}
                allowPastDatesOverride={isDeveloper || user?.role_code === 'Super_Admin' || user?.role_code === 'Store_Manager'}
                placeholder="Select date..."
              />
            </div>

            {/* Reference Remarks */}
            <div className="space-y-1 font-sans">
              <label className="block text-xs font-medium text-slate-800 dark:text-[#e0e0e0]">
                Reason / Note
              </label>
              <input
                type="text"
                value={referenceNotes}
                onChange={(e) => setReferenceNotes(e.target.value)}
                placeholder="e.g. Morning cash / Owner topup"
                className="w-full h-10 min-h-[40px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[6px] px-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 shadow-2xs"
              />
            </div>
          </div>

          {/* Feedback Alert */}
          {feedback && (
            <div
              className={`p-2.5 rounded-[6px] border font-sans text-xs font-medium ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 dark:bg-[#3ecf8e]/10 border-emerald-200 dark:border-[#3ecf8e]/30 text-emerald-700 dark:text-[#3ecf8e]'
                  : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-400'
              }`}
            >
              {feedback.message}
            </div>
          )}

          {/* Action Footer */}
          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-slate-200 dark:border-[#242424]">
            <div className="text-xs text-slate-600 dark:text-[#A1A1A1] font-mono flex items-center justify-between sm:justify-start gap-2">
              <span>Total:</span>
              <span className="font-semibold text-slate-900 dark:text-white tabular-nums text-sm">
                {formatINR(Number(amount) || 0)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetForm}
                className="h-9 w-9 flex items-center justify-center rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-slate-50 dark:bg-[#202020] text-slate-600 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#282828] transition-all cursor-pointer shadow-xs shrink-0"
                title="Reset"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                type="submit"
                disabled={submitting}
                className="flex-1 sm:flex-none h-9 px-4 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-medium text-xs font-sans flex items-center justify-center gap-1.5 transition-all cursor-pointer select-none shadow-xs"
              >
                <Check className="w-4 h-4 text-[#171717] stroke-[2.5]" />
                <span>
                  {submitting
                    ? 'Processing...'
                    : walletType === 'Cash'
                    ? 'Review & Add Cash'
                    : 'Review & Add UPI'}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* 4. Verified Day-by-Day Cash Statement */}
      <DailyCashDrawerStatement
        ledgerEntries={allLedgerEntries}
        currentCashBalance={currentCashBalance}
        currentUpiBalance={currentUpiBalance}
        selectedBranchId={selectedBranch}
        onSelectDate={setSelectedDayFilter}
        selectedDate={selectedDayFilter}
        defaultExpanded={true}
        contextTitle="Cash Drawer & UPI Day-by-Day Statement"
      />

      {/* 5. Full Cash Passbook Register & Advance Table */}
      <TreasuryPassbookTable
        entries={allLedgerEntries}
        currentCashBalance={currentCashBalance}
        currentUpiBalance={currentUpiBalance}
        selectedBranchId={selectedBranch}
        selectedDayFilter={selectedDayFilter}
        onClearDayFilter={() => setSelectedDayFilter(null)}
        voucherMap={voucherMap}
      />

      {/* Daily EOD Till Lock & Denomination Counter Modal (Beta) */}
      <DailyEodTillModal
        isOpen={isEodModalOpen}
        onClose={() => setIsEodModalOpen(false)}
        branchId={selectedBranch}
        branchCode={selectedBranch.replace(/^Aellp-/, '')}
        systemCashBalance={currentCashBalance}
        onSuccess={loadTreasuryData}
      />

      {/* 6. View Treasury Transaction Slip Modal */}
      {viewLedgerEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-[12px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] shadow-2xl p-5 space-y-4 font-sans animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#242424]">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#3ecf8e]" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Treasury Voucher Slip
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setViewLedgerEntry(null)}
                className="p-1 rounded-[4px] text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Slip content */}
            <div className="p-4 rounded-[8px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#242424] space-y-2.5 font-mono text-xs">
              <div className="flex justify-between items-center text-slate-500 dark:text-zinc-400">
                <span>Voucher / Ref #</span>
                <span className="font-semibold text-slate-900 dark:text-white font-mono">
                  {formatVoucherNumber(viewLedgerEntry.reference_number || (viewLedgerEntry.id ? String(viewLedgerEntry.id).slice(0, 8).toUpperCase() : 'TRZ-AUTO'))}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-500 dark:text-zinc-400">
                <span>Transaction Type</span>
                <span className="font-semibold text-slate-900 dark:text-white font-sans">
                  {viewLedgerEntry.transaction_type || (Number(viewLedgerEntry.credit_amount) > 0 ? 'Float_Topup' : 'Expense_Voucher')}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-500 dark:text-zinc-400">
                <span>Wallet Account</span>
                <span className="font-semibold text-slate-900 dark:text-white font-mono">
                  {viewLedgerEntry.wallet_type === 'UPI' ? 'Online UPI Account' : 'Cash Drawer Till Box'}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-500 dark:text-zinc-400">
                <span>Date &amp; Time</span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {formatDate(viewLedgerEntry.created_at, 'dd MMMM yyyy, HH:mm:ss')}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-500 dark:text-zinc-400">
                <span>Cashier Attribution</span>
                <span className="font-semibold text-slate-900 dark:text-white font-sans">
                  {viewLedgerEntry.cashier_name || 'Store Cashier'}
                </span>
              </div>
              {viewLedgerEntry.authorized_by_name && (
                <div className="flex justify-between items-center text-slate-500 dark:text-zinc-400">
                  <span>Authorized By</span>
                  <span className="font-semibold text-slate-900 dark:text-white font-sans">
                    {viewLedgerEntry.authorized_by_name}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-start text-slate-500 dark:text-zinc-400 pt-1">
                <span>Remarks / Notes</span>
                <span className="font-semibold text-slate-900 dark:text-white text-right max-w-[220px] font-sans">
                  {viewLedgerEntry.remarks || 'Cash Float Top-up'}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 dark:border-[#242424] flex justify-between items-baseline">
                <span className="text-xs uppercase font-sans text-slate-500">
                  {Number(viewLedgerEntry.credit_amount) > 0 ? 'Inflow Amount' : 'Outflow Amount'}
                </span>
                <div className="text-right">
                  <div className={cn(
                    "text-xl font-bold font-mono",
                    Number(viewLedgerEntry.credit_amount) > 0 ? "text-emerald-600 dark:text-[#3ecf8e]" : "text-rose-600 dark:text-rose-400"
                  )}>
                    {Number(viewLedgerEntry.credit_amount) > 0
                      ? `+${formatINR(Number(viewLedgerEntry.credit_amount))}`
                      : `-${formatINR(Number(viewLedgerEntry.debit_amount))}`}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-zinc-400 font-sans">
                    {numberToWordsINR(Number(viewLedgerEntry.credit_amount || viewLedgerEntry.debit_amount) || 0)}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => handleCopyRef(formatVoucherNumber(viewLedgerEntry.reference_number || String(viewLedgerEntry.id || '')))}
                className="px-3 py-1.5 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] text-slate-700 dark:text-zinc-300 text-xs font-sans inline-flex items-center gap-1.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-[#202020]"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Ref</span>
              </button>

              <button
                type="button"
                onClick={() => setViewLedgerEntry(null)}
                className="px-4 py-2 rounded-[6px] bg-slate-100 dark:bg-[#202020] text-slate-700 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-[#282828] text-xs font-medium cursor-pointer"
              >
                Close Slip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Pre-Commit Verification Modal */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-[12px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] shadow-2xl p-5 space-y-4 font-sans animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#242424]">
              <div className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-[#3ecf8e]" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Confirm Inflow
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                className="p-1 rounded-[4px] text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Slip content */}
            <div className="p-4 rounded-[8px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#242424] space-y-2.5 font-mono text-xs">
              <div className="flex justify-between items-center text-slate-500 dark:text-zinc-400">
                <span>Branch</span>
                <span className="font-semibold text-slate-900 dark:text-white">{activeBranch.branch_name} ({activeBranch.branch_code})</span>
              </div>
              <div className="flex justify-between items-center text-slate-500 dark:text-zinc-400">
                <span>Wallet</span>
                <span className="font-semibold text-slate-900 dark:text-white">{walletType === 'Cash' ? 'Cash Box' : 'Online UPI'}</span>
              </div>
              <div className="flex justify-between items-center text-slate-500 dark:text-zinc-400">
                <span>Date</span>
                <span className="font-semibold text-slate-900 dark:text-white">{entryDate}</span>
              </div>
              <div className="flex justify-between items-center text-slate-500 dark:text-zinc-400">
                <span>Reason</span>
                <span className="font-semibold text-slate-900 dark:text-white truncate max-w-[200px]">{referenceNotes || (walletType === 'Cash' ? 'Cash Box Inflow' : 'UPI Float Inflow')}</span>
              </div>
              <div className="pt-2 border-t border-slate-200 dark:border-[#242424] flex justify-between items-baseline">
                <span className="text-xs uppercase font-sans text-slate-500">Amount</span>
                <div className="text-right">
                  <div className="text-xl font-bold text-emerald-600 dark:text-[#3ecf8e]">
                    {formatINR(Number(amount) || 0)}
                  </div>
                  <div className="text-[10px] text-emerald-700 dark:text-[#3ecf8e] font-sans">
                    {numberToWordsINR(Number(amount) || 0)}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                className="px-3.5 py-2 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-slate-100 dark:bg-[#202020] text-slate-700 dark:text-zinc-300 text-xs font-medium cursor-pointer"
              >
                Back & Edit
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmSubmit}
                className="px-4 py-2 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] text-xs font-medium cursor-pointer flex items-center gap-1.5 shadow-xs"
              >
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>{submitting ? 'Adding...' : 'Confirm & Add'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};
