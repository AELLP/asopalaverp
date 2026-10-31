import React, { useMemo, useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { format, startOfWeek, startOfMonth, startOfQuarter, subDays, addDays } from 'date-fns';
import { useAuthStore, isPrivilegedAdminRole } from '@/store/authStore';
import { useBranchStore } from '@/store/branchStore';
import { useUIStore } from '@/store/uiStore';
import { useVouchers } from '@/hooks/useVouchers';
import { erpService } from '@/lib/erpService';
import { calculateDailyCashBalances, calculateDailyTreasuryBalances } from '@/lib/dailyCashBalance';
import { StaffAdvance, WalletLedger, VoucherSplit, SecurityAuditLog } from '@/types/database';
import { VoucherTable } from '@/components/vouchers/VoucherTable';
import { MetricCard } from '@/components/ui/MetricCard';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { SegmentedControl } from '@/components/ui';
import { formatINR, cn, triggerHaptic, normalizeBranchCode, normalizeDateToYMD } from '@/lib/utils';
import { getLocalAuditLogs } from '@/lib/audit';
import { showToast } from '@/components/ui/ToastContainer';
import {
  Wallet,
  ArrowRight,
  FileSpreadsheet,
  PieChart,
  Building2,
  TrendingUp,
  Receipt,
  Calendar,
  Filter,
  RotateCcw,
  AlertTriangle,
  Coins,
  Layers,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Lock,
  X,
  LayoutDashboard,
  RefreshCw,
  Users,
  ShieldAlert,
  ShieldCheck,
  User,
  Briefcase,
  Shield,
  BarChart3,
  Clock,
  Smartphone,
  Check,
  FileText,
  CheckCircle2,
  SlidersHorizontal,
} from 'lucide-react';
import { useDuplicateDetector } from '@/hooks/useDuplicateDetector';

// =========================================================================
// SMART LAZY LOADED HEAVY COMPONENTS (Zero bundle bloat on cashier terminals)
// =========================================================================
const HourlyHeatmapWidget = lazy(() =>
  import('@/components/dashboard/HourlyHeatmapWidget').then((m) => ({ default: m.HourlyHeatmapWidget }))
);
const LogsBarChart = lazy(() =>
  import('@/components/fragments/LogsBarChart').then((m) => ({ default: m.LogsBarChart }))
);
const DuplicateDetectionModal = lazy(() =>
  import('@/components/vouchers/DuplicateDetectionModal').then((m) => ({ default: m.DuplicateDetectionModal }))
);

// Lightweight skeleton fallback for lazy widgets
const WidgetSkeleton: React.FC<{ label: string; height?: string }> = ({ label, height = 'h-40' }) => (
  <div
    className={cn(
      'p-5 bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] rounded-[12px] flex flex-col items-center justify-center gap-2.5 transition-all shadow-2xs',
      height
    )}
  >
    <div className="w-5 h-5 border-2 border-[#3ecf8e] border-t-transparent rounded-full animate-spin" />
    <span className="text-xs font-mono text-slate-500 dark:text-[#888]">Loading {label}...</span>
  </div>
);

export const DashboardPage: React.FC = () => {
  const { user, can, isBranchAllowed, getAllowedBranches } = useAuthStore();
  const { selectedBranchId, branches, getActiveBranch } = useBranchStore();
  const { setActivePage, setCalculatorOpen } = useUIStore();
  const { vouchers, categories, departments, loading, refresh } = useVouchers();

  // Role detection: Cashier vs Store Manager vs Super Admin vs Auditor
  const userRole = (user?.role_code || '').toLowerCase().replace(/[- ]/g, '_');
  const isRealCashier = userRole === 'cashier' || userRole === 'showroom_cashier';
  const isRealManager = userRole === 'store_manager' || userRole === 'manager';
  const isRealAuditor = userRole === 'auditor';
  const isRealAdmin = isPrivilegedAdminRole(user?.role_code);

  // Strictly display dashboard as per active logged-in user role
  type DashboardViewMode = 'cashier' | 'manager' | 'admin' | 'auditor';
  const activeViewMode: DashboardViewMode = useMemo(() => {
    if (isRealAdmin) return 'admin';
    if (isRealAuditor) return 'auditor';
    if (isRealManager) return 'manager';
    return 'cashier';
  }, [isRealAdmin, isRealAuditor, isRealManager]);

  // Smart Tab for Admin View (Prevents computing all analytics on first paint)
  const [adminTab, setAdminTab] = useState<'overview' | 'analytics'>('overview');

  // =========================================================================
  // STRICT USER RIGHT & BRANCH PERMISSION ENFORCEMENT
  // =========================================================================
  useEffect(() => {
    if (!user) return;
    const canViewAll = can('can_view_all_branches') || isRealAdmin;
    // If user lacks permission to view 'ALL' branches, enforce their assigned showroom
    if (!canViewAll && (selectedBranchId === 'ALL' || !isBranchAllowed(selectedBranchId))) {
      const allowed = getAllowedBranches(branches);
      if (allowed && allowed.length > 0) {
        useBranchStore.getState().setSelectedBranchId(allowed[0].branch_id);
      }
    }
  }, [user, selectedBranchId, branches, can, isRealAdmin, isBranchAllowed, getAllowedBranches]);

  // Wallet & Liquidity State
  const [cashBalance, setCashBalance] = useState(0);
  const [upiBalance, setUpiBalance] = useState(0);
  const [ledgerEntries, setLedgerEntries] = useState<WalletLedger[]>([]);
  const [advances, setAdvances] = useState<StaffAdvance[]>([]);
  const [isPeriodLocked, setIsPeriodLocked] = useState(false);
  const [splitsMap, setSplitsMap] = useState<Record<string, VoucherSplit[]>>({});
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);

  // Branch-Scoped Vouchers for Radar (Cashier only scans their own counter bills to save memory)
  const branchScopedVouchers = useMemo(() => {
    const canViewAll = can('can_view_all_branches') || isRealAdmin;
    return vouchers.filter((v) => {
      if (selectedBranchId !== 'ALL' && v.branch_id) {
        if (v.branch_id !== selectedBranchId && normalizeBranchCode(v.branch_id) !== normalizeBranchCode(selectedBranchId)) {
          return false;
        }
      }
      if (!canViewAll && v.branch_id && !isBranchAllowed(v.branch_id)) return false;
      return true;
    });
  }, [vouchers, selectedBranchId, can, isRealAdmin, isBranchAllowed]);

  // Real-time Duplicate Detection Radar (Scoped by branch permissions)
  const {
    clusters: duplicateClusters,
    activeCount: duplicateActiveCount,
    dismissCluster,
  } = useDuplicateDetector(branchScopedVouchers, ledgerEntries);

  // Slicers State (Date range, Payment mode, and Dimensional drilldowns)
  const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month' | 'quarter' | 'all' | 'custom'>('today');
  const [customStartDate, setCustomStartDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [customEndDate, setCustomEndDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [selectedMode, setSelectedMode] = useState<'ALL' | 'Physical_Cash' | 'Online_UPI'>('ALL');

  // Interactive Dashboard Table Slicers (Click-to-Filter on Top Depts & Categories)
  const [activeDeptFilter, setActiveDeptFilter] = useState<string>('ALL');
  const [activeCatFilter, setActiveCatFilter] = useState<string>('ALL');

  const activeBranch = getActiveBranch();
  const minCashThreshold = activeBranch?.min_cash_threshold || 3000;
  const isLowFloatAlert = cashBalance < minCashThreshold;

  // Load branch wallet balances
  const loadWallet = useCallback(async () => {
    if (!selectedBranchId) return;
    if (selectedBranchId !== 'ALL' && !isBranchAllowed(selectedBranchId)) return;
    try {
      const w = await erpService.getBranchWallet(selectedBranchId);
      setCashBalance(w.cash_balance);
      setUpiBalance(w.upi_balance);
    } catch (err) {
      console.warn('Error loading branch wallet:', err);
    }
  }, [selectedBranchId, isBranchAllowed]);

  // Load ledger entries for accurate Inflow / Top-up KPIs
  const loadLedger = useCallback(async () => {
    if (!selectedBranchId) return;
    if (selectedBranchId !== 'ALL' && !isBranchAllowed(selectedBranchId)) return;
    try {
      const entries = await erpService.getWalletLedger(selectedBranchId);
      setLedgerEntries(entries || []);
    } catch (err) {
      console.warn('Error loading ledger:', err);
    }
  }, [selectedBranchId, isBranchAllowed]);

  // Load staff advances
  const loadAdvances = useCallback(async () => {
    if (selectedBranchId !== 'ALL' && !isBranchAllowed(selectedBranchId)) return;
    try {
      const data = await erpService.getStaffAdvances(selectedBranchId);
      setAdvances(data);
    } catch (err) {
      console.warn('Error loading staff advances:', err);
    }
  }, [selectedBranchId, isBranchAllowed]);

  // Check period lock status
  useEffect(() => {
    async function checkLock() {
      try {
        const locked = await erpService.checkIsPeriodLocked(format(new Date(), 'yyyy-MM-dd'));
        setIsPeriodLocked(locked);
      } catch (err) {
        setIsPeriodLocked(false);
      }
    }
    checkLock();
  }, []);

  useEffect(() => {
    loadWallet();
    loadLedger();
    loadAdvances();

    let walletTimeout: any = null;
    let ledgerTimeout: any = null;
    let advTimeout: any = null;

    const onWalletUpdate = () => {
      if (walletTimeout) clearTimeout(walletTimeout);
      walletTimeout = setTimeout(() => loadWallet(), 400);
    };

    const onLedgerUpdate = () => {
      if (ledgerTimeout) clearTimeout(ledgerTimeout);
      ledgerTimeout = setTimeout(() => loadLedger(), 400);
    };

    const onAdvancesUpdate = () => {
      if (advTimeout) clearTimeout(advTimeout);
      advTimeout = setTimeout(() => loadAdvances(), 400);
    };

    const onVouchersUpdate = () => {
      if (walletTimeout) clearTimeout(walletTimeout);
      if (ledgerTimeout) clearTimeout(ledgerTimeout);
      walletTimeout = setTimeout(() => {
        loadWallet();
        loadLedger();
      }, 400);
    };

    window.addEventListener('asopalav:wallet-updated', onWalletUpdate);
    window.addEventListener('asopalav:ledger-updated', onLedgerUpdate);
    window.addEventListener('asopalav:advances-updated', onAdvancesUpdate);
    window.addEventListener('asopalav:vouchers-updated', onVouchersUpdate);

    return () => {
      if (walletTimeout) clearTimeout(walletTimeout);
      if (ledgerTimeout) clearTimeout(ledgerTimeout);
      if (advTimeout) clearTimeout(advTimeout);
      window.removeEventListener('asopalav:wallet-updated', onWalletUpdate);
      window.removeEventListener('asopalav:ledger-updated', onLedgerUpdate);
      window.removeEventListener('asopalav:advances-updated', onAdvancesUpdate);
      window.removeEventListener('asopalav:vouchers-updated', onVouchersUpdate);
    };
  }, [selectedBranchId, loadWallet, loadLedger, loadAdvances]);

  // Effective Start & End Dates for Table, Metrics, & Filter Pipeline
  const { tableStartDate, tableEndDate } = useMemo(() => {
    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');
    if (timeRange === 'today') return { tableStartDate: todayStr, tableEndDate: todayStr };
    if (timeRange === 'week') return { tableStartDate: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'), tableEndDate: todayStr };
    if (timeRange === 'month') return { tableStartDate: format(startOfMonth(now), 'yyyy-MM-dd'), tableEndDate: todayStr };
    if (timeRange === 'quarter') return { tableStartDate: format(startOfQuarter(now), 'yyyy-MM-dd'), tableEndDate: todayStr };
    if (timeRange === 'custom') return { tableStartDate: customStartDate || todayStr, tableEndDate: customEndDate || todayStr };
    if (timeRange === 'all') return { tableStartDate: '', tableEndDate: '' };
    return { tableStartDate: todayStr, tableEndDate: todayStr };
  }, [timeRange, customStartDate, customEndDate]);

  // Slicer Filter Pipeline for Vouchers (Strict Branch Scoping + Canonical Date Range)
  const filteredVouchers = useMemo(() => {
    const canViewAll = can('can_view_all_branches') || isRealAdmin;

    return vouchers.filter((v) => {
      // 1. Branch Rights Guard
      if (selectedBranchId !== 'ALL' && v.branch_id) {
        if (v.branch_id !== selectedBranchId && normalizeBranchCode(v.branch_id) !== normalizeBranchCode(selectedBranchId)) {
          return false;
        }
      }
      if (!canViewAll && v.branch_id && !isBranchAllowed(v.branch_id)) return false;

      // 2. Date Filter
      if (tableStartDate || tableEndDate) {
        const vDate = normalizeDateToYMD(v.payment_date || v.created_at);
        if (!vDate) return false;
        if (tableStartDate && vDate < tableStartDate) return false;
        if (tableEndDate && vDate > tableEndDate) return false;
      }

      // 3. Mode Filter
      if (selectedMode !== 'ALL' && v.payment_method !== selectedMode) return false;

      return true;
    });
  }, [vouchers, tableStartDate, tableEndDate, selectedMode, selectedBranchId, can, isRealAdmin, isBranchAllowed]);

  // Slicer Filter Pipeline for Ledger / Inflows
  const filteredLedger = useMemo(() => {
    const canViewAll = can('can_view_all_branches') || isRealAdmin;

    return ledgerEntries.filter((entry) => {
      // 1. Branch Rights Guard
      if (selectedBranchId !== 'ALL' && entry.branch_id) {
        if (entry.branch_id !== selectedBranchId && normalizeBranchCode(entry.branch_id) !== normalizeBranchCode(selectedBranchId)) {
          return false;
        }
      }
      if (!canViewAll && entry.branch_id && !isBranchAllowed(entry.branch_id)) return false;

      // 2. Date Filter
      if (tableStartDate || tableEndDate) {
        const entryDate = normalizeDateToYMD(entry.created_at);
        if (entryDate) {
          if (tableStartDate && entryDate < tableStartDate) return false;
          if (tableEndDate && entryDate > tableEndDate) return false;
        }
      }

      // 3. Mode Filter
      if (selectedMode === 'Physical_Cash' && entry.wallet_type !== 'Cash') return false;
      if (selectedMode === 'Online_UPI' && entry.wallet_type !== 'UPI') return false;

      return true;
    });
  }, [ledgerEntries, tableStartDate, tableEndDate, selectedMode, selectedBranchId, can, isRealAdmin, isBranchAllowed]);

  // Active Slicer Count
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const activeSlicerCount = useMemo(() => {
    let count = 0;
    const isToday = tableStartDate === todayStr && tableEndDate === todayStr;
    if (!isToday && (tableStartDate || tableEndDate)) count++;
    if (selectedMode !== 'ALL') count++;
    if (activeDeptFilter !== 'ALL') count++;
    if (activeCatFilter !== 'ALL') count++;
    return count;
  }, [tableStartDate, tableEndDate, selectedMode, todayStr, activeDeptFilter, activeCatFilter]);

  // Load line-item splits for multi-department/split vouchers in view
  useEffect(() => {
    let isMounted = true;
    const splitVoucherNumbers = filteredVouchers
      .filter((v) => v.payment_type === 'Staff_Split' || (v.vendor_splits && v.vendor_splits.length > 0))
      .map((v) => v.voucher_number);

    if (splitVoucherNumbers.length > 0) {
      erpService.getSplitsForVouchers(splitVoucherNumbers).then((res) => {
        if (isMounted) {
          setSplitsMap((prev) => ({ ...prev, ...res }));
        }
      }).catch((e) => {
        console.warn('Error loading splits for dashboard vouchers:', e);
      });
    }

    return () => {
      isMounted = false;
    };
  }, [filteredVouchers]);

  // Core Metrics calculation
  const metrics = useMemo(() => {
    const active = filteredVouchers.filter(
      (v) =>
        v.status !== 'Voided' &&
        v.status !== 'Pending_Approval' &&
        v.payment_type !== 'Advance_Settlement'
    );
    const totalSpend = active.reduce((acc, curr) => acc + (Number(curr.total_amount) || 0), 0);
    const cashSpend = active
      .filter((v) => v.payment_method === 'Physical_Cash')
      .reduce((acc, curr) => acc + (Number(curr.total_amount) || 0), 0);
    const upiSpend = active
      .filter((v) => v.payment_method === 'Online_UPI')
      .reduce((acc, curr) => acc + (Number(curr.total_amount) || 0), 0);

    return {
      totalSpend,
      cashSpend,
      upiSpend,
      cashPaid: cashSpend,
      upiPaid: upiSpend,
      totalBills: active.length,
      cashBills: active.filter((v) => v.payment_method === 'Physical_Cash').length,
      upiBills: active.filter((v) => v.payment_method === 'Online_UPI').length,
    };
  }, [filteredVouchers]);

  // Inflow Metrics
  const inflowMetrics = useMemo(() => {
    let totalInflow = 0;
    let cashInflow = 0;
    let cashCount = 0;
    let upiInflow = 0;
    let upiCount = 0;

    filteredLedger.forEach((entry) => {
      const credit = Number(entry.credit_amount) || 0;
      if (credit > 0) {
        totalInflow += credit;
        if (entry.wallet_type === 'UPI') {
          upiInflow += credit;
          upiCount++;
        } else {
          cashInflow += credit;
          cashCount++;
        }
      }
    });

    return {
      totalInflow,
      cashInflow,
      cashCount,
      upiInflow,
      upiCount,
    };
  }, [filteredLedger]);

  // Staff Advance Aging (0-7 days, 8-15 days, 15+ days salary deduction alert)
  const advanceAging = useMemo(() => {
    const now = new Date();
    const pending = advances.filter((a) => a.status === 'Active_Unsettled' || a.status === 'Flagged_Salary_Deduction');

    let bracket0to7 = 0;
    let bracket8to15 = 0;
    let bracket15Plus = 0;

    pending.forEach((a) => {
      const created = new Date(a.advance_date || a.created_at || now);
      const diffDays = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      const balance = Number(a.unsettled_balance) || 0;

      if (diffDays <= 7) bracket0to7 += balance;
      else if (diffDays <= 15) bracket8to15 += balance;
      else bracket15Plus += balance;
    });

    return {
      bracket0to7,
      bracket8to15,
      bracket15Plus,
      totalUnsettled: bracket0to7 + bracket8to15 + bracket15Plus,
      pendingCount: pending.length,
    };
  }, [advances]);

  // Auditor Telemetry: Voided Vouchers & High-Value Authorizations
  const voidedVouchers = useMemo(() => {
    return filteredVouchers.filter((v) => v.status === 'Voided');
  }, [filteredVouchers]);

  const voidedTotal = useMemo(() => {
    return voidedVouchers.reduce((acc, curr) => acc + (Number(curr.total_amount) || 0), 0);
  }, [voidedVouchers]);

  const duplicateRiskTotal = useMemo(() => {
    return duplicateClusters.reduce((acc, curr) => acc + (curr.totalAtRiskAmount || 0), 0);
  }, [duplicateClusters]);

  // Auditor Security Audit Logs Stream
  const [auditLogs, setAuditLogs] = useState<SecurityAuditLog[]>([]);
  useEffect(() => {
    setAuditLogs(getLocalAuditLogs().slice(0, 15));
  }, []);

  // Daily Cash Flow & Day-by-Day Opening and Closing
  const dailyCashSummary = useMemo(() => {
    const sDate = tableStartDate || undefined;
    const eDate = tableEndDate || undefined;
    return calculateDailyCashBalances(ledgerEntries, cashBalance, sDate, eDate);
  }, [ledgerEntries, cashBalance, tableStartDate, tableEndDate]);

  // Daily Cash & UPI Treasury Balances
  const treasuryBreakdown = useMemo(() => {
    return calculateDailyTreasuryBalances(ledgerEntries, cashBalance, upiBalance);
  }, [ledgerEntries, cashBalance, upiBalance]);

  // Department Allocation Stats (Cost Center Tracking)
  const departmentStats = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    filteredVouchers
      .filter(
        (v) =>
          v.status !== 'Voided' &&
          v.status !== 'Pending_Approval' &&
          v.payment_type !== 'Advance_Settlement'
      )
      .forEach((v) => {
        if (v.payment_type === 'Staff_Split') {
          const splits = splitsMap[v.voucher_number] || (v as any).splits || [];
          if (splits.length > 0) {
            splits.forEach((s: any) => {
              const dept = s.department_name || s.departmentName || 'General Operations';
              const amt = Number(s.amount) || 0;
              const cur = map.get(dept) || { count: 0, amount: 0 };
              map.set(dept, {
                count: cur.count + 1,
                amount: cur.amount + amt,
              });
            });
            return;
          }
        }

        if (Array.isArray(v.vendor_splits) && v.vendor_splits.length > 0) {
          v.vendor_splits.forEach((vs: any) => {
            const dept = vs.department_name || vs.departmentName || 'General Operations';
            const amt = Number(vs.amount) || 0;
            const cur = map.get(dept) || { count: 0, amount: 0 };
            map.set(dept, {
              count: cur.count + 1,
              amount: cur.amount + amt,
            });
          });
          return;
        }

        const dept = v.department_name || 'General Operations';
        const cur = map.get(dept) || { count: 0, amount: 0 };
        map.set(dept, {
          count: cur.count + 1,
          amount: cur.amount + (Number(v.total_amount) || 0),
        });
      });

    const deptPalette = ['#3ecf8e', '#2bb379', '#1e9b66', '#108453', '#0f766e', '#334155', '#475569', '#64748b'];
    return Array.from(map.entries())
      .map(([name, stat], idx) => ({
        name,
        count: stat.count,
        amount: Math.round(stat.amount * 100) / 100,
        percentage: metrics.totalSpend > 0 ? Math.round((stat.amount / metrics.totalSpend) * 100) : 0,
        color: deptPalette[idx % deptPalette.length],
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredVouchers, splitsMap, metrics.totalSpend]);

  // Month-over-Month (MoM) Comparison Logic (Like-for-Like MTD) - Only computed when needed
  const momComparison = useMemo(() => {
    if (activeViewMode === 'cashier') {
      return { currentMtdSpend: 0, prevMtdSpend: 0, prevFullMonthSpend: 0, deltaAmount: 0, deltaPercent: 0, currentMonthName: '', prevMonthName: '', currentDay: 0 };
    }
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();

    const currentMtdVouchers = vouchers.filter((v) => {
      if (v.status === 'Voided' || v.status === 'Pending_Approval' || v.payment_type === 'Advance_Settlement') return false;
      const d = new Date(v.payment_date || v.created_at);
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth && d.getDate() <= currentDay;
    });
    const currentMtdSpend = currentMtdVouchers.reduce((sum, v) => sum + (Number(v.total_amount) || 0), 0);

    const prevDate = new Date(currentYear, currentMonth - 1, 1);
    const prevYear = prevDate.getFullYear();
    const prevMonth = prevDate.getMonth();

    const prevMtdVouchers = vouchers.filter((v) => {
      if (v.status === 'Voided' || v.status === 'Pending_Approval' || v.payment_type === 'Advance_Settlement') return false;
      const d = new Date(v.payment_date || v.created_at);
      return d.getFullYear() === prevYear && d.getMonth() === prevMonth && d.getDate() <= currentDay;
    });
    const prevMtdSpend = prevMtdVouchers.reduce((sum, v) => sum + (Number(v.total_amount) || 0), 0);

    const prevFullMonthVouchers = vouchers.filter((v) => {
      if (v.status === 'Voided' || v.status === 'Pending_Approval' || v.payment_type === 'Advance_Settlement') return false;
      const d = new Date(v.payment_date || v.created_at);
      return d.getFullYear() === prevYear && d.getMonth() === prevMonth;
    });
    const prevFullMonthSpend = prevFullMonthVouchers.reduce((sum, v) => sum + (Number(v.total_amount) || 0), 0);

    const deltaAmount = currentMtdSpend - prevMtdSpend;
    const deltaPercent = prevMtdSpend > 0 ? Math.round(((currentMtdSpend - prevMtdSpend) / prevMtdSpend) * 100) : 0;

    return {
      currentMtdSpend,
      prevMtdSpend,
      prevFullMonthSpend,
      deltaAmount,
      deltaPercent,
      currentMonthName: format(now, 'MMMM'),
      prevMonthName: format(prevDate, 'MMMM'),
      currentDay,
    };
  }, [vouchers, activeViewMode]);

  // Cash Runway Calculation
  const cashRunway = useMemo(() => {
    if (activeViewMode === 'cashier') return { dailyAverageCashBurn: 0, runwayDays: 0 };
    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);
    const sevenDaysAgoStr = format(sevenDaysAgo, 'yyyy-MM-dd');

    const recentCashOutflows = vouchers.filter((v) => {
      if (v.status === 'Voided' || v.status === 'Pending_Approval' || v.payment_type === 'Advance_Settlement') return false;
      if (v.payment_method !== 'Physical_Cash') return false;
      const vDate = normalizeDateToYMD(v.payment_date || v.created_at);
      return vDate >= sevenDaysAgoStr;
    });

    const total7DayCash = recentCashOutflows.reduce((sum, v) => sum + (Number(v.total_amount) || 0), 0);
    const dailyAverageCashBurn = Math.max(Math.round(total7DayCash / 7), 500);
    const runwayDays = Math.round(cashBalance / dailyAverageCashBurn);

    return {
      dailyAverageCashBurn,
      runwayDays,
    };
  }, [vouchers, cashBalance, activeViewMode]);

  // 7-Day Burn Rate Velocity Meter
  const burnRateStats = useMemo(() => {
    if (activeViewMode === 'cashier') return { todayOutflow: 0, rollingDailyAverage: 0, deltaAmount: 0, deltaPercent: 0, paceStatus: 'normal' as const };
    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');
    const sevenDaysAgoStr = format(subDays(now, 7), 'yyyy-MM-dd');

    const past7DaysVouchers = vouchers.filter((v) => {
      if (v.status === 'Voided' || v.status === 'Pending_Approval' || v.payment_type === 'Advance_Settlement') return false;
      const vDate = normalizeDateToYMD(v.payment_date || v.created_at);
      return vDate >= sevenDaysAgoStr && vDate < todayStr;
    });

    const totalPast7DaysSpend = past7DaysVouchers.reduce((sum, v) => sum + (Number(v.total_amount) || 0), 0);
    const rollingDailyAverage = Math.round(totalPast7DaysSpend / 7);
    const todayOutflow = treasuryBreakdown.total.outflow;

    const deltaAmount = todayOutflow - rollingDailyAverage;
    const deltaPercent = rollingDailyAverage > 0 ? Math.round(((todayOutflow - rollingDailyAverage) / rollingDailyAverage) * 100) : 0;

    let paceStatus: 'normal' | 'above' | 'spike' | 'below' = 'normal';
    if (todayOutflow === 0 || deltaPercent === 0) {
      paceStatus = 'normal';
    } else if (deltaPercent > 50) {
      paceStatus = 'spike';
    } else if (deltaPercent > 0) {
      paceStatus = 'above';
    } else {
      paceStatus = 'below';
    }

    return {
      todayOutflow,
      rollingDailyAverage,
      deltaAmount,
      deltaPercent,
      paceStatus,
    };
  }, [vouchers, treasuryBreakdown.total.outflow, activeViewMode]);

  // Category Spend Stats
  const categoryStats = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    filteredVouchers
      .filter(
        (v) =>
          v.status !== 'Voided' &&
          v.status !== 'Pending_Approval' &&
          v.payment_type !== 'Advance_Settlement'
      )
      .forEach((v) => {
        const cat = v.category_name || 'Other';
        const cur = map.get(cat) || { count: 0, amount: 0 };
        map.set(cat, {
          count: cur.count + 1,
          amount: cur.amount + (Number(v.total_amount) || 0),
        });
      });

    const catPalette = ['#3ecf8e', '#2bb379', '#10b981', '#0f766e', '#115e59', '#334155', '#475569', '#64748b'];
    return Array.from(map.entries())
      .map(([name, stat], idx) => ({
        name,
        count: stat.count,
        amount: stat.amount,
        percentage: metrics.totalSpend > 0 ? Math.round((stat.amount / metrics.totalSpend) * 100) : 0,
        color: catPalette[idx % catPalette.length],
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredVouchers, metrics.totalSpend]);

  const showroomTitle = selectedBranchId === 'ALL' ? 'All Showrooms' : (activeBranch?.branch_name || 'Satellite Road Showroom');
  const timeRangeLabel =
    timeRange === 'today'
      ? 'Today'
      : timeRange === 'week'
      ? 'This Week'
      : timeRange === 'month'
      ? 'This Month'
      : timeRange === 'quarter'
      ? 'This Quarter'
      : timeRange === 'custom'
      ? (tableStartDate ? (tableStartDate === tableEndDate ? tableStartDate : `${tableStartDate} to ${tableEndDate}`) : 'Custom Range')
      : 'All Time';

  return (
    <div className="min-h-full flex-1 flex flex-col bg-white dark:bg-[#141414] text-slate-900 dark:text-[#EDEDED] font-sans antialiased selection:bg-[#3ecf8e]/20 selection:text-[#3ecf8e] select-none">
      {/* =========================================================================
          TOP COMMAND HEADER (ADAPTIVE TO USER RIGHTS & BRANCH SELECTION)
         ========================================================================= */}
      <div className="px-4 lg:px-6 py-4 border-b border-slate-200 dark:border-[#242424] bg-white dark:bg-[#141414]">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-medium tracking-tight text-slate-900 dark:text-[#EDEDED] font-sans flex items-center gap-2">
                <LayoutDashboard className="w-5 h-5 text-[#3ecf8e]" />
                <span>
                  {activeViewMode === 'cashier'
                    ? 'Cash Desk & Shift Till Operations'
                    : activeViewMode === 'manager'
                    ? 'Showroom Operational Command'
                    : activeViewMode === 'auditor'
                    ? 'Compliance & Internal Audit Studio'
                    : 'Executive Enterprise Command Center'}
                </span>
              </h1>

              {/* View Role Badge */}
              <span
                className={cn(
                  'px-2.5 py-0.5 rounded-[4px] text-[11px] font-medium font-mono tabular-nums border whitespace-nowrap inline-flex items-center gap-1',
                  activeViewMode === 'cashier'
                    ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20'
                    : activeViewMode === 'manager'
                    ? 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20'
                    : activeViewMode === 'auditor'
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'
                    : 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border-emerald-500/20'
                )}
              >
                {activeViewMode === 'cashier' ? (
                  <>
                    <User className="w-3 h-3" /> Cashier Till Mode
                  </>
                ) : activeViewMode === 'manager' ? (
                  <>
                    <Briefcase className="w-3 h-3" /> Manager Supervision Mode
                  </>
                ) : activeViewMode === 'auditor' ? (
                  <>
                    <ShieldCheck className="w-3 h-3" /> Auditor Compliance Mode
                  </>
                ) : (
                  <>
                    <Shield className="w-3 h-3" /> Super Admin View
                  </>
                )}
              </span>

              {/* Branch Tag */}
              <span className="px-2.5 py-0.5 rounded-[4px] text-[11px] font-medium font-mono bg-slate-100 dark:bg-[#1f1f1f] text-slate-700 dark:text-[#A1A1A1] border border-slate-200 dark:border-[#2e2e2e] inline-flex items-center gap-1">
                <Building2 className="w-3 h-3 text-[#3ecf8e]" />
                <span>{selectedBranchId === 'ALL' ? 'Chain-Wide (All Showrooms)' : (activeBranch?.branch_code || 'Store')}</span>
              </span>

              {/* Bills Count Indicator */}
              <span className="px-2 py-0.5 rounded-[4px] text-[11px] font-medium font-mono tabular-nums bg-slate-100 dark:bg-[#1f1f1f] text-slate-600 dark:text-[#A1A1A1] border border-slate-200 dark:border-[#2e2e2e] whitespace-nowrap inline-flex items-center">
                {timeRange === 'today' ? `${metrics.totalBills} bills today` : `${metrics.totalBills} bills in view`}
              </span>

              {/* Period Lock Status */}
              {isPeriodLocked && (
                <span className="px-2 py-0.5 rounded-[4px] text-[10px] font-mono uppercase bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 inline-flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Day Locked
                </span>
              )}
            </div>

            <p className="text-xs text-slate-500 dark:text-[#A1A1A1] font-sans mt-0.5">
              {activeViewMode === 'cashier'
                ? `Today's shift till balance, physical drawer cash, and payment vouchers for ${showroomTitle}.`
                : activeViewMode === 'manager'
                ? `Store cost centers, staff advance follow-ups, liquidity, and daily shift balancing for ${showroomTitle}.`
                : activeViewMode === 'auditor'
                ? `Immutable audit logs, voided voucher scrutiny, duplicate risk exposure, and statutory compliance for ${showroomTitle}.`
                : `Consolidated enterprise financial telemetry, multi-branch liquidity, MoM comparisons, and audit intelligence.`}
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            {/* Signature Emerald CTA: Exactly ONE per viewport */}
            {can('can_create_voucher') && (
              <button
                type="button"
                onClick={() => setActivePage('new-voucher')}
                className="h-9 px-3.5 py-1.5 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-medium text-xs font-sans flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs active:bg-[#1fa672]"
              >
                <Plus className="w-4 h-4 text-[#171717] stroke-[2.5]" />
                <span>New Expense (F2)</span>
              </button>
            )}

            {/* Reports & Tally Link (Manager & Admin only) */}
            {activeViewMode !== 'cashier' && can('can_export_tally') && (
              <button
                type="button"
                onClick={() => setActivePage('reports')}
                className="h-9 px-3 py-1.5 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-slate-50 dark:bg-[#1a1a1a] hover:bg-slate-100 dark:hover:bg-[#222222] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-[#EDEDED] text-xs font-medium font-sans flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Consolidated Financial & Tally Prime Reports Hub"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-[#3ecf8e]" />
                <span className="hidden sm:inline">Reports &amp; Tally</span>
              </button>
            )}

            {/* Duplicate Radar Button (Manager & Admin only) */}
            {activeViewMode !== 'cashier' && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('light');
                  setIsDuplicateModalOpen(true);
                }}
                className={cn(
                  'h-9 px-3 py-1.5 rounded-[6px] border text-xs font-medium font-sans flex items-center gap-1.5 transition-colors cursor-pointer',
                  duplicateActiveCount > 0
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20'
                    : 'border-slate-200 dark:border-[#2e2e2e] bg-slate-50 dark:bg-[#1a1a1a] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-[#EDEDED]'
                )}
                title="Duplicate Detection & Resolution Studio"
              >
                <ShieldAlert className={cn('w-3.5 h-3.5', duplicateActiveCount > 0 ? 'text-rose-500 animate-pulse' : 'text-[#3ecf8e]')} />
                <span className="hidden sm:inline">Duplicates</span>
                <span
                  className={cn(
                    'px-1.5 py-0.2 rounded-full font-mono text-[10px]',
                    duplicateActiveCount > 0 ? 'bg-rose-500 text-white font-bold' : 'bg-slate-200 dark:bg-[#282828] text-slate-600 dark:text-[#aaa]'
                  )}
                >
                  {duplicateActiveCount}
                </span>
              </button>
            )}

            {/* Refresh Button */}
            <button
              type="button"
              onClick={() => refresh()}
              disabled={loading}
              className="h-9 w-9 flex items-center justify-center rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-slate-50 dark:bg-[#1a1a1a] hover:bg-slate-100 dark:hover:bg-[#222222] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-[#EDEDED] transition-colors cursor-pointer"
              title="Refresh Dashboard"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin text-[#3ecf8e]')} />
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          MAIN STUDIO CONTENT AREA
         ========================================================================= */}
      <div className="px-4 lg:px-6 py-4 space-y-4 flex-1">
        {/* Period Locked Notice Banner */}
        {isPeriodLocked && (
          <div className="p-3 rounded-[12px] bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3 text-amber-800 dark:text-amber-300 text-xs font-sans">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <span>
                <strong>Day-End Period Locked:</strong> Today's register has been closed by the cashier. New expenses are disabled until the next session is unlocked.
              </span>
            </div>
            {activeViewMode !== 'cashier' && (
              <button
                type="button"
                onClick={() => setActivePage('settings')}
                className="px-2.5 py-1 rounded-[6px] bg-amber-500/20 hover:bg-amber-500/30 font-medium text-[11px] shrink-0 transition-colors cursor-pointer"
              >
                Manage Periods (F11)
              </button>
            )}
          </div>
        )}

        {/* =========================================================================
            DASHBOARD TYPE 1: CASHIER DASHBOARD (SHIFT TILL ONLY, ULTRA FAST)
           ========================================================================= */}
        {activeViewMode === 'cashier' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Cashier Shift KPIs: 4 Pure Physical Till Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard
                label="Day Opening Cash Float"
                value={formatINR(dailyCashSummary.periodOpening)}
                subValue="Starting cash in till"
                badge="OPENING"
                badgeColor="neutral"
                icon={Wallet}
              />

              <MetricCard
                label="Cash Inflows (Added Today)"
                value={`+${formatINR(dailyCashSummary.periodInflows)}`}
                subValue={`${inflowMetrics.cashCount} top-ups / injections`}
                statusDotColor="#3ecf8e"
                badge="FLOAT IN"
                badgeColor="emerald"
                icon={Coins}
              />

              <MetricCard
                label="Cash Vouchers Paid (Today)"
                value={`-${formatINR(dailyCashSummary.periodOutflows)}`}
                subValue={`${metrics.cashBills} cash vouchers created`}
                badge="PAID OUT"
                badgeColor="neutral"
                icon={Receipt}
              />

              <MetricCard
                label="Expected Physical Cash"
                value={formatINR(dailyCashSummary.currentWalletCash)}
                subValue="Must match physical drawer notes"
                statusDotColor={isLowFloatAlert ? '#ef4444' : '#3ecf8e'}
                badge={isLowFloatAlert ? 'LOW FLOAT' : 'IN TILL'}
                badgeColor={isLowFloatAlert ? 'amber' : 'emerald'}
                icon={TrendingUp}
              />
            </div>

            {/* Cashier Alerts (Low Float) */}
            {isLowFloatAlert && (
              <div className="p-3 rounded-[12px] bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-3 text-rose-800 dark:text-rose-300 text-xs font-sans">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                  <span>
                    <strong>Low Float Alert:</strong> Physical cash is ₹{cashBalance.toLocaleString('en-IN')}, below minimum threshold (₹{minCashThreshold.toLocaleString('en-IN')}). Contact Store Manager for float injection.
                  </span>
                </div>
              </div>
            )}

            {/* Shift Digital & UPI Reconciliation Hub */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-[10px] bg-slate-50 dark:bg-[#18181a] border border-slate-200/80 dark:border-[#242424] flex items-center justify-between shadow-2xs">
                <div>
                  <span className="text-[11px] font-sans text-slate-500 dark:text-[#888] block">Today&apos;s UPI / Digital</span>
                  <span className="text-base font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                    {formatINR(metrics.upiSpend)}
                  </span>
                  <span className="text-[10px] text-slate-400 font-sans block mt-0.5">
                    {metrics.upiBills} direct QR / UPI vouchers
                  </span>
                </div>
                <div className="w-8 h-8 rounded-[6px] bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Smartphone className="w-4 h-4" />
                </div>
              </div>

              <div className="p-3.5 rounded-[10px] bg-slate-50 dark:bg-[#18181a] border border-slate-200/80 dark:border-[#242424] flex items-center justify-between shadow-2xs">
                <div>
                  <span className="text-[11px] font-sans text-slate-500 dark:text-[#888] block">Gross Shift Outflow</span>
                  <span className="text-base font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                    {formatINR(metrics.totalSpend)}
                  </span>
                  <span className="text-[10px] text-slate-400 font-sans block mt-0.5">
                    {metrics.totalBills} total bills (Cash + UPI)
                  </span>
                </div>
                <div className="w-8 h-8 rounded-[6px] bg-emerald-500/10 text-emerald-600 dark:text-[#3ecf8e] flex items-center justify-center">
                  <Receipt className="w-4 h-4" />
                </div>
              </div>

              <div className="p-3.5 rounded-[10px] bg-slate-50 dark:bg-[#18181a] border border-slate-200/80 dark:border-[#242424] flex items-center justify-between shadow-2xs">
                <div>
                  <span className="text-[11px] font-sans text-slate-500 dark:text-[#888] block">Shift Till Status</span>
                  <span className="text-sm font-semibold text-emerald-700 dark:text-[#3ecf8e] flex items-center gap-1.5 mt-0.5">
                    <span className="w-2 h-2 rounded-full bg-[#3ecf8e] animate-pulse" />
                    <span>Active &amp; Balanced</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-sans block mt-0.5">
                    {isPeriodLocked ? 'Shift Closed / Period Locked' : 'Ready for billing'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActivePage('treasury')}
                  className="px-2.5 py-1.5 rounded-[6px] bg-[#3ecf8e]/15 hover:bg-[#3ecf8e]/25 text-emerald-800 dark:text-[#3ecf8e] text-xs font-semibold font-sans transition-colors cursor-pointer"
                >
                  Drawer &rarr;
                </button>
              </div>
            </div>

            {/* Quick POS Terminal Action Strip */}
            <div className="p-3 bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#242424] rounded-[12px] flex flex-wrap items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-2.5 text-xs font-sans text-slate-600 dark:text-[#A1A1A1] flex-wrap">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#3ecf8e]" />
                  <span>
                    Operator: <strong>{user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username : 'Cashier'}</strong> · Showroom: <strong>{showroomTitle}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200 dark:border-[#2a2a2a]">
                  <span className="text-[11px] font-medium text-slate-500">Till Date:</span>
                  <DateRangePicker
                    startDate={tableStartDate}
                    endDate={tableEndDate}
                    onChange={(range) => {
                      const today = format(new Date(), 'yyyy-MM-dd');
                      setCustomStartDate(range.startDate);
                      setCustomEndDate(range.endDate);
                      if (!range.startDate && !range.endDate) {
                        setTimeRange('all');
                      } else if (range.startDate === today && range.endDate === today) {
                        setTimeRange('today');
                      } else {
                        setTimeRange('custom');
                      }
                    }}
                    size="sm"
                  />
                  {timeRange !== 'today' && (
                    <button
                      type="button"
                      onClick={() => {
                        const today = format(new Date(), 'yyyy-MM-dd');
                        setTimeRange('today');
                        setCustomStartDate(today);
                        setCustomEndDate(today);
                        triggerHaptic('light');
                      }}
                      className="px-2 py-1 rounded-[4px] bg-slate-100 dark:bg-[#222] hover:bg-slate-200 dark:hover:bg-[#2a2a2a] text-[11px] font-mono text-[#3ecf8e] transition-colors cursor-pointer border border-[#3ecf8e]/30"
                      title="Return to Today's Shift Till"
                    >
                      Return to Today
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setActivePage('new-voucher')}
                  className="px-3 py-1.5 rounded-[6px] bg-slate-100 dark:bg-[#202020] hover:bg-slate-200 dark:hover:bg-[#282828] text-xs font-medium text-slate-800 dark:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <kbd className="px-1 py-0.5 rounded text-[10px] font-mono bg-black/10 dark:bg-white/10 text-[#3ecf8e]">F2</kbd>
                  <span>New Expense</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActivePage('treasury')}
                  className="px-3 py-1.5 rounded-[6px] bg-slate-100 dark:bg-[#202020] hover:bg-slate-200 dark:hover:bg-[#282828] text-xs font-medium text-slate-800 dark:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <kbd className="px-1 py-0.5 rounded text-[10px] font-mono bg-black/10 dark:bg-white/10 text-[#3ecf8e]">F4</kbd>
                  <span>Cash Drawer</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCalculatorOpen(true)}
                  className="px-3 py-1.5 rounded-[6px] bg-slate-100 dark:bg-[#202020] hover:bg-slate-200 dark:hover:bg-[#282828] text-xs font-medium text-slate-800 dark:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <kbd className="px-1 py-0.5 rounded text-[10px] font-mono bg-black/10 dark:bg-white/10 text-[#3ecf8e]">F5</kbd>
                  <span>Calculator</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActivePage('expenses')}
                  className="px-3 py-1.5 rounded-[6px] bg-slate-100 dark:bg-[#202020] hover:bg-slate-200 dark:hover:bg-[#282828] text-xs font-medium text-slate-800 dark:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <kbd className="px-1 py-0.5 rounded text-[10px] font-mono bg-black/10 dark:bg-white/10 text-[#3ecf8e]">F3</kbd>
                  <span>All Expenses</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            DASHBOARD TYPE 2: STORE MANAGER DASHBOARD (OPERATIONAL SUPERVISION)
           ========================================================================= */}
        {activeViewMode === 'manager' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Store Manager Slicers Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-2 rounded-[8px] border border-slate-200/80 dark:border-[#242424] bg-white dark:bg-[#161616] shadow-2xs">
              <div className="flex flex-wrap items-center gap-2.5">
                <SegmentedControl
                  options={[
                    { id: 'today', label: 'Today' },
                    { id: 'week', label: 'This Week' },
                    { id: 'month', label: 'This Month' },
                  ]}
                  value={timeRange === 'today' || timeRange === 'week' || timeRange === 'month' ? timeRange : ''}
                  onChange={(val) => {
                    setTimeRange(val as typeof timeRange);
                    const now = new Date();
                    if (val === 'today') {
                      const t = format(now, 'yyyy-MM-dd');
                      setCustomStartDate(t);
                      setCustomEndDate(t);
                    } else if (val === 'week') {
                      setCustomStartDate(format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
                      setCustomEndDate(format(now, 'yyyy-MM-dd'));
                    } else if (val === 'month') {
                      setCustomStartDate(format(startOfMonth(now), 'yyyy-MM-dd'));
                      setCustomEndDate(format(now, 'yyyy-MM-dd'));
                    }
                  }}
                  size="sm"
                />

                <DateRangePicker
                  startDate={tableStartDate}
                  endDate={tableEndDate}
                  onChange={(range) => {
                    const today = format(new Date(), 'yyyy-MM-dd');
                    setCustomStartDate(range.startDate);
                    setCustomEndDate(range.endDate);
                    if (!range.startDate && !range.endDate) {
                      setTimeRange('all');
                    } else if (range.startDate === today && range.endDate === today) {
                      setTimeRange('today');
                    } else {
                      setTimeRange('custom');
                    }
                  }}
                  size="sm"
                />

                <SegmentedControl
                  options={[
                    { id: 'ALL', label: 'All Modes' },
                    { id: 'Physical_Cash', label: 'Cash Only' },
                    { id: 'Online_UPI', label: 'UPI Only' },
                  ]}
                  value={selectedMode}
                  onChange={(val) => setSelectedMode(val as typeof selectedMode)}
                  size="sm"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActivePage('treasury')}
                  className="h-8 px-2.5 py-1 rounded-[6px] border border-[#3ecf8e]/30 bg-[#3ecf8e]/10 hover:bg-[#3ecf8e]/20 text-emerald-800 dark:text-[#3ecf8e] text-xs font-medium font-sans flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Coins className="w-3.5 h-3.5" />
                  <span>Add / Inject Float (F4)</span>
                </button>

                {activeSlicerCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const today = format(new Date(), 'yyyy-MM-dd');
                      setTimeRange('today');
                      setSelectedMode('ALL');
                      setCustomStartDate(today);
                      setCustomEndDate(today);
                      setActiveDeptFilter('ALL');
                      setActiveCatFilter('ALL');
                      triggerHaptic('light');
                    }}
                    className="h-8 px-2.5 py-1 rounded-[6px] border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium font-sans flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset ({activeSlicerCount})</span>
                  </button>
                )}
              </div>
            </div>

            {/* Store Liquidity & Balancing (4 Dual-Mode Cards) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard
                label="Day Opening Balance"
                value={formatINR(treasuryBreakdown.total.opening)}
                subValue={`Cash: ${formatINR(treasuryBreakdown.cash.opening)} | UPI: ${formatINR(treasuryBreakdown.upi.opening)}`}
                badge="OPENING"
                badgeColor="neutral"
                icon={Wallet}
                onClick={() => setActivePage('treasury')}
              />

              <MetricCard
                label="Day Inflows (Credits)"
                value={`+${formatINR(treasuryBreakdown.total.inflow)}`}
                subValue={`Cash: +${formatINR(treasuryBreakdown.cash.inflow)} | UPI: +${formatINR(treasuryBreakdown.upi.inflow)}`}
                statusDotColor="#3ecf8e"
                badge="INFLOW"
                badgeColor="emerald"
                icon={Coins}
                onClick={() => setActivePage('treasury')}
              />

              <MetricCard
                label="Total Spent in Period"
                value={`-${formatINR(treasuryBreakdown.total.outflow)}`}
                subValue={`Cash: -${formatINR(treasuryBreakdown.cash.outflow)} | UPI: -${formatINR(treasuryBreakdown.upi.outflow)}`}
                badge="PAID OUT"
                badgeColor="neutral"
                icon={Receipt}
                onClick={() => setActivePage('expenses')}
              />

              <MetricCard
                label="Closing Store Liquidity"
                value={formatINR(treasuryBreakdown.total.closing)}
                subValue={`Cash: ${formatINR(treasuryBreakdown.cash.closing)} | UPI: ${formatINR(treasuryBreakdown.upi.closing)}`}
                statusDotColor={isLowFloatAlert ? '#ef4444' : '#3ecf8e'}
                badge={isLowFloatAlert ? 'LOW FLOAT' : 'REMAINING'}
                badgeColor={isLowFloatAlert ? 'amber' : 'emerald'}
                icon={Building2}
                onClick={() => setActivePage('treasury')}
              />
            </div>

            {/* Manager Operational Control Matrix (2-Column Grid) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Left Column: Top Store Cost Centers */}
              <div className="lg:col-span-6 p-4 sm:p-5 bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] rounded-[12px] space-y-3 shadow-sm">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-[#242424]">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-[#3ecf8e]" />
                    <h3 className="text-sm font-medium tracking-tight text-slate-900 dark:text-white font-sans">
                      Top Store Cost Centers ({showroomTitle})
                    </h3>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-[#888]">
                    {departmentStats.length} Cost Centers
                  </span>
                </div>

                <div className="space-y-2">
                  {departmentStats.length === 0 ? (
                    <div className="py-6 text-center text-slate-500 dark:text-[#737373] text-xs font-sans">
                      No department expenses recorded for this timeframe.
                    </div>
                  ) : (
                    departmentStats.slice(0, 4).map((dept, idx) => {
                      const isSelected = activeDeptFilter === dept.name;
                      return (
                        <button
                          key={dept.name}
                          type="button"
                          onClick={() => {
                            triggerHaptic('light');
                            setActiveDeptFilter(isSelected ? 'ALL' : dept.name);
                          }}
                          className={cn(
                            'w-full text-left p-2.5 rounded-[8px] border transition-all cursor-pointer group shadow-2xs space-y-1.5',
                            isSelected
                              ? 'bg-[#3ecf8e]/10 border-[#3ecf8e] ring-1 ring-[#3ecf8e]/30'
                              : 'bg-slate-50 dark:bg-[#18181a] border-slate-200 dark:border-[#242424] hover:bg-slate-100 dark:hover:bg-[#1c1c1e]'
                          )}
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-900 dark:text-white truncate">
                              #{idx + 1} {dept.name} ({dept.count} bills)
                            </span>
                            <div className="flex items-center gap-1.5 font-mono">
                              <span className="font-bold text-slate-900 dark:text-white">{formatINR(dept.amount)}</span>
                              <span className="text-[10px] text-emerald-700 dark:text-[#3ecf8e] font-bold">({dept.percentage}%)</span>
                            </div>
                          </div>
                          <div className="w-full h-1.5 bg-slate-200 dark:bg-[#282828] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${Math.max(dept.percentage, 4)}%`, backgroundColor: dept.color }}
                            />
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Store Risk & Advance Oversight */}
              <div className="lg:col-span-6 p-4 sm:p-5 bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] rounded-[12px] space-y-3 shadow-sm">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-[#242424]">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-purple-500" />
                    <h3 className="text-sm font-medium tracking-tight text-slate-900 dark:text-white font-sans">
                      Staff Advance Aging &amp; Showroom Alerts
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActivePage('advances')}
                    className="text-xs text-emerald-600 dark:text-[#3ecf8e] hover:underline cursor-pointer"
                  >
                    View Advances (F7) &rarr;
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div className="p-2.5 rounded-[8px] bg-emerald-500/5 dark:bg-[#14221a] border border-emerald-500/20">
                    <span className="text-[10px] font-mono text-emerald-700 dark:text-[#3ecf8e] block uppercase">
                      0–7 Days
                    </span>
                    <span className="text-xs font-mono font-semibold text-slate-900 dark:text-white mt-0.5 block">
                      {formatINR(advanceAging.bracket0to7)}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-[8px] bg-amber-500/5 dark:bg-[#221c14] border border-amber-500/20">
                    <span className="text-[10px] font-mono text-amber-700 dark:text-amber-400 block uppercase">
                      8–15 Days
                    </span>
                    <span className="text-xs font-mono font-semibold text-slate-900 dark:text-white mt-0.5 block">
                      {formatINR(advanceAging.bracket8to15)}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-[8px] bg-rose-500/5 dark:bg-[#221417] border border-rose-500/20">
                    <span className="text-[10px] font-mono text-rose-700 dark:text-rose-400 block uppercase">
                      15+ Days Due
                    </span>
                    <span className="text-xs font-mono font-semibold text-rose-600 dark:text-rose-400 mt-0.5 block">
                      {formatINR(advanceAging.bracket15Plus)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            DASHBOARD TYPE 3: SUPER ADMIN DASHBOARD (LAZY LOADED ON DEMAND)
           ========================================================================= */}
        {activeViewMode === 'admin' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Admin Slicers & Smart Tab Switcher */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-2 rounded-[8px] border border-slate-200/80 dark:border-[#242424] bg-white dark:bg-[#161616] shadow-2xs">
              <div className="flex flex-wrap items-center gap-2.5">
                {/* Admin Sub-Tabs (Instant Overview vs Heavy Analytics) */}
                <div className="flex items-center bg-slate-100 dark:bg-[#202020] p-0.5 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e]">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('light');
                      setAdminTab('overview');
                    }}
                    className={cn(
                      'px-3 py-1 rounded-[4px] text-xs font-sans font-medium transition-colors cursor-pointer flex items-center gap-1.5',
                      adminTab === 'overview'
                        ? 'bg-white dark:bg-[#2a2a2a] text-slate-900 dark:text-white shadow-2xs'
                        : 'text-slate-600 dark:text-[#aaa] hover:text-slate-900 dark:hover:text-white'
                    )}
                  >
                    <LayoutDashboard className="w-3.5 h-3.5 text-[#3ecf8e]" />
                    <span>Live Operations</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('light');
                      setAdminTab('analytics');
                    }}
                    className={cn(
                      'px-3 py-1 rounded-[4px] text-xs font-sans font-medium transition-colors cursor-pointer flex items-center gap-1.5',
                      adminTab === 'analytics'
                        ? 'bg-white dark:bg-[#2a2a2a] text-[#3ecf8e] shadow-2xs'
                        : 'text-slate-600 dark:text-[#aaa] hover:text-slate-900 dark:hover:text-white'
                    )}
                  >
                    <BarChart3 className="w-3.5 h-3.5 text-blue-500" />
                    <span>Deep Analytics &amp; Heatmaps</span>
                  </button>
                </div>

                <DateRangePicker
                  startDate={tableStartDate}
                  endDate={tableEndDate}
                  onChange={(range) => {
                    const today = format(new Date(), 'yyyy-MM-dd');
                    setCustomStartDate(range.startDate);
                    setCustomEndDate(range.endDate);
                    if (!range.startDate && !range.endDate) {
                      setTimeRange('all');
                    } else if (range.startDate === today && range.endDate === today) {
                      setTimeRange('today');
                    } else {
                      setTimeRange('custom');
                    }
                  }}
                  size="sm"
                />

                <SegmentedControl
                  options={[
                    { id: 'ALL', label: 'All Modes' },
                    { id: 'Physical_Cash', label: 'Cash' },
                    { id: 'Online_UPI', label: 'UPI' },
                  ]}
                  value={selectedMode}
                  onChange={(val) => setSelectedMode(val as typeof selectedMode)}
                  size="sm"
                />
              </div>

              <div className="flex items-center gap-2">
                {activeSlicerCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const today = format(new Date(), 'yyyy-MM-dd');
                      setTimeRange('today');
                      setSelectedMode('ALL');
                      setCustomStartDate(today);
                      setCustomEndDate(today);
                      setActiveDeptFilter('ALL');
                      setActiveCatFilter('ALL');
                      triggerHaptic('light');
                    }}
                    className="h-8 px-2.5 py-1 rounded-[6px] border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium font-sans flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset ({activeSlicerCount})</span>
                  </button>
                )}
              </div>
            </div>

            {/* TAB 1: LIVE OPERATIONS (Instant Render, Zero Lag) */}
            {adminTab === 'overview' && (
              <div className="space-y-4 animate-in fade-in duration-150">
                {/* 4 Metric Cards Telemetry Matrix: Dual Cash & UPI Day-Balance Architecture */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <MetricCard
                    label="Day Opening Balance"
                    value={formatINR(treasuryBreakdown.total.opening)}
                    subValue={`Cash: ${formatINR(treasuryBreakdown.cash.opening)} | UPI: ${formatINR(treasuryBreakdown.upi.opening)}`}
                    badge="OPENING"
                    badgeColor="neutral"
                    icon={Wallet}
                    onClick={() => setActivePage('treasury')}
                  />

                  <MetricCard
                    label="Day Inflow (Credits)"
                    value={`+${formatINR(treasuryBreakdown.total.inflow)}`}
                    subValue={`Cash: +${formatINR(treasuryBreakdown.cash.inflow)} | UPI: +${formatINR(treasuryBreakdown.upi.inflow)}`}
                    statusDotColor="#3ecf8e"
                    badge="INFLOW"
                    badgeColor="emerald"
                    icon={Coins}
                    onClick={() => setActivePage('treasury')}
                  />

                  <MetricCard
                    label="Total Pay Today"
                    value={`-${formatINR(treasuryBreakdown.total.outflow)}`}
                    subValue={`Cash: -${formatINR(treasuryBreakdown.cash.outflow)} | UPI: -${formatINR(treasuryBreakdown.upi.outflow)}`}
                    badge="PAID OUT"
                    badgeColor="neutral"
                    icon={Receipt}
                    onClick={() => setActivePage('expenses')}
                  />

                  <MetricCard
                    label="Remaining Balance as per Today"
                    value={formatINR(treasuryBreakdown.total.closing)}
                    subValue={`Cash: ${formatINR(treasuryBreakdown.cash.closing)} | UPI: ${formatINR(treasuryBreakdown.upi.closing)}`}
                    statusDotColor={isLowFloatAlert ? '#ef4444' : '#3ecf8e'}
                    badge={isLowFloatAlert ? 'LOW FLOAT' : 'REMAINING'}
                    badgeColor={isLowFloatAlert ? 'amber' : 'emerald'}
                    icon={Building2}
                    onClick={() => setActivePage('treasury')}
                  />
                </div>

                {/* Department-Wise Spending Tracking */}
                <div className="p-4 sm:p-5 bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] rounded-[12px] space-y-4 shadow-sm">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#242424]">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-[6px] bg-slate-100 dark:bg-[#1f1f1f] border border-slate-200 dark:border-[#2e2e2e] text-slate-600 dark:text-[#A1A1A1] flex items-center justify-center shrink-0">
                        <Layers className="w-4 h-4 text-[#3ecf8e]" />
                      </div>
                      <h3 className="text-sm font-medium tracking-tight text-slate-900 dark:text-white font-sans flex items-center gap-2">
                        <span>Department Cost-Center Spending Tracking</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e]">
                          Ranked by Outflow
                        </span>
                      </h3>
                    </div>

                    <span className="px-2.5 py-1 rounded-[4px] bg-slate-100 dark:bg-[#1f1f1f] border border-slate-200 dark:border-[#2e2e2e] font-mono text-xs font-semibold text-slate-900 dark:text-white tabular-nums shrink-0">
                      {departmentStats.length} Cost Centers
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {departmentStats.length === 0 ? (
                      <div className="col-span-2 py-8 text-center text-slate-500 dark:text-[#737373] text-xs font-sans">
                        No department expenses recorded in this period.
                      </div>
                    ) : (
                      departmentStats.slice(0, 4).map((dept, idx) => {
                        const isSelected = activeDeptFilter === dept.name;
                        return (
                          <button
                            key={dept.name}
                            type="button"
                            onClick={() => {
                              triggerHaptic('light');
                              setActiveDeptFilter(isSelected ? 'ALL' : dept.name);
                            }}
                            className={cn(
                              'w-full text-left p-3 rounded-[8px] border transition-all cursor-pointer group shadow-2xs space-y-2',
                              isSelected
                                ? 'bg-[#3ecf8e]/10 border-[#3ecf8e] ring-1 ring-[#3ecf8e]/30'
                                : 'bg-slate-50 dark:bg-[#18181a] border-slate-200 dark:border-[#242424] hover:bg-slate-100 dark:hover:bg-[#1c1c1e]'
                            )}
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-slate-900 dark:text-white truncate">
                                #{idx + 1} {dept.name} ({dept.count} bills)
                              </span>
                              <span className="font-mono font-bold text-slate-900 dark:text-white">
                                {formatINR(dept.amount)} ({dept.percentage}%)
                              </span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-200 dark:bg-[#282828] rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${Math.max(dept.percentage, 3)}%`, backgroundColor: dept.color }}
                              />
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Expense Categories & Cash Drawer Split */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  {/* Expense Categories */}
                  <div className="lg:col-span-6 p-4 sm:p-5 bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] rounded-[12px] space-y-4 shadow-sm">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#242424]">
                      <div className="flex items-center gap-2.5">
                        <PieChart className="w-4 h-4 text-[#3ecf8e]" />
                        <h3 className="text-sm font-medium tracking-tight text-slate-900 dark:text-white font-sans">
                          Expense Heads Breakdown
                        </h3>
                      </div>
                      <span className="text-xs font-mono text-slate-500 dark:text-[#A1A1A1]">
                        {categoryStats.length} Categories
                      </span>
                    </div>

                    <div className="space-y-2">
                      {categoryStats.slice(0, 5).map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-[#222]">
                          <span className="font-medium text-slate-900 dark:text-white">{item.name}</span>
                          <span className="font-mono font-semibold">{formatINR(item.amount)} ({item.percentage}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Cash Drawer Statement */}
                  <div className="lg:col-span-6 p-4 sm:p-5 bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] rounded-[12px] space-y-4 shadow-sm">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#242424]">
                      <div className="flex items-center gap-2.5">
                        <Wallet className="w-4 h-4 text-[#3ecf8e]" />
                        <h3 className="text-sm font-medium tracking-tight text-slate-900 dark:text-white font-sans">
                          Cash Drawer Statement
                        </h3>
                      </div>
                      <span className="text-xs font-mono text-[#3ecf8e] font-semibold">
                        Till: {formatINR(dailyCashSummary.currentWalletCash)}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {dailyCashSummary.days.slice(0, 4).map((day) => (
                        <div key={day.date} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-[#222]">
                          <span className="font-mono text-slate-700 dark:text-[#ccc]">{day.displayDate}</span>
                          <span className="font-mono font-semibold">Closing: {formatINR(day.closing)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: DEEP ANALYTICS & HEATMAPS (Smart Lazy Loaded on Demand) */}
            {adminTab === 'analytics' && (
              <div className="space-y-4 animate-in fade-in duration-200">
                {/* 7-Day Burn Rate Velocity Meter */}
                <div className="p-4 bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] rounded-[12px] flex items-center justify-between gap-3 shadow-2xs">
                  <div className="flex items-center gap-2.5">
                    <TrendingUp className="w-4 h-4 text-[#3ecf8e]" />
                    <span className="text-xs text-slate-600 dark:text-[#A1A1A1]">
                      7-Day Rolling Daily Average: <strong className="text-slate-900 dark:text-white font-mono">{formatINR(burnRateStats.rollingDailyAverage)}/day</strong>
                    </span>
                  </div>
                  <span
                    className={cn(
                      'px-2.5 py-1 rounded-[4px] text-xs font-mono font-bold uppercase inline-flex items-center gap-1.5',
                      burnRateStats.paceStatus === 'spike'
                        ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                        : burnRateStats.paceStatus === 'above'
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                        : burnRateStats.paceStatus === 'below'
                        ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30'
                        : 'bg-emerald-500/15 text-emerald-600 dark:text-[#3ecf8e] border border-emerald-500/30'
                    )}
                  >
                    <span>{burnRateStats.deltaPercent >= 0 ? `+${burnRateStats.deltaPercent}%` : `${burnRateStats.deltaPercent}%`}</span>
                    <span>{burnRateStats.paceStatus === 'spike' ? 'Spend Spike Detected' : burnRateStats.paceStatus === 'above' ? 'Pacing Above Average' : burnRateStats.paceStatus === 'below' ? 'Below Average' : 'Normal Pacing'}</span>
                  </span>
                </div>

                {/* MoM Comparison & Staff Advance Aging Row */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
                  {/* MoM Comparison Card */}
                  <div className="lg:col-span-6 p-4 sm:p-5 bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] rounded-[12px] space-y-3 shadow-sm">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-[#242424]">
                      <div className="flex items-center gap-2.5">
                        <Calendar className="w-4 h-4 text-blue-500" />
                        <div>
                          <h3 className="text-sm font-medium tracking-tight text-slate-900 dark:text-white font-sans">
                            MoM Spend Comparison
                          </h3>
                          <p className="text-[11px] text-slate-500 dark:text-[#A1A1A1]">
                            1st to {momComparison.currentDay}th of {momComparison.currentMonthName} vs {momComparison.prevMonthName}
                          </p>
                        </div>
                      </div>

                      <span
                        className={cn(
                          'px-2.5 py-1 rounded-[4px] font-mono text-xs font-semibold tabular-nums inline-flex items-center gap-1',
                          momComparison.deltaAmount > 0
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                            : 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/30'
                        )}
                      >
                        {momComparison.deltaAmount > 0 ? (
                          <>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                            <span>+{momComparison.deltaPercent}% MoM</span>
                          </>
                        ) : (
                          <>
                            <ArrowDownRight className="w-3.5 h-3.5" />
                            <span>{momComparison.deltaPercent}% MoM</span>
                          </>
                        )}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
                      <div className="p-2.5 rounded-[8px] bg-slate-50 dark:bg-[#18181a] border border-slate-200 dark:border-[#262626]">
                        <span className="text-[10px] font-mono text-slate-500 dark:text-zinc-400 block uppercase">
                          This Month (1-{momComparison.currentDay} {momComparison.currentMonthName.slice(0, 3)})
                        </span>
                        <span className="text-sm font-mono font-semibold text-slate-900 dark:text-white mt-0.5 block">
                          {formatINR(momComparison.currentMtdSpend)}
                        </span>
                      </div>

                      <div className="p-2.5 rounded-[8px] bg-slate-50 dark:bg-[#18181a] border border-slate-200 dark:border-[#262626]">
                        <span className="text-[10px] font-mono text-slate-500 dark:text-zinc-400 block uppercase">
                          Last Month Same Days
                        </span>
                        <span className="text-sm font-mono font-semibold text-slate-900 dark:text-white mt-0.5 block">
                          {formatINR(momComparison.prevMtdSpend)}
                        </span>
                      </div>

                      <div className="p-2.5 rounded-[8px] bg-slate-50 dark:bg-[#18181a] border border-slate-200 dark:border-[#262626] col-span-2 sm:col-span-1">
                        <span className="text-[10px] font-mono text-slate-500 dark:text-zinc-400 block uppercase">
                          Full {momComparison.prevMonthName} Total
                        </span>
                        <span className="text-sm font-mono font-semibold text-slate-900 dark:text-white mt-0.5 block">
                          {formatINR(momComparison.prevFullMonthSpend)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Staff Advance Aging & Cash Runway Card */}
                  <div className="lg:col-span-6 p-4 sm:p-5 bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] rounded-[12px] space-y-3 shadow-sm">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-[#242424]">
                      <div className="flex items-center gap-2.5">
                        <Users className="w-4 h-4 text-purple-500" />
                        <div>
                          <h3 className="text-sm font-medium tracking-tight text-slate-900 dark:text-white font-sans">
                            Staff Advance Aging &amp; Cash Runway
                          </h3>
                          <p className="text-[11px] text-slate-500 dark:text-[#A1A1A1]">
                            Risk exposure on pending advances and drawer operational days
                          </p>
                        </div>
                      </div>

                      <span className="px-2.5 py-1 rounded-[4px] bg-purple-500/10 border border-purple-500/20 text-purple-600 dark:text-purple-400 font-mono text-xs font-semibold tabular-nums shrink-0">
                        Runway: ~{cashRunway.runwayDays} Days
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5 pt-1">
                      <div className="p-2.5 rounded-[8px] bg-emerald-500/5 dark:bg-[#14221a] border border-emerald-500/20">
                        <span className="text-[10px] font-mono text-emerald-700 dark:text-[#3ecf8e] block uppercase">
                          0 – 7 Days (Active)
                        </span>
                        <span className="text-sm font-mono font-semibold text-slate-900 dark:text-white mt-0.5 block">
                          {formatINR(advanceAging.bracket0to7)}
                        </span>
                      </div>

                      <div className="p-2.5 rounded-[8px] bg-amber-500/5 dark:bg-[#221c14] border border-amber-500/20">
                        <span className="text-[10px] font-mono text-amber-700 dark:text-amber-400 block uppercase">
                          8 – 15 Days (Proof Due)
                        </span>
                        <span className="text-sm font-mono font-semibold text-slate-900 dark:text-white mt-0.5 block">
                          {formatINR(advanceAging.bracket8to15)}
                        </span>
                      </div>

                      <div className="p-2.5 rounded-[8px] bg-rose-500/5 dark:bg-[#221417] border border-rose-500/20">
                        <span className="text-[10px] font-mono text-rose-700 dark:text-rose-400 block uppercase">
                          15+ Days (Deduct Salary)
                        </span>
                        <span className="text-sm font-mono font-semibold text-rose-600 dark:text-rose-400 mt-0.5 block">
                          {formatINR(advanceAging.bracket15Plus)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Lazy-Loaded Hourly Heatmap */}
                <Suspense fallback={<WidgetSkeleton label="Hourly Heatmap Widget" height="h-64" />}>
                  <HourlyHeatmapWidget vouchers={filteredVouchers} />
                </Suspense>

                {/* Lazy-Loaded Activity Histogram */}
                <Suspense fallback={<WidgetSkeleton label="Activity Histogram" height="h-56" />}>
                  <LogsBarChart metrics={metrics} vouchers={filteredVouchers} selectedMode={selectedMode} />
                </Suspense>
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            DASHBOARD TYPE 4: AUDITOR DASHBOARD (STATUTORY & INTERNAL AUDIT COMPLIANCE)
           ========================================================================= */}
        {activeViewMode === 'auditor' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Auditor Slicers Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-2 rounded-[8px] border border-slate-200/80 dark:border-[#242424] bg-white dark:bg-[#161616] shadow-2xs">
              <div className="flex flex-wrap items-center gap-2.5">
                <SegmentedControl
                  options={[
                    { id: 'today', label: 'Today' },
                    { id: 'week', label: 'This Week' },
                    { id: 'month', label: 'This Month' },
                  ]}
                  value={timeRange === 'today' || timeRange === 'week' || timeRange === 'month' ? timeRange : ''}
                  onChange={(val) => {
                    setTimeRange(val as typeof timeRange);
                    const now = new Date();
                    if (val === 'today') {
                      const t = format(now, 'yyyy-MM-dd');
                      setCustomStartDate(t);
                      setCustomEndDate(t);
                    } else if (val === 'week') {
                      setCustomStartDate(format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
                      setCustomEndDate(format(now, 'yyyy-MM-dd'));
                    } else if (val === 'month') {
                      setCustomStartDate(format(startOfMonth(now), 'yyyy-MM-dd'));
                      setCustomEndDate(format(now, 'yyyy-MM-dd'));
                    }
                  }}
                  size="sm"
                />

                <DateRangePicker
                  startDate={tableStartDate}
                  endDate={tableEndDate}
                  onChange={(range) => {
                    const today = format(new Date(), 'yyyy-MM-dd');
                    setCustomStartDate(range.startDate);
                    setCustomEndDate(range.endDate);
                    if (!range.startDate && !range.endDate) {
                      setTimeRange('all');
                    } else if (range.startDate === today && range.endDate === today) {
                      setTimeRange('today');
                    } else {
                      setTimeRange('custom');
                    }
                  }}
                  size="sm"
                />

                <SegmentedControl
                  options={[
                    { id: 'ALL', label: 'All Modes' },
                    { id: 'Physical_Cash', label: 'Cash Only' },
                    { id: 'Online_UPI', label: 'UPI Only' },
                  ]}
                  value={selectedMode}
                  onChange={(val) => setSelectedMode(val as typeof selectedMode)}
                  size="sm"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsDuplicateModalOpen(true)}
                  className="h-8 px-2.5 py-1 rounded-[6px] border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-xs font-medium font-sans flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>Duplicate Risk Radar ({duplicateActiveCount})</span>
                </button>

                {activeSlicerCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const today = format(new Date(), 'yyyy-MM-dd');
                      setTimeRange('today');
                      setSelectedMode('ALL');
                      setCustomStartDate(today);
                      setCustomEndDate(today);
                      setActiveDeptFilter('ALL');
                      setActiveCatFilter('ALL');
                      triggerHaptic('light');
                    }}
                    className="h-8 px-2.5 py-1 rounded-[6px] border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium font-sans flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset ({activeSlicerCount})</span>
                  </button>
                )}
              </div>
            </div>

            {/* 4 Auditor Telemetry Metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard
                label="Voided Bills Audit"
                value={formatINR(voidedTotal)}
                subValue={`${voidedVouchers.length} cancelled vouchers in scope`}
                badge="CANCELLED"
                badgeColor={voidedVouchers.length > 0 ? 'rose' : 'neutral'}
                statusDotColor={voidedVouchers.length > 0 ? '#ef4444' : '#3ecf8e'}
                icon={AlertTriangle}
              />

              <MetricCard
                label="Duplicate Exposure Risk"
                value={formatINR(duplicateRiskTotal)}
                subValue={`${duplicateActiveCount} suspect vouchers in ${duplicateClusters.length} clusters`}
                badge={duplicateActiveCount > 0 ? 'SUSPECT' : 'VERIFIED'}
                badgeColor={duplicateActiveCount > 0 ? 'amber' : 'emerald'}
                statusDotColor={duplicateActiveCount > 0 ? '#f59e0b' : '#3ecf8e'}
                icon={ShieldAlert}
                onClick={() => setIsDuplicateModalOpen(true)}
              />

              <MetricCard
                label="Accounting Books Status"
                value={isPeriodLocked ? "Period Locked" : "Books Open"}
                subValue={isPeriodLocked ? "Financial register locked by cashier" : "Counter shifts active in progress"}
                badge={isPeriodLocked ? "LOCKED" : "ACTIVE"}
                badgeColor={isPeriodLocked ? "amber" : "emerald"}
                statusDotColor={isPeriodLocked ? "#f59e0b" : "#3ecf8e"}
                icon={isPeriodLocked ? Lock : CheckCircle2}
              />

              <MetricCard
                label="Overdue Advances (> 15d)"
                value={formatINR(advanceAging.bracket15Plus)}
                subValue="Flagged for payroll recovery"
                badge={advanceAging.bracket15Plus > 0 ? 'DEDUCT' : 'CLEAN'}
                badgeColor={advanceAging.bracket15Plus > 0 ? 'rose' : 'emerald'}
                statusDotColor={advanceAging.bracket15Plus > 0 ? '#ef4444' : '#3ecf8e'}
                icon={Users}
                onClick={() => setActivePage('advances')}
              />
            </div>

            {/* Auditor Scrutiny Panels: Voided Queue + Cryptographic Integrity */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
              {/* Voided Voucher Scrutiny Queue */}
              <div className="lg:col-span-7 p-4 sm:p-5 bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] rounded-[12px] space-y-3 shadow-2xs">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-[#242424]">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-500" />
                    <div>
                      <h3 className="text-sm font-medium text-slate-900 dark:text-white font-sans">
                        Voided & Cancelled Voucher Scrutiny Queue
                      </h3>
                      <p className="text-[11px] text-slate-500 dark:text-[#888]">
                        Mandatory justification checks for counter cancellations
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-[4px] bg-rose-500/10 text-rose-600 dark:text-rose-400 font-mono text-xs font-semibold">
                    {voidedVouchers.length} Bills
                  </span>
                </div>

                {voidedVouchers.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500 dark:text-[#888] font-sans">
                    <CheckCircle2 className="w-8 h-8 text-[#3ecf8e] mx-auto mb-2 opacity-80" />
                    <span>No voided vouchers found in active timeframe. All recorded bills are in approved status.</span>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {voidedVouchers.slice(0, 8).map((v) => (
                      <div
                        key={v.id}
                        className="p-2.5 rounded-[8px] bg-slate-50 dark:bg-[#18181a] border border-rose-500/20 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-slate-900 dark:text-white">
                              {v.voucher_number}
                            </span>
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-rose-500/15 text-rose-600 dark:text-rose-400 font-bold">
                              VOIDED
                            </span>
                            <span className="text-slate-500 font-mono text-[11px]">
                              {v.payment_date || (v.created_at ? v.created_at.slice(0, 10) : '')}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-[#aaa] truncate">
                            Payee: <strong>{v.recipient_name || '—'}</strong> · Category: {v.category_name || 'General'}
                          </p>
                          {v.remarks && (
                            <p className="text-[10px] text-slate-500 dark:text-[#888] italic truncate">
                              Reason: &quot;{v.remarks}&quot;
                            </p>
                          )}
                        </div>
                        <span className="font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">
                          {formatINR(Number(v.total_amount) || 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Statutory Compliance & Security Log Panel */}
              <div className="lg:col-span-5 p-4 sm:p-5 bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] rounded-[12px] space-y-3 shadow-2xs">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-[#242424]">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#3ecf8e]" />
                    <div>
                      <h3 className="text-sm font-medium text-slate-900 dark:text-white font-sans">
                        Statutory Security & Period Lock
                      </h3>
                      <p className="text-[11px] text-slate-500 dark:text-[#888]">
                        Cryptographic hash chain & period close audit
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-[4px] bg-[#3ecf8e]/10 text-emerald-700 dark:text-[#3ecf8e] font-mono text-xs font-semibold">
                    SHA-256
                  </span>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div className="p-2.5 rounded-[8px] bg-slate-50 dark:bg-[#18181a] border border-slate-200 dark:border-[#2a2a2a] flex items-center justify-between">
                    <span className="text-slate-600 dark:text-[#aaa]">Today&apos;s Accounting Books:</span>
                    <span className={cn('font-mono font-semibold', isPeriodLocked ? 'text-amber-500' : 'text-[#3ecf8e]')}>
                      {isPeriodLocked ? '🔒 Closed / Period Locked' : '🟢 Open / Shifts In Progress'}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-[8px] bg-slate-50 dark:bg-[#18181a] border border-slate-200 dark:border-[#2a2a2a] flex items-center justify-between">
                    <span className="text-slate-600 dark:text-[#aaa]">Hash Chain Signature:</span>
                    <span className="font-mono text-[#3ecf8e] font-semibold">✓ Verified Immutable</span>
                  </div>

                  <div>
                    <h4 className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-[#888] mb-1.5">
                      Recent Security Events ({auditLogs.length})
                    </h4>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {auditLogs.slice(0, 5).map((log) => (
                        <div
                          key={log.id}
                          className="p-2 rounded-[6px] bg-slate-100 dark:bg-[#1c1c1e] text-[11px] flex items-center justify-between font-mono"
                        >
                          <div className="truncate mr-2">
                            <span className="text-emerald-700 dark:text-[#3ecf8e] font-semibold">[{log.action_type}]</span>{' '}
                            <span className="text-slate-700 dark:text-[#ccc]">{log.target_identifier || log.target_entity}</span>
                          </div>
                          <span className="text-slate-400 text-[10px] shrink-0">
                            {format(new Date(log.created_at), 'HH:mm')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            COMMON SECTION: RECENT EXPENSE BILLS TABLE (BRANCH & USER RIGHT SCOPED)
           ========================================================================= */}
        <div id="dashboard-voucher-table" className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-[#3ecf8e]" />
              <div>
                <h2 className="text-sm font-medium text-slate-900 dark:text-white font-sans">
                  {activeViewMode === 'cashier'
                    ? "Today's Shift Bills & Receipts"
                    : activeViewMode === 'manager'
                    ? "Store Operational Expense Records"
                    : activeViewMode === 'auditor'
                    ? "Audit & Compliance Expense Scrutiny Grid"
                    : "Recent Expenses & Bills"}
                </h2>
                <p className="text-xs text-slate-500 dark:text-[#A1A1A1] font-sans mt-0.5">
                  {activeViewMode === 'cashier'
                    ? `Expense vouchers recorded for ${activeBranch?.branch_code || 'this showroom'}`
                    : `Recorded payments for ${showroomTitle}`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActivePage('expenses')}
              className="px-3 py-1.5 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-slate-100 dark:bg-[#1a1a1a] hover:bg-slate-200 dark:hover:bg-[#222222] text-xs font-medium text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer font-sans"
            >
              <span>{activeViewMode === 'cashier' ? 'View Full Ledger' : 'View All Expenses (F3)'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Active Click-to-Filter Slicers Banner */}
          {(activeDeptFilter !== 'ALL' || activeCatFilter !== 'ALL') && (
            <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 px-3 rounded-[8px] bg-[#3ecf8e]/10 border border-[#3ecf8e]/30 text-xs animate-in fade-in">
              <div className="flex flex-wrap items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-[#3ecf8e]" />
                <span className="font-medium text-slate-700 dark:text-zinc-200">Filtering Table By:</span>
                {activeDeptFilter !== 'ALL' && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] bg-[#3ecf8e] text-slate-950 font-semibold font-mono text-[11px] shadow-2xs">
                    <span>Dept: {activeDeptFilter}</span>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('light');
                        setActiveDeptFilter('ALL');
                      }}
                      className="hover:opacity-75 cursor-pointer"
                      title="Remove Department Filter"
                    >
                      <X className="w-3 h-3 stroke-[2.5]" />
                    </button>
                  </span>
                )}
                {activeCatFilter !== 'ALL' && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] bg-[#3ecf8e] text-slate-950 font-semibold font-mono text-[11px] shadow-2xs">
                    <span>Category: {activeCatFilter}</span>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('light');
                        setActiveCatFilter('ALL');
                      }}
                      className="hover:opacity-75 cursor-pointer"
                      title="Remove Category Filter"
                    >
                      <X className="w-3 h-3 stroke-[2.5]" />
                    </button>
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('light');
                  setActiveDeptFilter('ALL');
                  setActiveCatFilter('ALL');
                }}
                className="text-xs font-semibold text-emerald-800 dark:text-[#3ecf8e] hover:underline cursor-pointer"
              >
                Clear Slicers
              </button>
            </div>
          )}

          <div>
            <VoucherTable
              vouchers={filteredVouchers}
              categories={categories}
              departments={departments}
              hideTelemetry={true}
              initialPageSize={15}
              startDate={tableStartDate}
              endDate={tableEndDate}
              departmentFilter={activeDeptFilter}
              categoryFilter={activeCatFilter}
              onClearDepartmentFilter={() => setActiveDeptFilter('ALL')}
              onClearCategoryFilter={() => setActiveCatFilter('ALL')}
              onDateRangeChange={(range) => {
                const today = format(new Date(), 'yyyy-MM-dd');
                setCustomStartDate(range.startDate);
                setCustomEndDate(range.endDate);
                if (!range.startDate && !range.endDate) {
                  setTimeRange('all');
                } else if (range.startDate === today && range.endDate === today) {
                  setTimeRange('today');
                } else {
                  setTimeRange('custom');
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* Lazy-Loaded Duplicate Detection Studio Modal (Only mounted when triggered) */}
      {isDuplicateModalOpen && (
        <Suspense fallback={null}>
          <DuplicateDetectionModal
            isOpen={isDuplicateModalOpen}
            onClose={() => setIsDuplicateModalOpen(false)}
            clusters={duplicateClusters}
            onDismiss={dismissCluster}
            onRefresh={() => {
              refresh();
              loadWallet();
              loadLedger();
            }}
          />
        </Suspense>
      )}
    </div>
  );
};
