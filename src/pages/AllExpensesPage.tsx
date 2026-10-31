import React, { useState, useMemo } from 'react';
import { format, startOfMonth } from 'date-fns';
import { useUIStore } from '@/store/uiStore';
import { useAuthStore } from '@/store/authStore';
import { useBranchStore } from '@/store/branchStore';
import { useVouchers } from '@/hooks/useVouchers';
import { VoucherTable } from '@/components/vouchers/VoucherTable';
import { DateRange } from '@/components/ui/DateRangePicker';
import { formatINR, formatCompactINR, cn, triggerHaptic } from '@/lib/utils';
import { showToast } from '@/components/ui/ToastContainer';
import {  Plus,
  Receipt,
  Wallet,
  Smartphone,
  Layers,
  RefreshCw,
  FileSpreadsheet,} from 'lucide-react';
import { MetricCard } from '@/components/ui/MetricCard';

export const AllExpensesPage: React.FC = () => {
  const { setActivePage } = useUIStore();
  const { user, can } = useAuthStore();
  const { selectedBranchId, getActiveBranch } = useBranchStore();
  const { vouchers, categories, departments, loading, refresh } = useVouchers();

  // Role detection: Cashier vs Executive/Admin
  const isCashier = user?.role_code === 'Cashier' || user?.role_code?.toLowerCase() === 'cashier';
  
  const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
  }));

  const activeBranch = getActiveBranch();
  const showroomTitle = selectedBranchId === 'ALL' ? 'All Showrooms' : (activeBranch?.branch_name || 'Satellite Road Showroom');
  const showroomCode = selectedBranchId === 'ALL' ? 'ALL' : (activeBranch?.branch_code || 'ASI');

  // Totals calculations within active date range
  const activeValidVouchers = useMemo(() => {
    return vouchers.filter((v) => {
      const rawDate = v.payment_date || v.created_at || '';
      const vDate = rawDate.trim().slice(0, 10);
      if (dateRange.startDate && vDate < dateRange.startDate) return false;
      if (dateRange.endDate && vDate > dateRange.endDate) return false;
      return (
        v.status !== 'Voided' &&
        v.status !== 'Pending_Approval' &&
        v.payment_type !== 'Advance_Settlement'
      );
    });
  }, [vouchers, dateRange]);

  const totalAmount = useMemo(() => {
    return activeValidVouchers.reduce((acc, curr) => acc + (Number(curr.total_amount) || 0), 0);
  }, [activeValidVouchers]);

  const cashAmount = useMemo(() => {
    return activeValidVouchers
      .filter((v) => v.payment_method === 'Physical_Cash')
      .reduce((acc, curr) => acc + (Number(curr.total_amount) || 0), 0);
  }, [activeValidVouchers]);

  const upiAmount = useMemo(() => {
    return activeValidVouchers
      .filter((v) => v.payment_method === 'Online_UPI')
      .reduce((acc, curr) => acc + (Number(curr.total_amount) || 0), 0);
  }, [activeValidVouchers]);

  const cashPercent = totalAmount > 0 ? Math.round((cashAmount / totalAmount) * 100) : 0;
  const upiPercent = totalAmount > 0 ? Math.round((upiAmount / totalAmount) * 100) : 0;

  const cashBillsCount = useMemo(() => {
    return activeValidVouchers.filter((v) => v.payment_method === 'Physical_Cash').length;
  }, [activeValidVouchers]);

  const upiBillsCount = useMemo(() => {
    return activeValidVouchers.filter((v) => v.payment_method === 'Online_UPI').length;
  }, [activeValidVouchers]);

  const handleRefresh = async () => {
    await refresh();
    showToast({
      type: 'success',
      title: 'Expenses Updated',
      message: `${vouchers.length} expense records loaded.`,
    });
  };

  return (
    <div className="min-h-full flex-1 flex flex-col bg-white dark:bg-[#141414] text-slate-900 dark:text-[#EDEDED] font-sans antialiased selection:bg-[#3ecf8e]/20 selection:text-[#3ecf8e] pb-16">
      {/* 1. Header (2-Layer Layout: Left Title & Subtitle, Right Actions) */}
      <div className="px-4 lg:px-6 py-3.5 border-b border-slate-200 dark:border-[#242424] bg-white dark:bg-[#141414]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          {/* Left: Title & Status Badge */}
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-medium tracking-tight text-slate-900 dark:text-[#EDEDED] flex items-center gap-2">
                <Receipt className="w-5 h-5 text-[#3ecf8e]" />
                <span>All Expenses</span>
              </h1>
              <span className="px-2 py-0.5 rounded-[4px] text-[10px] tabular-nums font-mono bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/20 font-medium">
                {activeValidVouchers.length} {isCashier ? "today's bills" : "bills"}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-[#8E8E93] mt-0.5">
              {isCashier
                ? `Today's shift expense bills and verified counter payouts for ${showroomTitle}.`
                : `Comprehensive expenditure register, payment modes, and audit ledger for ${showroomTitle}.`}
            </p>
          </div>

          {/* Right: Actions */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {can('can_export_tally') && (
              <button
                type="button"
                onClick={() => setActivePage('reports')}
                className="h-8 px-3 py-1.5 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-slate-50 dark:bg-[#1c1c1f] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-[#EDEDED] hover:bg-slate-100 dark:hover:bg-[#242428] text-xs font-medium flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                title="View All Financial Reports & Tally Statements"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-[#3ecf8e]" />
                <span>Reports &amp; Tally</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="h-8 w-8 flex items-center justify-center rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-slate-50 dark:bg-[#1c1c1f] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-[#EDEDED] hover:bg-slate-100 dark:hover:bg-[#242428] shadow-2xs transition-colors cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin text-[#3ecf8e]")} />
            </button>

            {/* Single Emerald Primary CTA */}
            <button
              type="button"
              onClick={() => setActivePage('new-voucher')}
              className="h-9 px-4 py-1.5 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer font-sans select-none"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Add Expense</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Main Content Area */}
      <div className="px-4 lg:px-6 py-4 space-y-4 flex-1 w-full">
        {/* Active Showroom Floor */}
        <div className="flex items-center justify-between text-xs font-mono text-slate-500 dark:text-[#8E8E93]">
          <div className="flex items-center gap-2">
            <span>Showroom:</span>
            <span className="px-2 py-0.5 rounded-[4px] bg-white dark:bg-[#202024] text-slate-900 dark:text-white border border-slate-200 dark:border-[#2e2e32] font-semibold text-[11px]">
              {showroomTitle} ({showroomCode})
            </span>
          </div>
        </div>

        {/* 4 Inset Cards: Role-Adaptive (Cashier sees operational counts only; Executive sees macro spend) */}
        {isCashier ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              label={dateRange.startDate === todayStr && dateRange.endDate === todayStr ? "Today's Shift Bills" : "Bills in Range"}
              value={String(activeValidVouchers.length)}
              subValue={dateRange.startDate === todayStr && dateRange.endDate === todayStr ? "Vouchers recorded today" : "Vouchers in selected dates"}
              badge="SHIFT"
              badgeColor="emerald"
              statusDotColor="#3ecf8e"
              icon={Receipt}
            />

            <MetricCard
              label="Cash Vouchers"
              value={String(cashBillsCount)}
              subValue="Physical cash counter slips"
              badge="CASH"
              badgeColor="neutral"
              statusDotColor="#f59e0b"
              icon={Wallet}
            />

            <MetricCard
              label="UPI Vouchers"
              value={String(upiBillsCount)}
              subValue="Digital payments verified"
              badge="UPI"
              badgeColor="neutral"
              statusDotColor="#3b82f6"
              icon={Smartphone}
            />

            <MetricCard
              label="Shift Register"
              value="Active Till"
              subValue={`${showroomCode} Showroom Floor`}
              badge="ONLINE"
              badgeColor="emerald"
              statusDotColor="#3ecf8e"
              icon={Layers}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              label="Total Spent"
              value={
                <>
                  <span className="sm:hidden">{formatCompactINR(totalAmount)}</span>
                  <span className="hidden sm:inline">{formatINR(totalAmount)}</span>
                </>
              }
              subValue={`${activeValidVouchers.length} bills recorded`}
              statusDotColor="#3ecf8e"
              icon={Receipt}
            />

            <MetricCard
              label="Cash Paid"
              value={
                <>
                  <span className="sm:hidden">{formatCompactINR(cashAmount)}</span>
                  <span className="hidden sm:inline">{formatINR(cashAmount)}</span>
                </>
              }
              subValue={`${cashPercent}% of total`}
              statusDotColor="#f59e0b"
              icon={Wallet}
            />

            <MetricCard
              label="UPI Paid"
              value={
                <>
                  <span className="sm:hidden">{formatCompactINR(upiAmount)}</span>
                  <span className="hidden sm:inline">{formatINR(upiAmount)}</span>
                </>
              }
              subValue={`${upiPercent}% of total`}
              statusDotColor="#3b82f6"
              icon={Smartphone}
            />

            <MetricCard
              label="Total Bills"
              value={String(activeValidVouchers.length)}
              subValue="All recorded bills"
              badge="ALL OK"
              badgeColor="emerald"
              statusDotColor="#3ecf8e"
              icon={Layers}
            />
          </div>
        )}

        {/* Voucher Data Grid */}
        <VoucherTable
          vouchers={vouchers}
          categories={categories}
          departments={departments}
          hideTelemetry={isCashier}
          startDate={dateRange.startDate}
          endDate={dateRange.endDate}
          onDateRangeChange={(range) => {
            triggerHaptic('selection');
            setDateRange(range);
          }}
        />
      </div>
    </div>
  );
};

export default AllExpensesPage;


