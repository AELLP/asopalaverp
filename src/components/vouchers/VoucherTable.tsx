import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ExpenseVoucher, ExpenseCategory, Department } from '@/types/database';
import { useUIStore } from '@/store/uiStore';
import { useAuthStore, isPrivilegedAdminRole } from '@/store/authStore';
import { formatINR, formatDate, formatVoucherNumber, cn, triggerHaptic, normalizeDateToYMD } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import {
  Search,
  Plus,
  Filter,
  Receipt,
  Download,
  CheckSquare,
  Square,
  Eye,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,  Layers,
  Coins,  CreditCard,  FileSpreadsheet,  SlidersHorizontal,
  BarChart3,  Building2,  RotateCcw,  User,
  Tag,  HandCoins,
  Coffee,
  Truck,
  Wrench,
  Store,
  Zap,  Wallet,
  CheckCircle2,
  Printer,} from 'lucide-react';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { openExclusivePopover } from '@/lib/popoverManager';
import { showToast } from '@/components/ui/ToastContainer';

const VoucherCategoryAvatar: React.FC<{ category?: string | null; className?: string }> = ({ category, className }) => {
  const cat = (category || '').toLowerCase();
  
  if (cat.includes('food') || cat.includes('meal') || cat.includes('tea') || cat.includes('snack') || cat.includes('welfare')) {
    return (
      <div className={cn("w-10 h-10 rounded-[10px] bg-amber-500/10 dark:bg-amber-400/15 border border-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0", className)}>
        <Coffee className="w-5 h-5 stroke-[2]" />
      </div>
    );
  }
  if (cat.includes('courier') || cat.includes('postage') || cat.includes('shipping') || cat.includes('delivery') || cat.includes('transport') || cat.includes('parcel')) {
    return (
      <div className={cn("w-10 h-10 rounded-[10px] bg-sky-500/10 dark:bg-sky-400/15 border border-sky-500/20 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0", className)}>
        <Truck className="w-5 h-5 stroke-[2]" />
      </div>
    );
  }
  if (cat.includes('repair') || cat.includes('maintenance') || cat.includes('hardware') || cat.includes('civil') || cat.includes('upkeep')) {
    return (
      <div className={cn("w-10 h-10 rounded-[10px] bg-indigo-500/10 dark:bg-indigo-400/15 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0", className)}>
        <Wrench className="w-5 h-5 stroke-[2]" />
      </div>
    );
  }
  if (cat.includes('electric') || cat.includes('power') || cat.includes('utility') || cat.includes('fuel') || cat.includes('petrol')) {
    return (
      <div className={cn("w-10 h-10 rounded-[10px] bg-yellow-500/10 dark:bg-yellow-400/15 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400 flex items-center justify-center shrink-0", className)}>
        <Zap className="w-5 h-5 stroke-[2]" />
      </div>
    );
  }
  if (cat.includes('staff') || cat.includes('advance') || cat.includes('salary') || cat.includes('bonus')) {
    return (
      <div className={cn("w-10 h-10 rounded-[10px] bg-emerald-500/10 dark:bg-emerald-400/15 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0", className)}>
        <HandCoins className="w-5 h-5 stroke-[2]" />
      </div>
    );
  }
  if (cat.includes('shop') || cat.includes('vendor') || cat.includes('store') || cat.includes('purchase')) {
    return (
      <div className={cn("w-10 h-10 rounded-[10px] bg-purple-500/10 dark:bg-purple-400/15 border border-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0", className)}>
        <Store className="w-5 h-5 stroke-[2]" />
      </div>
    );
  }
  return (
    <div className={cn("w-10 h-10 rounded-[10px] bg-slate-100 dark:bg-[#202020] border border-slate-200 dark:border-[#2e2e2e] text-slate-600 dark:text-zinc-300 flex items-center justify-center shrink-0", className)}>
      <Receipt className="w-5 h-5 stroke-[2]" />
    </div>
  );
};

const getRelativeDateBadge = (dateStr?: string) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'TODAY';
  if (diffDays === 1) return 'YESTERDAY';
  return null;
};

interface VoucherTableProps {
  vouchers: ExpenseVoucher[];
  categories: ExpenseCategory[];
  departments: Department[];
  showActionBanner?: boolean;
  hideTelemetry?: boolean;
  initialPageSize?: number;
  startDate?: string;
  endDate?: string;
  onDateRangeChange?: (range: { startDate: string; endDate: string }) => void;
  departmentFilter?: string;
  categoryFilter?: string;
  onClearDepartmentFilter?: () => void;
  onClearCategoryFilter?: () => void;
  title?: string;
  subtitle?: string;
}

type SortField =
  | 'date'
  | 'amount'
  | 'voucher_number'
  | 'recipient_name'
  | 'category'
  | 'department'
  | 'method'
  | 'status';
type SortOrder = 'asc' | 'desc';
type ViewPreset = 'all' | 'cash' | 'upi';
type TableDensity = 'compact' | 'normal' | 'relaxed';
type SubViewTab = 'grid' | 'analytics_category' | 'analytics_dept' | 'analytics_payee' | 'report';

type ColumnKey =
  | 'voucher_number'
  | 'date'
  | 'recipient_name'
  | 'category_name'
  | 'department_name'
  | 'payment_method'
  | 'total_amount'
  | 'actions';

const ALL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'voucher_number', label: 'Bill No.' },
  { key: 'date', label: 'Date' },
  { key: 'recipient_name', label: 'Paid To' },
  { key: 'category_name', label: 'Category' },
  { key: 'department_name', label: 'Department' },
  { key: 'payment_method', label: 'Mode' },
  { key: 'total_amount', label: 'Amount (₹)' },
  { key: 'actions', label: 'Tools' },
];

export const VoucherTable: React.FC<VoucherTableProps> = ({
  vouchers,
  categories,
  departments,
  showActionBanner = true,
  hideTelemetry = false,
  initialPageSize = 15,
  startDate,
  endDate,
  onDateRangeChange,
  departmentFilter,
  categoryFilter,
  onClearDepartmentFilter,
  onClearCategoryFilter,
  title,
  subtitle,
}) => {
  const { openDrawer, setActivePage } = useUIStore();
  const { user, can } = useAuthStore();
  const isDeveloper = user?.role_code === 'Developer' || user?.role_code === 'Super_Admin';
  const isAdminOrDev = Boolean(
    isDeveloper ||
    isPrivilegedAdminRole(user?.role_code) ||
    user?.role_code === 'Store_Manager' ||
    user?.role_code?.toLowerCase() === 'store_manager' ||
    can('can_view_all_branches') ||
    can('can_view_audit_logs')
  );

  const [analyticsReportType, setAnalyticsReportType] = useState<'department' | 'category' | 'payee' | 'matrix'>('department');

  // Sub-view tab
  const [activeSubTab, setActiveSubTab] = useState<SubViewTab>('grid');

  // Restrict macro analytics views to admin and dev only
  useEffect(() => {
    if (!isAdminOrDev && activeSubTab !== 'grid') {
      setActiveSubTab('grid');
    }
  }, [isAdminOrDev, activeSubTab]);

  // Date Range State (External sync + Internal fallback)
  const [internalStartDate, setInternalStartDate] = useState<string>(startDate || '');
  const [internalEndDate, setInternalEndDate] = useState<string>(endDate || '');

  useEffect(() => {
    if (startDate !== undefined) setInternalStartDate(startDate);
    if (endDate !== undefined) setInternalEndDate(endDate);
  }, [startDate, endDate]);

  const effectiveStartDate = startDate !== undefined ? startDate : internalStartDate;
  const effectiveEndDate = endDate !== undefined ? endDate : internalEndDate;

  const handleDateRangeChange = (range: { startDate: string; endDate: string }) => {
    setInternalStartDate(range.startDate);
    setInternalEndDate(range.endDate);
    if (onDateRangeChange) {
      onDateRangeChange(range);
    }
  };

  // Search & Filter State
  const [search, setSearch] = useState('');
  const [activeView, setActiveView] = useState<ViewPreset>('all');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [selectedMode, setSelectedMode] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');

  // Sync external department/category filter if passed
  useEffect(() => {
    if (departmentFilter !== undefined) {
      setSelectedDept(departmentFilter);
      setCurrentPage(1);
    }
  }, [departmentFilter]);

  useEffect(() => {
    if (categoryFilter !== undefined) {
      setSelectedCategory(categoryFilter);
      setCurrentPage(1);
    }
  }, [categoryFilter]);

  // Sorting State
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Selection & Focus State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // Pro Developer Controls
  const [tableDensity, setTableDensity] = useState<TableDensity>('compact');
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(
    new Set([
      'voucher_number',
      'date',
      'recipient_name',
      'category_name',
      'department_name',
      'payment_method',
      'total_amount',
      'actions',
    ])
  );
  const [showTelemetryBar, setShowTelemetryBar] = useState(true);
  const [mobileViewMode, setMobileViewMode] = useState<'cards' | 'table'>('cards');

  // Pagination State (Part-load default: 10 rows per page to prevent DOM bloat)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(initialPageSize);

  // Popovers & Feedback State
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false);
  const [activeRowDropdownId, setActiveRowDropdownId] = useState<string | null>(null);

  const categorySelectOptions = useMemo(() => [
    { value: 'ALL', label: `All Categories (${categories.length})` },
    ...categories.map((c) => ({ value: c.category_name, label: c.category_name })),
  ], [categories]);

  const departmentSelectOptions = useMemo(() => [
    { value: 'ALL', label: `All Departments (${departments.length})` },
    ...departments.map((d) => ({ value: d.department_name, label: d.department_name })),
  ], [departments]);

  const paymentModeSelectOptions = useMemo(() => [
    { value: 'ALL', label: 'All Payment Modes' },
    { value: 'Physical_Cash', label: 'Physical Cash' },
    { value: 'Online_UPI', label: 'Online UPI' },
  ], []);

  const statusSelectOptions = useMemo(() => [
    { value: 'ALL', label: 'All Statuses' },
    { value: 'Approved', label: 'Approved' },
    { value: 'Voided', label: 'Cancelled' },
  ], []);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
    const columnPickerRef = useRef<HTMLDivElement | null>(null);

  // Global mutual exclusivity dropdown listener
  useEffect(() => {
    const handleGlobalDropdownOpen = (e: Event) => {
      const customEvt = e as CustomEvent<string>;
      if (customEvt.detail !== 'voucher-columns') {
        setIsColumnPickerOpen(false);
      }
      if (customEvt.detail !== 'voucher-row') {
        setActiveRowDropdownId(null);
      }
    };
    window.addEventListener('asopalav:dropdown-open', handleGlobalDropdownOpen);
    return () => window.removeEventListener('asopalav:dropdown-open', handleGlobalDropdownOpen);
  }, []);

  // Close popovers on outside click and ESC key
  useEffect(() => {
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      if (columnPickerRef.current && !columnPickerRef.current.contains(e.target as Node)) {
        setIsColumnPickerOpen(false);
      }
      if (
        activeRowDropdownId &&
        !(e.target as HTMLElement).closest(`[data-dropdown-id="${activeRowDropdownId}"]`)
      ) {
        setActiveRowDropdownId(null);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsFilterOpen(false);
        setIsColumnPickerOpen(false);
        setActiveRowDropdownId(null);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeRowDropdownId]);

  const handleToggleColumnPicker = () => {
    if (isColumnPickerOpen) {
      setIsColumnPickerOpen(false);
    } else {
      setIsFilterOpen(false);
      setActiveRowDropdownId(null);
      setIsColumnPickerOpen(true);
      openExclusivePopover('voucher-columns');
    }
  };

  
  // Reset pagination on filter changes
  useEffect(() => {
    setCurrentPage(1);
    setFocusedIndex(-1);
  }, [
    search,
    activeView,
    selectedCategory,
    selectedDept,
    selectedMode,
    selectedStatus,
    minAmount,
    maxAmount,
    pageSize,
  ]);

  // Sorting helper
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder(field === 'amount' || field === 'date' ? 'desc' : 'asc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 opacity-40 shrink-0" />;
    }
    return sortOrder === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-primary shrink-0 stroke-[2.5]" />
    ) : (
      <ArrowDown className="w-3 h-3 text-primary shrink-0 stroke-[2.5]" />
    );
  };

  // Filtered & Sorted Records
  const filteredVouchers = useMemo(() => {
    let result = [...vouchers];

    // Preset view filter
    if (activeView === 'cash') {
      result = result.filter((v) => v.payment_method === 'Physical_Cash');
    } else if (activeView === 'upi') {
      result = result.filter((v) => v.payment_method === 'Online_UPI');
    }

    // Search query
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (v) =>
          v.voucher_number.toLowerCase().includes(q) ||
          v.recipient_name?.toLowerCase().includes(q) ||
          v.category_name?.toLowerCase().includes(q) ||
          v.department_name?.toLowerCase().includes(q) ||
          v.remarks?.toLowerCase().includes(q) ||
          v.branch_code?.toLowerCase().includes(q)
      );
    }

    // Dropdown filters (supports comma-separated multi-split categories and departments)
    if (selectedCategory !== 'ALL') {
      result = result.filter((v) => {
        if (!v.category_name) return false;
        if (v.category_name === selectedCategory) return true;
        return v.category_name
          .split(',')
          .map((c) => c.trim())
          .includes(selectedCategory);
      });
    }
    if (selectedDept !== 'ALL') {
      result = result.filter((v) => {
        if (!v.department_name) return false;
        if (v.department_name === selectedDept) return true;
        return v.department_name
          .split(',')
          .map((d) => d.trim())
          .includes(selectedDept);
      });
    }
    if (selectedMode !== 'ALL') {
      result = result.filter((v) => v.payment_method === selectedMode);
    }
    if (selectedStatus !== 'ALL') {
      result = result.filter((v) => (v.status || 'Approved') === selectedStatus);
    }

    // Date Range filter
    if (effectiveStartDate || effectiveEndDate) {
      const cleanStart = normalizeDateToYMD(effectiveStartDate);
      const cleanEnd = normalizeDateToYMD(effectiveEndDate);
      result = result.filter((v) => {
        const vDate = normalizeDateToYMD(v.payment_date || v.created_at);
        if (!vDate) return false;
        if (cleanStart && vDate < cleanStart) return false;
        if (cleanEnd && vDate > cleanEnd) return false;
        return true;
      });
    }

    // Amount range filter
    if (minAmount !== '' && !isNaN(Number(minAmount))) {
      result = result.filter((v) => (Number(v.total_amount) || 0) >= Number(minAmount));
    }
    if (maxAmount !== '' && !isNaN(Number(maxAmount))) {
      result = result.filter((v) => (Number(v.total_amount) || 0) <= Number(maxAmount));
    }

    // Sorting logic
    result.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'date') {
        comparison =
          new Date(a.payment_date || '').getTime() - new Date(b.payment_date || '').getTime();
      } else if (sortField === 'amount') {
        comparison = (Number(a.total_amount) || 0) - (Number(b.total_amount) || 0);
      } else if (sortField === 'voucher_number') {
        comparison = a.voucher_number.localeCompare(b.voucher_number);
      } else if (sortField === 'recipient_name') {
        comparison = (a.recipient_name || '').localeCompare(b.recipient_name || '');
      } else if (sortField === 'category') {
        comparison = (a.category_name || '').localeCompare(b.category_name || '');
      } else if (sortField === 'department') {
        comparison = (a.department_name || '').localeCompare(b.department_name || '');
      } else if (sortField === 'method') {
        comparison = (a.payment_method || '').localeCompare(b.payment_method || '');
      } else if (sortField === 'status') {
        comparison = (a.status || 'Approved').localeCompare(b.status || 'Approved');
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    return result;
  }, [
    vouchers,
    search,
    activeView,
    selectedCategory,
    selectedDept,
    selectedMode,
    selectedStatus,
    minAmount,
    maxAmount,
    sortField,
    sortOrder,
    effectiveStartDate,
    effectiveEndDate,
  ]);

  // Active valid vouchers for financial telemetry (excludes Voided, Pending_Approval, and non-cash Advance_Settlement)
  const validAnalyticsVouchers = useMemo(() => {
    if (selectedStatus === 'Voided' || selectedStatus === 'Pending_Approval') {
      return filteredVouchers;
    }
    return filteredVouchers.filter(
      (v) =>
        v.status !== 'Voided' &&
        v.status !== 'Pending_Approval' &&
        v.payment_type !== 'Advance_Settlement'
    );
  }, [filteredVouchers, selectedStatus]);

  // Telemetry Aggregates
  const telemetry = useMemo(() => {
    const count = validAnalyticsVouchers.length;
    const totalAmount = validAnalyticsVouchers.reduce(
      (sum, v) => sum + (Number(v.total_amount) || 0),
      0
    );

    let min = count > 0 ? Infinity : 0;
    let max = 0;
    let cashSum = 0;
    let upiSum = 0;

    validAnalyticsVouchers.forEach((v) => {
      const amt = Number(v.total_amount) || 0;
      if (amt < min) min = amt;
      if (amt > max) max = amt;
      if (v.payment_method === 'Physical_Cash') cashSum += amt;
      else upiSum += amt;
    });

    if (min === Infinity) min = 0;

    const cashPercent = totalAmount > 0 ? Math.round((cashSum / totalAmount) * 100) : 0;
    const upiPercent = totalAmount > 0 ? Math.round((upiSum / totalAmount) * 100) : 0;

    return {
      count,
      totalAmount,
      min,
      max,
      cashSum,
      upiSum,
      cashPercent,
      upiPercent,
    };
  }, [validAnalyticsVouchers]);

  // Grouped Analytics Breakdowns
  const categoryAnalytics = useMemo(() => {
    const map = new Map<string, { count: number; total: number; cashSum: number; upiSum: number }>();
    validAnalyticsVouchers.forEach((v) => {
      const cat = v.category_name || 'Uncategorized';
      const amt = Number(v.total_amount) || 0;
      const isCash = v.payment_method === 'Physical_Cash';
      const prev = map.get(cat) || { count: 0, total: 0, cashSum: 0, upiSum: 0 };
      map.set(cat, {
        count: prev.count + 1,
        total: prev.total + amt,
        cashSum: prev.cashSum + (isCash ? amt : 0),
        upiSum: prev.upiSum + (!isCash ? amt : 0),
      });
    });
    return Array.from(map.entries())
      .map(([name, data]) => ({
        name,
        count: data.count,
        total: Math.round(data.total * 100) / 100,
        cashSum: Math.round(data.cashSum * 100) / 100,
        upiSum: Math.round(data.upiSum * 100) / 100,
        avgBill: data.count > 0 ? Math.round(data.total / data.count) : 0,
        percentage: telemetry.totalAmount > 0 ? (data.total / telemetry.totalAmount) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [validAnalyticsVouchers, telemetry.totalAmount]);

  const departmentAnalytics = useMemo(() => {
    const map = new Map<string, { count: number; total: number; cashSum: number; upiSum: number }>();
    validAnalyticsVouchers.forEach((v) => {
      const isCash = v.payment_method === 'Physical_Cash';

      // 1. Unpack Vendor Splits if available
      if (Array.isArray(v.vendor_splits) && v.vendor_splits.length > 0) {
        v.vendor_splits.forEach((vs: any) => {
          const dept = vs.department_name || vs.departmentName || 'General Operations';
          const amt = Number(vs.amount) || 0;
          const prev = map.get(dept) || { count: 0, total: 0, cashSum: 0, upiSum: 0 };
          map.set(dept, {
            count: prev.count + 1,
            total: prev.total + amt,
            cashSum: prev.cashSum + (isCash ? amt : 0),
            upiSum: prev.upiSum + (!isCash ? amt : 0),
          });
        });
        return;
      }

      // 2. Unpack Comma-separated multi-department strings (from splits)
      if (v.department_name && v.department_name.includes(',')) {
        const depts = v.department_name.split(',').map((d) => d.trim()).filter(Boolean);
        if (depts.length > 0) {
          const splitAmt = (Number(v.total_amount) || 0) / depts.length;
          depts.forEach((dept) => {
            const prev = map.get(dept) || { count: 0, total: 0, cashSum: 0, upiSum: 0 };
            map.set(dept, {
              count: prev.count + 1,
              total: prev.total + splitAmt,
              cashSum: prev.cashSum + (isCash ? splitAmt : 0),
              upiSum: prev.upiSum + (!isCash ? splitAmt : 0),
            });
          });
          return;
        }
      }

      // 3. Standard single department voucher
      const dept = v.department_name || 'General Operations';
      const amt = Number(v.total_amount) || 0;
      const prev = map.get(dept) || { count: 0, total: 0, cashSum: 0, upiSum: 0 };
      map.set(dept, {
        count: prev.count + 1,
        total: prev.total + amt,
        cashSum: prev.cashSum + (isCash ? amt : 0),
        upiSum: prev.upiSum + (!isCash ? amt : 0),
      });
    });
    return Array.from(map.entries())
      .map(([name, data]) => ({
        name,
        count: data.count,
        total: Math.round(data.total * 100) / 100,
        cashSum: Math.round(data.cashSum * 100) / 100,
        upiSum: Math.round(data.upiSum * 100) / 100,
        avgBill: data.count > 0 ? Math.round(data.total / data.count) : 0,
        percentage: telemetry.totalAmount > 0 ? (data.total / telemetry.totalAmount) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [validAnalyticsVouchers, telemetry.totalAmount]);

  const payeeAnalytics = useMemo(() => {
    const map = new Map<string, { count: number; total: number; cashSum: number; upiSum: number; category: string }>();
    validAnalyticsVouchers.forEach((v) => {
      const name = v.recipient_name || 'Cash Disbursal';
      const amt = Number(v.total_amount) || 0;
      const isCash = v.payment_method === 'Physical_Cash';
      const prev = map.get(name) || { count: 0, total: 0, cashSum: 0, upiSum: 0, category: v.category_name || 'General' };
      map.set(name, {
        count: prev.count + 1,
        total: prev.total + amt,
        cashSum: prev.cashSum + (isCash ? amt : 0),
        upiSum: prev.upiSum + (!isCash ? amt : 0),
        category: prev.category,
      });
    });
    return Array.from(map.entries())
      .map(([name, data]) => ({
        name,
        category: data.category,
        count: data.count,
        total: Math.round(data.total * 100) / 100,
        cashSum: Math.round(data.cashSum * 100) / 100,
        upiSum: Math.round(data.upiSum * 100) / 100,
        avgBill: data.count > 0 ? Math.round(data.total / data.count) : 0,
        percentage: telemetry.totalAmount > 0 ? (data.total / telemetry.totalAmount) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 50);
  }, [validAnalyticsVouchers, telemetry.totalAmount]);

  // Paginated records
  const totalPages = Math.max(1, Math.ceil(filteredVouchers.length / pageSize));
  const paginatedVouchers = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize;
    return filteredVouchers.slice(startIdx, startIdx + pageSize);
  }, [filteredVouchers, currentPage, pageSize]);

  // Grouped records by date for WhatsApp-style chat ledger stream
  const groupedMobileVouchers = useMemo(() => {
    const groups: Array<{ label: string; items: ExpenseVoucher[] }> = [];
    const map: Record<string, ExpenseVoucher[]> = {};
    const now = new Date();
    const todayStr = formatDate(now, 'yyyy-MM-dd');
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayStr = formatDate(yesterday, 'yyyy-MM-dd');

    paginatedVouchers.forEach((v) => {
      const rawDate = normalizeDateToYMD(v.payment_date || v.created_at);
      let label = rawDate ? formatDate(rawDate, 'dd MMMM yyyy') : 'Recent';
      if (rawDate === todayStr) label = 'TODAY';
      else if (rawDate === yesterdayStr) label = 'YESTERDAY';

      if (!map[label]) {
        map[label] = [];
        groups.push({ label, items: map[label] });
      }
      map[label].push(v);
    });
    return groups;
  }, [paginatedVouchers]);

  // Selection handlers
  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleSelectAllCurrentPage = () => {
    const pageIds = paginatedVouchers.map((v) => v.id);
    const allSelected = pageIds.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) {
      pageIds.forEach((id) => next.delete(id));
    } else {
      pageIds.forEach((id) => next.add(id));
    }
    setSelectedIds(next);
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If typing inside an input/select/textarea, ignore global single keys unless ESC
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isInputActive =
        activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

      if (e.key === '/' && !isInputActive) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (e.key === 'Escape') {
        if (isFilterOpen) setIsFilterOpen(false);
        if (isColumnPickerOpen) setIsColumnPickerOpen(false);
        if (activeRowDropdownId) setActiveRowDropdownId(null);
        if (search) setSearch('');
        return;
      }

      if (isInputActive) return;

      if (activeSubTab === 'grid' && paginatedVouchers.length > 0) {
        if (e.key === 'j' || e.key === 'ArrowDown') {
          e.preventDefault();
          setFocusedIndex((prev) => (prev + 1 >= paginatedVouchers.length ? 0 : prev + 1));
        } else if (e.key === 'k' || e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusedIndex((prev) => (prev - 1 < 0 ? paginatedVouchers.length - 1 : prev - 1));
        } else if (e.key === ' ' && focusedIndex >= 0) {
          e.preventDefault();
          const targetVoucher = paginatedVouchers[focusedIndex];
          if (targetVoucher) handleToggleSelect(targetVoucher.id);
        } else if (e.key === 'Enter' && focusedIndex >= 0) {
          e.preventDefault();
          const targetVoucher = paginatedVouchers[focusedIndex];
          if (targetVoucher) openDrawer(targetVoucher);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isFilterOpen,
    isColumnPickerOpen,
    activeRowDropdownId,
    search,
    activeSubTab,
    paginatedVouchers,
    focusedIndex,
    openDrawer,
  ]);

  const activeFilterCount =
    (selectedCategory !== 'ALL' ? 1 : 0) +
    (selectedDept !== 'ALL' ? 1 : 0) +
    (selectedMode !== 'ALL' ? 1 : 0) +
    (selectedStatus !== 'ALL' ? 1 : 0) +
    (minAmount !== '' ? 1 : 0) +
    (maxAmount !== '' ? 1 : 0) +
    (activeView !== 'all' ? 1 : 0) +
    (effectiveStartDate || effectiveEndDate ? 1 : 0);

  const handleResetAllFilters = () => {
    triggerHaptic('light');
    setSelectedCategory('ALL');
    setSelectedDept('ALL');
    if (onClearDepartmentFilter) onClearDepartmentFilter();
    if (onClearCategoryFilter) onClearCategoryFilter();
    setSelectedMode('ALL');
    setSelectedStatus('ALL');
    setMinAmount('');
    setMaxAmount('');
    setActiveView('all');
    setSearch('');
    setInternalStartDate('');
    setInternalEndDate('');
    if (onDateRangeChange) {
      onDateRangeChange({ startDate: '', endDate: '' });
    }
  };

  const handleExportCSV = () => {
    triggerHaptic('success');
    const headers = ['Voucher No', 'Date', 'Payee', 'Category', 'Department', 'Payment Mode', 'Gross Amount (INR)', 'Status', 'Remarks'];
    const rows = filteredVouchers.map((v) => [
      v.voucher_number,
      v.payment_date || (v.created_at ? v.created_at.slice(0, 10) : ''),
      `"${(v.recipient_name || '').replace(/"/g, '""')}"`,
      `"${(v.category_name || '').replace(/"/g, '""')}"`,
      `"${(v.department_name || '').replace(/"/g, '""')}"`,
      v.payment_method === 'Physical_Cash' ? 'Cash' : 'UPI',
      v.total_amount,
      v.status || 'Approved',
      `"${(v.remarks || '').replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Asopalav_Expenses_${effectiveStartDate || 'All'}_to_${effectiveEndDate || 'Present'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast({ type: 'success', title: 'Export Generated', message: `Exported ${filteredVouchers.length} vouchers to CSV.` });
  };

  const handleExportSelectedCSV = () => {
    triggerHaptic('success');
    const selectedList = vouchers.filter((v) => selectedIds.has(v.id));
    const headers = ['Voucher No', 'Date', 'Payee', 'Category', 'Department', 'Payment Mode', 'Gross Amount (INR)', 'Status', 'Remarks'];
    const rows = selectedList.map((v) => [
      v.voucher_number,
      v.payment_date || (v.created_at ? v.created_at.slice(0, 10) : ''),
      `"${(v.recipient_name || '').replace(/"/g, '""')}"`,
      `"${(v.category_name || '').replace(/"/g, '""')}"`,
      `"${(v.department_name || '').replace(/"/g, '""')}"`,
      v.payment_method === 'Physical_Cash' ? 'Cash' : 'UPI',
      v.total_amount,
      v.status || 'Approved',
      `"${(v.remarks || '').replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Asopalav_Selected_${selectedIds.size}_Vouchers.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast({ type: 'success', title: 'Batch Exported', message: `Exported ${selectedIds.size} selected vouchers.` });
  };

  const isAllCurrentPageSelected =
    paginatedVouchers.length > 0 && paginatedVouchers.every((v) => selectedIds.has(v.id));

  const toggleColumn = (key: ColumnKey) => {
    const next = new Set(visibleColumns);
    if (next.has(key)) {
      if (next.size > 1) next.delete(key);
    } else {
      next.add(key);
    }
    setVisibleColumns(next);
  };

  // Density styling tokens
  const densityStyles = {
    compact: {
      header: 'py-2 px-2.5 text-[10px]',
      cell: 'py-1.5 px-2.5 text-xs',
      avatar: 'w-5 h-5',
    },
    normal: {
      header: 'py-3 px-3.5 text-[11px]',
      cell: 'py-2.5 px-3.5 text-xs',
      avatar: 'w-6 h-6',
    },
    relaxed: {
      header: 'py-3.5 px-4 text-xs',
      cell: 'py-3.5 px-4 text-sm',
      avatar: 'w-7 h-7',
    },
  }[tableDensity];

  return (
    <div
      ref={tableContainerRef}
      className="w-full space-y-3 font-sans select-none outline-none"
      tabIndex={0}
    >
      {/* ========================================================================= */}
      {/* 1. REAL-TIME TELEMETRY & LIVE FINANCIAL ANALYTICS BAR                     */}
      {/* ========================================================================= */}
      {!hideTelemetry && showTelemetryBar && (
        <div className="hidden lg:block rounded-[14px] bg-white/90 dark:bg-[#18181a]/90 border border-slate-200/80 dark:border-white/10 p-3.5 shadow-xs space-y-2.5 ios-card">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-200/70 dark:border-white/10">
            {/* Metrics Ribbon */}
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 dark:text-[#8e8e93]">Total:</span>
                <span className="font-bold text-emerald-600 dark:text-primary text-sm tabular-nums">
                  {formatINR(telemetry.totalAmount)}
                </span>
              </div>
              <span className="text-slate-300 dark:text-white/15">|</span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 dark:text-[#8e8e93]">Highest:</span>
                <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                  {formatINR(telemetry.max)}
                </span>
              </div>
              <span className="text-slate-300 dark:text-white/15">|</span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 dark:text-[#8e8e93]">Range:</span>
                <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                  {formatINR(telemetry.min)} - {formatINR(telemetry.max)}
                </span>
              </div>
              <span className="text-slate-300 dark:text-white/15">|</span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 dark:text-[#8e8e93]">Bills:</span>
                <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                  {telemetry.count}
                </span>
              </div>
            </div>

          </div>

          {/* Minimalist Cash vs UPI Split Ratio Bar */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-zinc-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3ecf8e] shrink-0" />
                <span>Cash:</span>
                <span className="text-slate-900 dark:text-zinc-200 font-semibold">{telemetry.cashPercent}%</span>
                <span className="text-slate-400 dark:text-[#707070] font-normal">({formatINR(telemetry.cashSum)})</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-zinc-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-[#555555] shrink-0" />
                <span>UPI / Online:</span>
                <span className="text-slate-900 dark:text-zinc-200 font-semibold">{telemetry.upiPercent}%</span>
                <span className="text-slate-400 dark:text-[#707070] font-normal">({formatINR(telemetry.upiSum)})</span>
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden bg-slate-100 dark:bg-[#202020] flex border border-slate-200/60 dark:border-[#282828]">
              <div
                className="bg-[#3ecf8e] transition-all duration-300 rounded-l-full"
                style={{ width: `${telemetry.cashPercent}%` }}
                title={`Cash: ${telemetry.cashPercent}% (${formatINR(telemetry.cashSum)})`}
              />
              <div
                className="bg-slate-300 dark:bg-[#444444] transition-all duration-300 rounded-r-full"
                style={{ width: `${telemetry.upiPercent}%` }}
                title={`UPI: ${telemetry.upiPercent}% (${formatINR(telemetry.upiSum)})`}
              />
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2.5 VIEW MODE TABS (Apple / Google Pro Data Table Hierarchy)               */}
      {/* ========================================================================= */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-slate-200 dark:border-[#282828]">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              triggerHaptic('selection');
              setActiveSubTab('grid');
            }}
            className={cn(
              'px-3 py-1.5 rounded-[6px] text-xs font-medium font-sans flex items-center gap-1.5 transition-colors cursor-pointer',
              activeSubTab === 'grid'
                ? 'bg-[#3ecf8e]/15 text-[#171717] dark:text-[#3ecf8e] font-semibold border border-[#3ecf8e]/30'
                : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-[#202020] hover:text-slate-900 dark:hover:text-white'
            )}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Data Grid</span>
            <span className="font-mono tabular-nums text-[10px] opacity-75">({filteredVouchers.length})</span>
          </button>

          {isAdminOrDev && (
            <>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  setActiveSubTab('analytics_dept');
                }}
                className={cn(
                  'px-3 py-1.5 rounded-[6px] text-xs font-medium font-sans flex items-center gap-1.5 transition-colors cursor-pointer',
                  activeSubTab === 'analytics_category' || activeSubTab === 'analytics_dept' || activeSubTab === 'analytics_payee'
                    ? 'bg-[#3ecf8e]/15 text-[#171717] dark:text-[#3ecf8e] font-semibold border border-[#3ecf8e]/30'
                    : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-[#202020] hover:text-slate-900 dark:hover:text-white'
                )}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Department &amp; Category Reports</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  setActiveSubTab('report');
                }}
                className={cn(
                  'px-3 py-1.5 rounded-[6px] text-xs font-medium font-sans flex items-center gap-1.5 transition-colors cursor-pointer',
                  activeSubTab === 'report'
                    ? 'bg-[#3ecf8e]/15 text-[#171717] dark:text-[#3ecf8e] font-semibold border border-[#3ecf8e]/30'
                    : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-[#202020] hover:text-slate-900 dark:hover:text-white'
                )}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Audit Report</span>
              </button>
            </>
          )}
        </div>

        {/* Pro Quick Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCSV}
            className="px-2.5 py-1 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] hover:bg-slate-50 dark:hover:bg-[#202020] text-xs font-medium font-sans text-slate-700 dark:text-zinc-300 flex items-center gap-1.5 cursor-pointer shadow-2xs"
            title="Export filtered records to CSV"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export CSV</span>
          </button>

          {showActionBanner && (
            <button
              type="button"
              onClick={() => setActivePage('new-voucher')}
              className="px-3 py-1 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] text-xs font-semibold flex items-center gap-1.5 cursor-pointer font-sans shadow-xs"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Record Expense</span>
            </button>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. ENTERPRISE ADVANCED TOOLBAR (Controls, Filters, Pro Dev Tools)           */}
      {/* ========================================================================= */}
      <div className="relative z-30 flex flex-col md:flex-row md:items-center justify-between gap-2.5 p-2.5 rounded-[12px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#282828] shadow-xs">
        {/* Left: Quick View Presets Chips & Part-Load Rows (10 to 100) */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0">
            {[
              { id: 'all', label: 'All' },
              { id: 'cash', label: 'Cash Only' },
              { id: 'upi', label: 'UPI Only' },
            ].map((preset) => {
              const isSel = activeView === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    triggerHaptic('selection');
                    setActiveView(preset.id as ViewPreset);
                  }}
                  className={cn(
                    'px-2.5 py-1 rounded-[6px] text-xs font-medium font-sans whitespace-nowrap transition-colors cursor-pointer',
                    isSel
                      ? 'bg-[#3ecf8e]/15 text-[#171717] dark:text-[#3ecf8e] font-semibold border border-[#3ecf8e]/30'
                      : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-[#202020] hover:text-slate-900 dark:hover:text-white'
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          {/* Part-Load Rows Select Dropdown (Image 1 ergonomics: 10, 15, 25, 50, 100) */}
          <div className="flex items-center gap-1.5 font-mono text-xs text-slate-600 dark:text-[#888]">
            <span className="text-[11px] font-sans">Rows:</span>
            <div className="relative inline-flex items-center">
              <select
                value={pageSize}
                onChange={(e) => {
                  triggerHaptic('light');
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="appearance-none h-7 pl-2.5 pr-6 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#18181a] text-slate-900 dark:text-white font-mono text-xs cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#3ecf8e] shadow-2xs"
                title="Select rows per page"
              >
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 dark:text-[#888] absolute right-1.5 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Right: DateRangePicker, Search, Multi-Filter, Column Picker, Density */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Integrated DateRangePicker */}
          <DateRangePicker
            startDate={effectiveStartDate}
            endDate={effectiveEndDate}
            onChange={handleDateRangeChange}
            size="sm"
          />

          {/* Search Box */}
          <div className="relative flex-1 sm:w-48 min-w-[140px]">
            <Search className="w-3.5 h-3.5 text-slate-400 dark:text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              aria-label="Search expense vouchers"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search bills (/)..."
              className="bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[6px] pl-8 pr-6 h-8 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-[#707070] focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 w-full transition-all font-sans shadow-2xs"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Advanced Multi-Filter Button */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsFilterOpen((prev) => !prev)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 h-8 rounded-[6px] text-xs font-medium font-sans border transition-all cursor-pointer shadow-2xs',
                isFilterOpen || activeFilterCount > 0
                  ? 'bg-[#3ecf8e]/15 text-emerald-800 dark:text-[#3ecf8e] border-[#3ecf8e]/40 font-semibold'
                  : 'bg-white dark:bg-[#181818] hover:bg-slate-50 dark:hover:bg-[#202020] text-slate-900 dark:text-zinc-200 border-slate-200 dark:border-[#282828]'
              )}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-[#3ecf8e] text-[#171717] text-[10px] font-mono flex items-center justify-center font-bold">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {/* Density Switcher */}
          <div className="hidden sm:flex items-center rounded-[6px] border border-slate-200 dark:border-[#282828] p-0.5 bg-white dark:bg-[#181818]">
            <button
              type="button"
              onClick={() => setTableDensity('compact')}
              className={cn(
                'px-2 py-0.5 text-[11px] rounded-[4px] font-medium font-sans transition-colors cursor-pointer',
                tableDensity === 'compact' ? 'bg-[#3ecf8e] text-[#171717]' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
              )}
              title="Compact Density"
            >
              Compact
            </button>
            <button
              type="button"
              onClick={() => setTableDensity('normal')}
              className={cn(
                'px-2 py-0.5 text-[11px] rounded-[4px] font-medium font-sans transition-colors cursor-pointer',
                tableDensity === 'normal' ? 'bg-[#3ecf8e] text-[#171717]' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
              )}
              title="Normal Density"
            >
              Normal
            </button>
          </div>

          {/* Column Picker Popover */}
          <div className="hidden sm:block relative" ref={columnPickerRef}>
            <button
              type="button"
              onClick={handleToggleColumnPicker}
              title="Manage Columns"
              className="flex items-center gap-1.5 px-2.5 h-8 rounded-[6px] bg-white dark:bg-[#181818] hover:bg-slate-50 dark:hover:bg-[#202020] text-xs font-medium font-sans text-slate-900 dark:text-white border border-slate-200 dark:border-[#282828] cursor-pointer shadow-2xs"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" />
              <span>Cols</span>
            </button>

            {isColumnPickerOpen && (
              <div className="absolute right-0 mt-1.5 w-56 rounded-[6px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] shadow-2xl p-2.5 z-50 space-y-2 text-xs font-sans animate-in fade-in zoom-in-95 duration-100">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-200 dark:border-[#282828]">
                  <span className="font-medium text-slate-900 dark:text-white">Visible Columns</span>
                  <span className="text-[10px] font-mono text-slate-400 dark:text-zinc-400">
                    {visibleColumns.size}/{ALL_COLUMNS.length}
                  </span>
                </div>
                <div className="space-y-0.5 max-h-60 overflow-y-auto">
                  {ALL_COLUMNS.map((col) => {
                    const isChecked = visibleColumns.has(col.key);
                    return (
                      <label
                        key={col.key}
                        className="flex items-center gap-2 p-1.5 rounded-[4px] hover:bg-slate-100 dark:hover:bg-[#222222] cursor-pointer text-slate-900 dark:text-zinc-200 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleColumn(col.key)}
                          className="rounded-[4px] text-[#3ecf8e] focus:ring-0 cursor-pointer accent-[#3ecf8e]"
                        />
                        <span>{col.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3.1 DESKTOP INLINE COLLAPSIBLE FILTER RIBBON (lg:+)                       */}
      {/* ========================================================================= */}
      {isFilterOpen && (
        <div className="hidden lg:block p-4 rounded-[12px] bg-slate-50/80 dark:bg-[#181818] border border-slate-200 dark:border-[#2a2a2a] shadow-xs space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-[#242424]">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-emerald-600 dark:text-primary" />
              <span className="text-xs font-semibold text-slate-900 dark:text-white font-sans">
                Filter Bills
              </span>
              {activeFilterCount > 0 && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-[4px] bg-primary/15 text-emerald-700 dark:text-primary font-bold">
                  {activeFilterCount} active
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory('ALL');
                    setSelectedDept('ALL');
                    setSelectedMode('ALL');
                    setSelectedStatus('ALL');
                    setMinAmount('');
                    setMaxAmount('');
                    setActiveView('all');
                  }}
                  className="text-xs font-mono text-rose-500 hover:text-rose-600 dark:hover:text-rose-400 hover:underline cursor-pointer flex items-center gap-1 px-2 py-1 rounded-[4px] hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset All</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsFilterOpen(false)}
                className="p-1 rounded-[4px] text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#282828] transition-colors cursor-pointer"
                title="Close filter ribbon"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-3">
            {/* Amount Range */}
            <div className="space-y-1">
              <label className="text-[11px] font-mono text-slate-500 dark:text-gray-400 block font-medium">
                Amount Range (₹)
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="number"
                  placeholder="Min ₹"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  className="w-full h-10 min-h-[40px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[6px] px-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 font-mono shadow-2xs"
                />
                <input
                  type="number"
                  placeholder="Max ₹"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  className="w-full h-10 min-h-[40px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[6px] px-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 font-mono shadow-2xs"
                />
              </div>
            </div>

            {/* Category */}
            <div className="space-y-1">
              <label className="text-[11px] font-mono text-slate-500 dark:text-gray-400 block font-medium">
                Category
              </label>
              <SearchableSelect
                size="sm"
                options={categorySelectOptions}
                value={selectedCategory}
                onChange={setSelectedCategory}
                placeholder="All Categories"
                searchPlaceholder="Search category..."
                allowCustom={false}
              />
            </div>

            {/* Department */}
            <div className="space-y-1">
              <label className="text-[11px] font-mono text-slate-500 dark:text-gray-400 block font-medium">
                Department
              </label>
              <SearchableSelect
                size="sm"
                options={departmentSelectOptions}
                value={selectedDept}
                onChange={setSelectedDept}
                placeholder="All Departments"
                searchPlaceholder="Search department..."
                allowCustom={false}
              />
            </div>

            {/* Payment Mode */}
            <div className="space-y-1">
              <label className="text-[11px] font-mono text-slate-500 dark:text-gray-400 block font-medium">
                Payment Mode
              </label>
              <SearchableSelect
                size="sm"
                options={paymentModeSelectOptions}
                value={selectedMode}
                onChange={setSelectedMode}
                placeholder="All Payment Modes"
                searchPlaceholder="Search payment mode..."
                allowCustom={false}
              />
            </div>

            {/* Approval Status */}
            <div className="space-y-1">
              <label className="text-[11px] font-mono text-slate-500 dark:text-gray-400 block font-medium">
                Approval Status
              </label>
              <SearchableSelect
                size="sm"
                options={statusSelectOptions}
                value={selectedStatus}
                onChange={setSelectedStatus}
                placeholder="All Statuses"
                searchPlaceholder="Search status..."
                allowCustom={false}
              />
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3.2 MOBILE FIXED BOTTOM SHEET MODAL (< lg)                                */}
      {/* ========================================================================= */}
      {isFilterOpen && (
        <div className="lg:hidden">
          <div
            onClick={() => setIsFilterOpen(false)}
            className="fixed inset-0 bg-black/75 z-50 transition-opacity animate-in fade-in duration-200"
          />

          <div
            onClick={(e) => e.stopPropagation()}
            className="fixed inset-x-0 bottom-0 max-h-[88vh] rounded-t-[28px] bg-white dark:bg-[#181818] border-t border-slate-200/90 dark:border-[#2e2e2e] shadow-2xl z-50 font-sans p-5 sm:p-6 pb-8 overflow-y-auto overscroll-contain space-y-5 animate-in slide-in-from-bottom duration-250"
          >
            {/* Android M3 Top Drag Handle */}
            <div className="w-12 h-1.5 rounded-full bg-slate-300 dark:bg-zinc-700 mx-auto -mt-1 mb-2" />

            {/* Header with Title & Reset */}
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 dark:border-[#282828]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-[#3ecf8e] flex items-center justify-center">
                  <SlidersHorizontal className="w-4 h-4 stroke-[2.2]" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white font-sans tracking-tight">
                    Advanced Filters
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                    Filter by amount range, category, department & status
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('light');
                      setSelectedCategory('ALL');
                      setSelectedDept('ALL');
                      setSelectedMode('ALL');
                      setSelectedStatus('ALL');
                      setMinAmount('');
                      setMaxAmount('');
                      setActiveView('all');
                    }}
                    className="text-xs font-sans font-medium text-rose-500 hover:text-rose-600 dark:hover:text-rose-400 hover:underline cursor-pointer flex items-center gap-1 px-2.5 py-1 rounded-[6px] bg-rose-50/60 dark:bg-rose-950/20 active:scale-95 transition-all"
                  >
                    <RotateCcw className="w-3 h-3 stroke-[2.2]" />
                    <span>Reset</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsFilterOpen(false)}
                  className="w-8 h-8 rounded-full bg-slate-100 dark:bg-[#242424] hover:bg-slate-200 dark:hover:bg-[#2c2c2c] text-slate-600 dark:text-zinc-300 flex items-center justify-center cursor-pointer transition-colors active:scale-90"
                  aria-label="Close filters"
                >
                  <X className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>
            </div>

            {/* Field 1: Amount Range with Numeric Keypad Support */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-zinc-300 font-sans flex items-center gap-1.5">
                <span className="font-mono text-emerald-600 dark:text-[#3ecf8e] text-sm">₹</span>
                <span>Amount Range (INR)</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500 font-mono text-xs font-medium pointer-events-none">
                    Min ₹
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={minAmount}
                    onChange={(e) => setMinAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    className="w-full bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[6px] pl-14 pr-3.5 h-10 min-h-[40px] text-xs font-mono font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 transition-all shadow-2xs"
                  />
                </div>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500 font-mono text-xs font-medium pointer-events-none">
                    Max ₹
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="50,000"
                    value={maxAmount}
                    onChange={(e) => setMaxAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    className="w-full bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[6px] pl-14 pr-3.5 h-10 min-h-[40px] text-xs font-mono font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 transition-all shadow-2xs"
                  />
                </div>
              </div>
            </div>

            {/* Field 2: Expense Category */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-zinc-300 font-sans flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-slate-400" />
                <span>Expense Category</span>
              </label>
              <SearchableSelect
                size="lg"
                options={categorySelectOptions}
                value={selectedCategory}
                onChange={setSelectedCategory}
                placeholder="All Categories"
                searchPlaceholder="Search category..."
                allowCustom={false}
              />
            </div>

            {/* Field 3: Department */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-zinc-300 font-sans flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                <span>Department</span>
              </label>
              <SearchableSelect
                size="lg"
                options={departmentSelectOptions}
                value={selectedDept}
                onChange={setSelectedDept}
                placeholder="All Departments"
                searchPlaceholder="Search department..."
                allowCustom={false}
              />
            </div>

            {/* Field 4: Payment Mode (Android Material 3 Quick-Tap Chips) */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-zinc-300 font-sans flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-slate-400" />
                <span>Payment Mode</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'ALL', label: 'All Modes' },
                  { id: 'Physical_Cash', label: 'Cash' },
                  { id: 'Online_UPI', label: 'Online UPI' },
                ].map((m) => {
                  const isSel = selectedMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        triggerHaptic('selection');
                        setSelectedMode(m.id);
                      }}
                      className={cn(
                        'min-h-[46px] px-3 py-2 rounded-[10px] text-xs font-medium font-sans border transition-all cursor-pointer flex items-center justify-center text-center select-none active:scale-95',
                        isSel
                          ? 'bg-emerald-500/15 border-emerald-500 text-emerald-800 dark:text-[#3ecf8e] font-semibold ring-1 ring-emerald-500/40 shadow-xs'
                          : 'bg-slate-50 dark:bg-[#202020] border-slate-200 dark:border-[#333] text-slate-600 dark:text-zinc-400 hover:border-slate-300 dark:hover:border-[#444]'
                      )}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Field 5: Approval Status (Android Material 3 Quick-Tap Chips) */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-zinc-300 font-sans flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />
                <span>Approval Status</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'ALL', label: 'All' },
                  { id: 'Approved', label: 'Approved' },
                ].map((st) => {
                  const isSel = selectedStatus === st.id;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => {
                        triggerHaptic('selection');
                        setSelectedStatus(st.id);
                      }}
                      className={cn(
                        'min-h-[46px] px-3 py-2 rounded-[10px] text-xs font-medium font-sans border transition-all cursor-pointer flex items-center justify-center text-center select-none active:scale-95',
                        isSel
                          ? 'bg-emerald-500/15 border-emerald-500 text-emerald-800 dark:text-[#3ecf8e] font-semibold ring-1 ring-emerald-500/40 shadow-xs'
                          : 'bg-slate-50 dark:bg-[#202020] border-slate-200 dark:border-[#333] text-slate-600 dark:text-zinc-400 hover:border-slate-300 dark:hover:border-[#444]'
                      )}
                    >
                      {st.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sticky Apply Filters CTA */}
            <div className="pt-3 border-t border-slate-100 dark:border-[#282828] sticky bottom-0 bg-white dark:bg-[#181818] -mx-5 px-5 -mb-2 pb-2">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('medium');
                  setIsFilterOpen(false);
                }}
                className="w-full py-3.5 min-h-[52px] rounded-[14px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#141414] font-semibold text-sm cursor-pointer shadow-lg shadow-emerald-950/15 dark:shadow-[#3ecf8e]/15 transition-all flex items-center justify-center gap-2 font-sans active:scale-[0.98] select-none"
              >
                <span>Apply Filters ({filteredVouchers.length} matches)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3.2 ACTIVE FILTER CHIPS RIBBON (Instant 1-Click Clear & Visibility)        */}
      {/* ========================================================================= */}
      {(activeFilterCount > 0 || search.trim() !== '') && (
        <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-[8px] bg-slate-50 dark:bg-[#181818] border border-slate-200 dark:border-[#242424] text-xs animate-in fade-in duration-100">
          <span className="text-[11px] font-medium text-slate-500 dark:text-zinc-400 font-sans mr-1">Active:</span>

          {search.trim() && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[#3ecf8e]/10 text-emerald-800 dark:text-[#3ecf8e] border border-[#3ecf8e]/20 font-mono text-[11px]">
              Search: "{search}"
              <button type="button" onClick={() => setSearch('')} className="hover:text-rose-500 cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {activeView !== 'all' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[#3ecf8e]/10 text-emerald-800 dark:text-[#3ecf8e] border border-[#3ecf8e]/20 font-sans text-[11px]">
              Preset: {activeView.toUpperCase()}
              <button type="button" onClick={() => setActiveView('all')} className="hover:text-rose-500 cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {selectedCategory !== 'ALL' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[#3ecf8e]/10 text-emerald-800 dark:text-[#3ecf8e] border border-[#3ecf8e]/20 font-sans text-[11px]">
              Cat: {selectedCategory}
              <button type="button" onClick={() => setSelectedCategory('ALL')} className="hover:text-rose-500 cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {selectedDept !== 'ALL' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[#3ecf8e]/10 text-emerald-800 dark:text-[#3ecf8e] border border-[#3ecf8e]/20 font-sans text-[11px]">
              Dept: {selectedDept}
              <button type="button" onClick={() => setSelectedDept('ALL')} className="hover:text-rose-500 cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {selectedMode !== 'ALL' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[#3ecf8e]/10 text-emerald-800 dark:text-[#3ecf8e] border border-[#3ecf8e]/20 font-sans text-[11px]">
              Mode: {selectedMode === 'Physical_Cash' ? 'Cash' : 'UPI'}
              <button type="button" onClick={() => setSelectedMode('ALL')} className="hover:text-rose-500 cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {selectedStatus !== 'ALL' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[#3ecf8e]/10 text-emerald-800 dark:text-[#3ecf8e] border border-[#3ecf8e]/20 font-sans text-[11px]">
              Status: {selectedStatus}
              <button type="button" onClick={() => setSelectedStatus('ALL')} className="hover:text-rose-500 cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {(minAmount !== '' || maxAmount !== '') && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[#3ecf8e]/10 text-emerald-800 dark:text-[#3ecf8e] border border-[#3ecf8e]/20 font-mono text-[11px]">
              ₹{minAmount || '0'} - ₹{maxAmount || '∞'}
              <button
                type="button"
                onClick={() => {
                  setMinAmount('');
                  setMaxAmount('');
                }}
                className="hover:text-rose-500 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {(effectiveStartDate || effectiveEndDate) && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[#3ecf8e]/10 text-emerald-800 dark:text-[#3ecf8e] border border-[#3ecf8e]/20 font-mono text-[11px]">
              Date: {effectiveStartDate || 'Start'} &rarr; {effectiveEndDate || 'End'}
              <button
                type="button"
                onClick={() => {
                  setInternalStartDate('');
                  setInternalEndDate('');
                  if (onDateRangeChange) onDateRangeChange({ startDate: '', endDate: '' });
                }}
                className="hover:text-rose-500 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          <button
            type="button"
            onClick={handleResetAllFilters}
            className="ml-auto text-[11px] font-sans font-medium text-rose-500 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer hover:underline"
          >
            Clear All
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. FLOATING BATCH SELECTION DOCK (When Rows Selected)                    */}
      {/* ========================================================================= */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between p-3 rounded-[8px] bg-emerald-500/10 dark:bg-emerald-500/15 border border-emerald-500/30 text-slate-900 dark:text-white shadow-md animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2.5 text-xs font-medium font-sans">
            <span className="w-6 h-6 rounded-full bg-[#3ecf8e] text-[#171717] font-mono text-xs flex items-center justify-center font-medium">
              {selectedIds.size}
            </span>
            <span>
              {selectedIds.size} expense{selectedIds.size > 1 ? 's' : ''} selected
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportSelectedCSV}
              className="px-2.5 py-1.5 rounded-[6px] text-xs font-sans bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-medium flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Selected CSV</span>
            </button>
            <button
              type="button"
              onClick={handleClearSelection}
              className="px-2.5 py-1.5 rounded-[6px] text-xs font-sans text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white transition-colors cursor-pointer border border-slate-200 dark:border-[#2e2e2e]"
            >
              Deselect All
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. ACTIVE SUB-VIEW CONTENT (Grid vs Analytics Breakdowns vs Report View)  */}
      {/* ========================================================================= */}
      {activeSubTab === 'grid' && (
        <div className="rounded-[8px] border border-slate-200/80 dark:border-[#242424] bg-white dark:bg-[#161616] overflow-hidden shadow-2xs">
          {/* Mobile Card Feed (< lg when mobileViewMode === 'cards') */}
          {mobileViewMode === 'cards' && (
            <div className="lg:hidden p-2 space-y-3">
              {groupedMobileVouchers.map((group) => (
                <div key={group.label} className="space-y-1.5">
                  {/* Studio Sticky Date Divider Pill */}
                  <div className="flex justify-center my-1.5 sticky top-14 z-10">
                    <span className="px-2.5 py-0.5 rounded-[4px] text-[10px] font-semibold font-mono tracking-wider uppercase bg-slate-100 dark:bg-[#202020] text-slate-600 dark:text-zinc-300 border border-slate-200/80 dark:border-[#2a2a2a] shadow-2xs">
                      {group.label}
                    </span>
                  </div>

                  {/* Group Items */}
                  <div className="space-y-1.5">
                    {group.items.map((v) => {
                      const isSelected = selectedIds.has(v.id);
                      return (
                        <div
                          key={v.id}
                          onClick={() => {
                            triggerHaptic('light');
                            openDrawer(v);
                          }}
                          className={cn(
                            'flex items-center justify-between p-3 rounded-[8px] bg-white dark:bg-[#181818] border border-slate-200/80 dark:border-[#282828] hover:border-emerald-500/40 active:scale-[0.99] transition-all cursor-pointer shadow-2xs gap-3 select-none min-h-[56px]',
                            isSelected && 'ring-1 ring-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/20'
                          )}
                        >
                          {/* Left: Category Avatar */}
                          <VoucherCategoryAvatar category={v.category_name} />

                          {/* Center: Payee Name, Category, Timestamp, Mode */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h4 className="font-semibold text-xs text-slate-900 dark:text-white truncate">
                                {v.recipient_name || '—'}
                              </h4>
                              {getRelativeDateBadge(v.payment_date) && (
                                <span className="px-1.5 py-0.2 rounded-[4px] text-[9px] font-mono font-semibold uppercase bg-slate-100 dark:bg-[#252528] text-slate-600 dark:text-zinc-300 border border-slate-200/80 dark:border-[#333]">
                                  {getRelativeDateBadge(v.payment_date)}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500 dark:text-zinc-400 truncate font-sans">
                              <span>{v.category_name}</span>
                              <span>•</span>
                              <span className="font-mono text-[10px]">{formatDate(v.created_at || v.payment_date, 'HH:mm')}</span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-[4px] bg-slate-100 dark:bg-[#222222] text-slate-600 dark:text-zinc-300 font-mono text-[10px] font-medium border border-slate-200/80 dark:border-[#2a2a2a]">
                                {v.payment_method === 'Physical_Cash' ? 'Cash' : 'UPI'}
                              </span>
                              {v.branch_code && (
                                <span className="px-1.5 py-0.2 rounded-[4px] bg-slate-100 dark:bg-[#222222] text-slate-500 dark:text-zinc-400 font-mono text-[10px] border border-slate-200/80 dark:border-[#2a2a2a]">
                                  {v.branch_code}
                                </span>
                              )}
                              <span className="text-[10px] font-mono text-slate-400 dark:text-zinc-500">
                                #{formatVoucherNumber(v.voucher_number)}
                              </span>
                            </div>
                          </div>

                          {/* Right: Tabular Amount */}
                          <div className="text-right shrink-0 flex flex-col items-end justify-center">
                            <span className="font-mono font-bold text-sm text-slate-900 dark:text-white tabular-nums">
                              -{formatINR(v.total_amount)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {paginatedVouchers.length === 0 && (
                <EmptyState
                  icon={Receipt}
                  title="No expense vouchers found"
                  description="No records match your active search or filters."
                  actionLabel="Record Expense"
                  onAction={() => setActivePage('new-voucher')}
                  className="py-8"
                />
              )}
            </div>
          )}

          {/* Desktop / Full Table View */}
          <div className={cn(mobileViewMode === 'cards' ? 'hidden lg:block' : 'block', 'overflow-x-auto min-h-[320px]')}>
            <table className="w-full text-left border-collapse text-xs">
              {/* Interactive Sortable Header */}
              <thead>
                <tr className="bg-slate-50 dark:bg-[#171717] border-b border-slate-200 dark:border-[#2e2e2e] text-slate-700 dark:text-gray-300 font-sans font-semibold select-none">
                  {/* Selection Checkbox */}
                  <th
                    className={cn(
                      'w-11 border-r border-slate-200 dark:border-[#2e2e2e] text-center',
                      densityStyles.header
                    )}
                  >
                    <button
                      type="button"
                      onClick={handleSelectAllCurrentPage}
                      aria-label="Select all rows on current page"
                      className="cursor-pointer text-slate-400 hover:text-slate-900 dark:hover:text-white inline-flex items-center justify-center"
                    >
                      {isAllCurrentPageSelected ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>

                  {/* Voucher # */}
                  {visibleColumns.has('voucher_number') && (
                    <th
                      onClick={() => handleSort('voucher_number')}
                      className={cn(
                        'border-r border-slate-200 dark:border-[#242424] cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors',
                        densityStyles.header
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-slate-800 dark:text-white font-medium">Bill #</span>
                        {getSortIcon('voucher_number')}
                      </div>
                    </th>
                  )}

                  {/* Date */}
                  {visibleColumns.has('date') && (
                    <th
                      onClick={() => handleSort('date')}
                      className={cn(
                        'border-r border-slate-200 dark:border-[#242424] cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors w-32',
                        densityStyles.header
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-slate-800 dark:text-white font-medium">Date</span>
                        {getSortIcon('date')}
                      </div>
                    </th>
                  )}

                  {/* Recipient / Vendor */}
                  {visibleColumns.has('recipient_name') && (
                    <th
                      onClick={() => handleSort('recipient_name')}
                      className={cn(
                        'border-r border-slate-200 dark:border-[#242424] cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors',
                        densityStyles.header
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-slate-800 dark:text-white font-medium">Paid To</span>
                        {getSortIcon('recipient_name')}
                      </div>
                    </th>
                  )}

                  {/* Category */}
                  {visibleColumns.has('category_name') && (
                    <th
                      onClick={() => handleSort('category')}
                      className={cn(
                        'border-r border-slate-200 dark:border-[#242424] cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors',
                        densityStyles.header
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-slate-800 dark:text-white font-medium">Category</span>
                        {getSortIcon('category')}
                      </div>
                    </th>
                  )}

                  {/* Department */}
                  {visibleColumns.has('department_name') && (
                    <th
                      onClick={() => handleSort('department')}
                      className={cn(
                        'border-r border-slate-200 dark:border-[#242424] cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors',
                        densityStyles.header
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-slate-800 dark:text-white font-medium">Department</span>
                        {getSortIcon('department')}
                      </div>
                    </th>
                  )}

                  {/* Payment Mode */}
                  {visibleColumns.has('payment_method') && (
                    <th
                      onClick={() => handleSort('method')}
                      className={cn(
                        'border-r border-slate-200 dark:border-[#242424] cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors',
                        densityStyles.header
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-slate-800 dark:text-white font-medium">Mode</span>
                        {getSortIcon('method')}
                      </div>
                    </th>
                  )}

                  {/* Amount */}
                  {visibleColumns.has('total_amount') && (
                    <th
                      onClick={() => handleSort('amount')}
                      className={cn(
                        'border-r border-slate-200 dark:border-[#242424] text-right cursor-pointer hover:text-slate-900 dark:hover:text-white transition-colors w-32',
                        densityStyles.header
                      )}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="font-mono text-slate-800 dark:text-white font-medium">Amount (₹)</span>
                        {getSortIcon('amount')}
                      </div>
                    </th>
                  )}

                  {/* Actions */}
                  {visibleColumns.has('actions') && (
                    <th className={cn('text-center w-20 select-none font-mono text-slate-400 dark:text-[#737373]', densityStyles.header)}>
                      <span>Tools</span>
                    </th>
                  )}
                </tr>
              </thead>

              {/* Table Body */}
              <tbody className="divide-y divide-slate-200 dark:divide-[#242424] font-mono">
                {paginatedVouchers.map((v, idx) => {
                  const isSelected = selectedIds.has(v.id);
                  const isFocused = focusedIndex === idx;
                  const isDropdownOpen = activeRowDropdownId === v.id;

                  return (
                    <tr
                      key={v.id}
                      onClick={() => openDrawer(v)}
                      className={cn(
                        'group transition-colors duration-100 cursor-pointer select-none',
                        isSelected
                          ? 'bg-emerald-50 hover:bg-emerald-100/60 dark:bg-primary/10 dark:hover:bg-primary/15'
                          : isFocused
                          ? 'bg-slate-100 dark:bg-[#242424] ring-1 ring-inset ring-primary/40'
                          : 'hover:bg-slate-50 dark:hover:bg-[#202020]'
                      )}
                    >
                      {/* Selection Checkbox */}
                      <td
                        className={cn(
                          'border-r border-slate-200 dark:border-[#242424] text-center',
                          densityStyles.cell
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleSelect(v.id);
                        }}
                      >
                        <button
                          type="button"
                          aria-label={`Select receipt ${formatVoucherNumber(v.voucher_number)}`}
                          className="cursor-pointer text-slate-400 group-hover:text-slate-700 dark:group-hover:text-white inline-flex items-center justify-center"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-emerald-600 dark:text-primary" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 hover:text-slate-700" />
                          )}
                        </button>
                      </td>

                      {/* Voucher Number */}
                      {visibleColumns.has('voucher_number') && (
                        <td
                          className={cn(
                            'border-r border-slate-200 dark:border-[#242424] font-semibold text-emerald-700 dark:text-primary',
                            densityStyles.cell
                          )}
                        >
                          <div className="flex items-center">
                            <span>{formatVoucherNumber(v.voucher_number)}</span>
                          </div>
                        </td>
                      )}

                      {/* Date */}
                      {visibleColumns.has('date') && (
                        <td
                          className={cn(
                            'border-r border-slate-200 dark:border-[#242424] text-slate-700 dark:text-gray-300 tabular-nums font-medium',
                            densityStyles.cell
                          )}
                        >
                          {formatDate(v.payment_date)}
                        </td>
                      )}

                      {/* Recipient / Vendor */}
                      {visibleColumns.has('recipient_name') && (
                        <td
                          className={cn(
                            'border-r border-slate-200 dark:border-[#242424] font-sans font-semibold text-slate-900 dark:text-white',
                            densityStyles.cell
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="truncate max-w-[180px]">{v.recipient_name}</span>
                            {v.bill_photo_urls && v.bill_photo_urls.length > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDrawer(v);
                                }}
                                title="View Attached Bill Photo"
                                aria-label={`View bill photo for ${formatVoucherNumber(v.voucher_number)}`}
                                className="p-1 rounded text-emerald-600 dark:text-primary hover:bg-emerald-50 dark:hover:bg-primary/10 transition-colors ml-1"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}

                      {/* Category */}
                      {visibleColumns.has('category_name') && (
                        <td
                          className={cn(
                            'border-r border-slate-200 dark:border-[#242424] text-slate-700 dark:text-gray-300 font-sans',
                            densityStyles.cell
                          )}
                        >
                          <span className="inline-block px-2 py-0.5 rounded-[4px] badge-status-neutral text-[11px] font-medium font-sans">
                            {v.category_name}
                          </span>
                        </td>
                      )}

                      {/* Department */}
                      {visibleColumns.has('department_name') && (
                        <td
                          className={cn(
                            'border-r border-slate-200 dark:border-[#242424] text-slate-600 dark:text-gray-400 font-sans text-xs',
                            densityStyles.cell
                          )}
                        >
                          {v.department_name || 'General'}
                        </td>
                      )}

                      {/* Payment Mode */}
                      {visibleColumns.has('payment_method') && (
                        <td
                          className={cn(
                            'border-r border-slate-200 dark:border-[#242424] text-xs',
                            densityStyles.cell
                          )}
                        >
                          <div className="flex items-center gap-1.5 font-medium">
                            {v.payment_method === 'Physical_Cash' ? (
                              <>
                                <Coins className="w-3.5 h-3.5 text-amber-600 dark:text-amber-500 shrink-0" />
                                <span className="text-slate-800 dark:text-gray-300">Physical Cash</span>
                              </>
                            ) : (
                              <>
                                <CreditCard className="w-3.5 h-3.5 text-sky-600 dark:text-sky-500 shrink-0" />
                                <span className="text-slate-800 dark:text-gray-300">Online UPI</span>
                              </>
                            )}
                          </div>
                        </td>
                      )}

                      {/* Amount */}
                      {visibleColumns.has('total_amount') && (
                        <td
                          className={cn(
                            'border-r border-slate-200 dark:border-[#242424] text-right font-bold text-slate-900 dark:text-white tabular-nums',
                            densityStyles.cell
                          )}
                        >
                          <div className="flex items-center justify-end">
                            <span>{formatINR(v.total_amount)}</span>
                          </div>
                        </td>
                      )}

                      {/* Pro Dev Row Tools */}
                      {visibleColumns.has('actions') && (
                        <td
                          className={cn('text-center relative', densityStyles.cell)}
                          data-dropdown-id={v.id}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => openDrawer(v)}
                              title="Inspect Voucher"
                              className="p-1 rounded text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#282828] transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5 text-emerald-600 dark:text-primary" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}

                {paginatedVouchers.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.size + 1} className="p-0 border-none">
                      <EmptyState
                        icon={Receipt}
                        title="No expense vouchers found"
                        description={
                          search || activeFilterCount > 0
                            ? 'No records match your active search or filter criteria. Try resetting filters or clearing search.'
                            : 'No expense vouchers recorded for this branch yet. Create your first voucher to begin.'
                        }
                        actionLabel="Record Expense"
                        onAction={() => setActivePage('new-voucher')}
                        secondaryActionLabel={activeFilterCount > 0 ? 'Reset Filters' : undefined}
                        onSecondaryAction={
                          activeFilterCount > 0
                            ? () => {
                                setSelectedCategory('ALL');
                                setSelectedDept('ALL');
                                setSelectedMode('ALL');
                                setSelectedStatus('ALL');
                                setMinAmount('');
                                setMaxAmount('');
                                setActiveView('all');
                                setSearch('');
                              }
                            : undefined
                        }
                        className="py-14"
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ========================================================================= */}
          {/* 6. TABLE PAGINATION & TOTAL SUMMARY FOOTER                                */}
          {/* ========================================================================= */}
          <div className="bg-slate-50 dark:bg-[#171717] border-t border-slate-200 dark:border-[#2e2e2e] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-sans">
            {/* Left: Record Count & Page Size Selector */}
            <div className="flex flex-wrap items-center gap-3 text-slate-600 dark:text-gray-400 font-mono">
              <span>
                Showing{' '}
                <strong className="text-slate-900 dark:text-white font-semibold">
                  {filteredVouchers.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}
                </strong>{' '}
                to{' '}
                <strong className="text-slate-900 dark:text-white font-semibold">
                  {Math.min(currentPage * pageSize, filteredVouchers.length)}
                </strong>{' '}
                of{' '}
                <strong className="text-slate-900 dark:text-white font-semibold">{filteredVouchers.length}</strong>{' '}
                records
              </span>

              <div className="flex items-center gap-1.5 font-mono text-xs text-slate-600 dark:text-[#888]">
                <span className="text-[11px] font-sans">Rows:</span>
                <div className="relative inline-flex items-center">
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      triggerHaptic('light');
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="appearance-none h-7 pl-2.5 pr-6 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#18181a] text-slate-900 dark:text-white font-mono text-xs cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#3ecf8e] shadow-2xs"
                    title="Select rows per page"
                  >
                    <option value={10}>10</option>
                    <option value={15}>15</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 dark:text-[#888] absolute right-1.5 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Right: Page Stepper Buttons */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded-[4px] bg-white dark:bg-[#202020] border border-slate-300 dark:border-[#2e2e2e] hover:border-slate-400 text-slate-700 dark:text-white disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
                title="Previous Page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="px-2 font-mono text-xs text-slate-700 dark:text-gray-300 font-medium">
                Page {currentPage} of {totalPages}
              </span>

              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 rounded-[4px] bg-white dark:bg-[#202020] border border-slate-300 dark:border-[#2e2e2e] hover:border-slate-400 text-slate-700 dark:text-white disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
                title="Next Page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5.2 ADVANCED TABLE REPORTS (Department-wise, Category-wise, Top Payees)     */}
      {/* ========================================================================= */}
      {(activeSubTab === 'analytics_category' || activeSubTab === 'analytics_dept' || activeSubTab === 'analytics_payee') && (
        <div className="space-y-4 animate-in fade-in duration-150">
          {/* Sub-navigation Switcher: Department Table vs Category Table vs Payee Table vs Visual Matrix */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-[12px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#282828] shadow-xs">
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-sans">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  setAnalyticsReportType('department');
                }}
                className={cn(
                  'px-3 py-1.5 rounded-[6px] font-medium transition-colors flex items-center gap-2 cursor-pointer',
                  analyticsReportType === 'department'
                    ? 'bg-[#3ecf8e] text-[#171717] font-semibold shadow-xs'
                    : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-[#202020] hover:text-slate-900 dark:hover:text-white'
                )}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>Department Report Table</span>
                <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-[4px] bg-black/10 dark:bg-white/10">
                  {departmentAnalytics.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  setAnalyticsReportType('category');
                }}
                className={cn(
                  'px-3 py-1.5 rounded-[6px] font-medium transition-colors flex items-center gap-2 cursor-pointer',
                  analyticsReportType === 'category'
                    ? 'bg-[#3ecf8e] text-[#171717] font-semibold shadow-xs'
                    : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-[#202020] hover:text-slate-900 dark:hover:text-white'
                )}
              >
                <Tag className="w-3.5 h-3.5" />
                <span>Category Report Table</span>
                <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-[4px] bg-black/10 dark:bg-white/10">
                  {categoryAnalytics.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  setAnalyticsReportType('payee');
                }}
                className={cn(
                  'px-3 py-1.5 rounded-[6px] font-medium transition-colors flex items-center gap-2 cursor-pointer',
                  analyticsReportType === 'payee'
                    ? 'bg-[#3ecf8e] text-[#171717] font-semibold shadow-xs'
                    : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-[#202020] hover:text-slate-900 dark:hover:text-white'
                )}
              >
                <User className="w-3.5 h-3.5" />
                <span>Top Payees Report Table</span>
                <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-[4px] bg-black/10 dark:bg-white/10">
                  {payeeAnalytics.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  setAnalyticsReportType('matrix');
                }}
                className={cn(
                  'px-3 py-1.5 rounded-[6px] font-medium transition-colors flex items-center gap-2 cursor-pointer',
                  analyticsReportType === 'matrix'
                    ? 'bg-[#3ecf8e] text-[#171717] font-semibold shadow-xs'
                    : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-[#202020] hover:text-slate-900 dark:hover:text-white'
                )}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Overview Cards</span>
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono text-slate-500 dark:text-zinc-400">
              <span>Total Active Spend:</span>
              <strong className="text-slate-900 dark:text-white tabular-nums">
                {formatINR(telemetry.totalAmount)}
              </strong>
            </div>
          </div>

          {/* TABLE VIEW: Department Report */}
          {analyticsReportType === 'department' && (
            <div className="rounded-[8px] border border-slate-200/80 dark:border-[#242424] bg-white dark:bg-[#161616] overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-[#171717] border-b border-slate-200 dark:border-[#2e2e2e] text-slate-700 dark:text-gray-300 font-sans font-semibold select-none">
                      <th className="py-2.5 px-3 w-12 text-center border-r border-slate-200 dark:border-[#2e2e2e]">#</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 dark:border-[#2e2e2e]">Department Name</th>
                      <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#2e2e2e]">Bills</th>
                      <th className="py-2.5 px-3 text-right border-r border-slate-200 dark:border-[#2e2e2e]">Cash Outflow (₹)</th>
                      <th className="py-2.5 px-3 text-right border-r border-slate-200 dark:border-[#2e2e2e]">UPI Outflow (₹)</th>
                      <th className="py-2.5 px-3 text-right border-r border-slate-200 dark:border-[#2e2e2e]">Total Spend (₹)</th>
                      <th className="py-2.5 px-3 w-44 border-r border-slate-200 dark:border-[#2e2e2e]">% Share of Total</th>
                      <th className="py-2.5 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#242424]">
                    {departmentAnalytics.map((dept, idx) => (
                      <tr
                        key={dept.name}
                        className="hover:bg-slate-50/70 dark:hover:bg-[#1c1c1c] transition-colors"
                      >
                        <td className="py-2 px-3 text-center font-mono text-[11px] text-slate-400 border-r border-slate-100 dark:border-[#242424]">
                          {idx + 1}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-100 dark:border-[#242424]">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-[4px] bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
                              <Building2 className="w-3.5 h-3.5" />
                            </div>
                            <span className="font-medium text-slate-900 dark:text-white font-sans text-xs">
                              {dept.name}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-center font-mono text-slate-700 dark:text-zinc-300 border-r border-slate-100 dark:border-[#242424]">
                          {dept.count}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-zinc-300 border-r border-slate-100 dark:border-[#242424] tabular-nums">
                          {dept.cashSum > 0 ? (
                            <span className="text-emerald-700 dark:text-[#3ecf8e]">
                              {formatINR(dept.cashSum)}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-zinc-300 border-r border-slate-100 dark:border-[#242424] tabular-nums">
                          {dept.upiSum > 0 ? (
                            <span className="text-blue-700 dark:text-blue-400">
                              {formatINR(dept.upiSum)}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-white border-r border-slate-100 dark:border-[#242424] tabular-nums">
                          {formatINR(dept.total)}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-100 dark:border-[#242424]">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[10px] font-mono">
                              <span className="font-semibold text-slate-800 dark:text-zinc-200">
                                {dept.percentage.toFixed(1)}%
                              </span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-[#202020] overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                style={{ width: `${Math.max(dept.percentage, 2)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              triggerHaptic('light');
                              setSelectedDept(dept.name);
                              setActiveSubTab('grid');
                            }}
                            className="px-2 py-1 rounded-[4px] text-[11px] font-sans font-medium text-[#171717] dark:text-[#3ecf8e] bg-[#3ecf8e]/10 hover:bg-[#3ecf8e]/20 border border-[#3ecf8e]/30 cursor-pointer transition-colors"
                            title={`Filter grid to ${dept.name}`}
                          >
                            View Bills
                          </button>
                        </td>
                      </tr>
                    ))}

                    {departmentAnalytics.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-slate-400 font-sans">
                          No department expenses found for active filter selection.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {departmentAnalytics.length > 0 && (
                    <tfoot>
                      <tr className="bg-slate-50 dark:bg-[#1a1a1a] border-t-2 border-slate-200 dark:border-[#2e2e2e] font-mono font-bold text-slate-900 dark:text-white">
                        <td className="py-2.5 px-3 text-center">Σ</td>
                        <td className="py-2.5 px-3 font-sans">Grand Total ({departmentAnalytics.length} Departments)</td>
                        <td className="py-2.5 px-3 text-center">{telemetry.count}</td>
                        <td className="py-2.5 px-3 text-right text-emerald-700 dark:text-[#3ecf8e]">{formatINR(telemetry.cashSum)}</td>
                        <td className="py-2.5 px-3 text-right text-blue-700 dark:text-blue-400">{formatINR(telemetry.upiSum)}</td>
                        <td className="py-2.5 px-3 text-right">{formatINR(telemetry.totalAmount)}</td>
                        <td className="py-2.5 px-3 text-left font-sans text-xs">100.0%</td>
                        <td className="py-2.5 px-3"></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* TABLE VIEW: Category Report */}
          {analyticsReportType === 'category' && (
            <div className="rounded-[8px] border border-slate-200/80 dark:border-[#242424] bg-white dark:bg-[#161616] overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-[#171717] border-b border-slate-200 dark:border-[#2e2e2e] text-slate-700 dark:text-gray-300 font-sans font-semibold select-none">
                      <th className="py-2.5 px-3 w-12 text-center border-r border-slate-200 dark:border-[#2e2e2e]">#</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 dark:border-[#2e2e2e]">Category Head</th>
                      <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#2e2e2e]">Bills</th>
                      <th className="py-2.5 px-3 text-right border-r border-slate-200 dark:border-[#2e2e2e]">Cash Outflow (₹)</th>
                      <th className="py-2.5 px-3 text-right border-r border-slate-200 dark:border-[#2e2e2e]">UPI Outflow (₹)</th>
                      <th className="py-2.5 px-3 text-right border-r border-slate-200 dark:border-[#2e2e2e]">Total Spend (₹)</th>
                      <th className="py-2.5 px-3 w-44 border-r border-slate-200 dark:border-[#2e2e2e]">% Share of Total</th>
                      <th className="py-2.5 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#242424]">
                    {categoryAnalytics.map((cat, idx) => (
                      <tr
                        key={cat.name}
                        className="hover:bg-slate-50/70 dark:hover:bg-[#1c1c1c] transition-colors"
                      >
                        <td className="py-2 px-3 text-center font-mono text-[11px] text-slate-400 border-r border-slate-100 dark:border-[#242424]">
                          {idx + 1}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-100 dark:border-[#242424]">
                          <div className="flex items-center gap-2">
                            <VoucherCategoryAvatar category={cat.name} className="w-6 h-6 rounded-[4px]" />
                            <span className="font-medium text-slate-900 dark:text-white font-sans text-xs">
                              {cat.name}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-center font-mono text-slate-700 dark:text-zinc-300 border-r border-slate-100 dark:border-[#242424]">
                          {cat.count}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-zinc-300 border-r border-slate-100 dark:border-[#242424] tabular-nums">
                          {cat.cashSum > 0 ? (
                            <span className="text-emerald-700 dark:text-[#3ecf8e]">
                              {formatINR(cat.cashSum)}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-zinc-300 border-r border-slate-100 dark:border-[#242424] tabular-nums">
                          {cat.upiSum > 0 ? (
                            <span className="text-blue-700 dark:text-blue-400">
                              {formatINR(cat.upiSum)}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-white border-r border-slate-100 dark:border-[#242424] tabular-nums">
                          {formatINR(cat.total)}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-100 dark:border-[#242424]">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[10px] font-mono">
                              <span className="font-semibold text-slate-800 dark:text-zinc-200">
                                {cat.percentage.toFixed(1)}%
                              </span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-[#202020] overflow-hidden">
                              <div
                                className="h-full bg-[#3ecf8e] rounded-full transition-all duration-300"
                                style={{ width: `${Math.max(cat.percentage, 2)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              triggerHaptic('light');
                              setSelectedCategory(cat.name);
                              setActiveSubTab('grid');
                            }}
                            className="px-2 py-1 rounded-[4px] text-[11px] font-sans font-medium text-[#171717] dark:text-[#3ecf8e] bg-[#3ecf8e]/10 hover:bg-[#3ecf8e]/20 border border-[#3ecf8e]/30 cursor-pointer transition-colors"
                            title={`Filter grid to ${cat.name}`}
                          >
                            View Bills
                          </button>
                        </td>
                      </tr>
                    ))}

                    {categoryAnalytics.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-slate-400 font-sans">
                          No category expenses found for active filter selection.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {categoryAnalytics.length > 0 && (
                    <tfoot>
                      <tr className="bg-slate-50 dark:bg-[#1a1a1a] border-t-2 border-slate-200 dark:border-[#2e2e2e] font-mono font-bold text-slate-900 dark:text-white">
                        <td className="py-2.5 px-3 text-center">Σ</td>
                        <td className="py-2.5 px-3 font-sans">Grand Total ({categoryAnalytics.length} Categories)</td>
                        <td className="py-2.5 px-3 text-center">{telemetry.count}</td>
                        <td className="py-2.5 px-3 text-right text-emerald-700 dark:text-[#3ecf8e]">{formatINR(telemetry.cashSum)}</td>
                        <td className="py-2.5 px-3 text-right text-blue-700 dark:text-blue-400">{formatINR(telemetry.upiSum)}</td>
                        <td className="py-2.5 px-3 text-right">{formatINR(telemetry.totalAmount)}</td>
                        <td className="py-2.5 px-3 text-left font-sans text-xs">100.0%</td>
                        <td className="py-2.5 px-3"></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* TABLE VIEW: Top Payees */}
          {analyticsReportType === 'payee' && (
            <div className="rounded-[8px] border border-slate-200/80 dark:border-[#242424] bg-white dark:bg-[#161616] overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-[#171717] border-b border-slate-200 dark:border-[#2e2e2e] text-slate-700 dark:text-gray-300 font-sans font-semibold select-none">
                      <th className="py-2.5 px-3 w-12 text-center border-r border-slate-200 dark:border-[#2e2e2e]">#</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 dark:border-[#2e2e2e]">Payee / Vendor Name</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 dark:border-[#2e2e2e]">Category</th>
                      <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#2e2e2e]">Bills</th>
                      <th className="py-2.5 px-3 text-right border-r border-slate-200 dark:border-[#2e2e2e]">Cash Outflow (₹)</th>
                      <th className="py-2.5 px-3 text-right border-r border-slate-200 dark:border-[#2e2e2e]">UPI Outflow (₹)</th>
                      <th className="py-2.5 px-3 text-right border-r border-slate-200 dark:border-[#2e2e2e]">Total Spend (₹)</th>
                      <th className="py-2.5 px-3 w-40 border-r border-slate-200 dark:border-[#2e2e2e]">% Share</th>
                      <th className="py-2.5 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#242424]">
                    {payeeAnalytics.map((p, idx) => (
                      <tr
                        key={p.name}
                        className="hover:bg-slate-50/70 dark:hover:bg-[#1c1c1c] transition-colors"
                      >
                        <td className="py-2 px-3 text-center font-mono text-[11px] text-slate-400 border-r border-slate-100 dark:border-[#242424]">
                          {idx + 1}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-100 dark:border-[#242424]">
                          <span className="font-medium text-slate-900 dark:text-white font-sans text-xs">
                            {p.name}
                          </span>
                        </td>
                        <td className="py-2 px-3 border-r border-slate-100 dark:border-[#242424] font-sans text-slate-600 dark:text-zinc-400">
                          {p.category}
                        </td>
                        <td className="py-2 px-3 text-center font-mono text-slate-700 dark:text-zinc-300 border-r border-slate-100 dark:border-[#242424]">
                          {p.count}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-zinc-300 border-r border-slate-100 dark:border-[#242424] tabular-nums">
                          {p.cashSum > 0 ? formatINR(p.cashSum) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-zinc-300 border-r border-slate-100 dark:border-[#242424] tabular-nums">
                          {p.upiSum > 0 ? formatINR(p.upiSum) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-white border-r border-slate-100 dark:border-[#242424] tabular-nums">
                          {formatINR(p.total)}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-100 dark:border-[#242424]">
                          <div className="space-y-1">
                            <span className="text-[10px] font-mono font-semibold text-slate-800 dark:text-zinc-200">
                              {p.percentage.toFixed(1)}%
                            </span>
                            <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-[#202020] overflow-hidden">
                              <div
                                className="h-full bg-amber-500 rounded-full transition-all duration-300"
                                style={{ width: `${Math.max(p.percentage, 2)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              triggerHaptic('light');
                              setSearch(p.name);
                              setActiveSubTab('grid');
                            }}
                            className="px-2 py-1 rounded-[4px] text-[11px] font-sans font-medium text-[#171717] dark:text-[#3ecf8e] bg-[#3ecf8e]/10 hover:bg-[#3ecf8e]/20 border border-[#3ecf8e]/30 cursor-pointer transition-colors"
                            title={`Search bills for ${p.name}`}
                          >
                            Filter Payee
                          </button>
                        </td>
                      </tr>
                    ))}

                    {payeeAnalytics.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-10 text-center text-slate-400 font-sans">
                          No payee records found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* CARD VIEW: Overview Matrix */}
          {analyticsReportType === 'matrix' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-in fade-in duration-150">
              {/* 1. Category Breakdown Card */}
              <div className="p-4 rounded-[12px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#282828] space-y-3 shadow-xs">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-[#242424]">
                  <span className="text-xs font-semibold text-slate-900 dark:text-white font-sans flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-[#3ecf8e]" />
                    <span>Categories</span>
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {categoryAnalytics.length} heads
                  </span>
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {categoryAnalytics.map((cat, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="font-sans font-medium text-slate-800 dark:text-zinc-200 truncate pr-2">
                          {cat.name}
                        </span>
                        <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                          {formatINR(cat.total)}
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-[#202020] overflow-hidden">
                        <div
                          className="h-full bg-[#3ecf8e] rounded-full transition-all duration-300"
                          style={{ width: `${Math.max(cat.percentage, 2)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 2. Department Breakdown Card */}
              <div className="p-4 rounded-[12px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#282828] space-y-3 shadow-xs">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-[#242424]">
                  <span className="text-xs font-semibold text-slate-900 dark:text-white font-sans flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-blue-500" />
                    <span>Departments</span>
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {departmentAnalytics.length} depts
                  </span>
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {departmentAnalytics.map((dept, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="font-sans font-medium text-slate-800 dark:text-zinc-200 truncate pr-2">
                          {dept.name}
                        </span>
                        <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                          {formatINR(dept.total)}
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-[#202020] overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all duration-300"
                          style={{ width: `${Math.max(dept.percentage, 2)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 3. Top Payees Card */}
              <div className="p-4 rounded-[12px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#282828] space-y-3 shadow-xs">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-[#242424]">
                  <span className="text-xs font-semibold text-slate-900 dark:text-white font-sans flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-amber-500" />
                    <span>Top Payees</span>
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    Top {payeeAnalytics.length}
                  </span>
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {payeeAnalytics.slice(0, 10).map((p, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs font-mono py-1 border-b border-slate-100 dark:border-[#242424] last:border-b-0">
                      <div className="truncate pr-2">
                        <span className="font-sans font-medium text-slate-800 dark:text-zinc-200 block truncate">
                          {p.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-sans">
                          {p.category} · {p.count} bill{p.count > 1 ? 's' : ''}
                        </span>
                      </div>
                      <span className="font-semibold text-slate-900 dark:text-white tabular-nums shrink-0">
                        {formatINR(p.total)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Executive CA Audit & Expense Report View */}
      {activeSubTab === 'report' && (
        <div className="rounded-[12px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#282828] p-5 space-y-4 shadow-sm print:m-0 print:border-none print:shadow-none animate-in fade-in duration-150">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-[#242424]">
            <div>
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-[#3ecf8e]" />
                <h2 className="text-base font-medium font-sans text-slate-900 dark:text-white tracking-tight">
                  Asopalav Expense Ledger &amp; Audit Report
                </h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 font-mono">
                Period: {effectiveStartDate || 'Beginning'} &rarr; {effectiveEndDate || 'Present'} · Generated: {formatDate(new Date(), 'dd MMM yyyy, HH:mm')}
              </p>
            </div>

            <div className="flex items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={() => window.print()}
                className="h-8 px-3 rounded-[6px] border border-slate-200 dark:border-[#282828] hover:bg-slate-100 dark:hover:bg-[#202020] text-xs font-medium text-slate-700 dark:text-zinc-300 flex items-center gap-1.5 cursor-pointer font-sans"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Report</span>
              </button>
              <button
                type="button"
                onClick={handleExportCSV}
                className="h-8 px-3 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] text-xs font-semibold flex items-center gap-1.5 cursor-pointer font-sans shadow-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-2">
            <div className="p-3 rounded-[8px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#242424]">
              <span className="text-[11px] font-sans text-slate-500 dark:text-zinc-400">Total Outflow</span>
              <div className="text-base font-mono font-medium tabular-nums text-slate-900 dark:text-white mt-0.5">
                {formatINR(telemetry.totalAmount)}
              </div>
            </div>
            <div className="p-3 rounded-[8px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#242424]">
              <span className="text-[11px] font-sans text-slate-500 dark:text-zinc-400">Cash Payments</span>
              <div className="text-base font-mono font-medium tabular-nums text-slate-900 dark:text-white mt-0.5">
                {formatINR(telemetry.cashSum)} ({telemetry.cashPercent}%)
              </div>
            </div>
            <div className="p-3 rounded-[8px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#242424]">
              <span className="text-[11px] font-sans text-slate-500 dark:text-zinc-400">UPI / Online</span>
              <div className="text-base font-mono font-medium tabular-nums text-slate-900 dark:text-white mt-0.5">
                {formatINR(telemetry.upiSum)} ({telemetry.upiPercent}%)
              </div>
            </div>
            <div className="p-3 rounded-[8px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#242424]">
              <span className="text-[11px] font-sans text-slate-500 dark:text-zinc-400">Total Transactions</span>
              <div className="text-base font-mono font-medium tabular-nums text-slate-900 dark:text-white mt-0.5">
                {filteredVouchers.length} bills
              </div>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 dark:border-[#282828] rounded-[8px]">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="bg-slate-50 dark:bg-[#141414] border-b border-slate-200 dark:border-[#282828] text-[11px] uppercase tracking-wider text-slate-500 dark:text-zinc-400 font-medium">
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Bill No.</th>
                  <th className="py-2.5 px-3">Payee / Recipient</th>
                  <th className="py-2.5 px-3">Category</th>
                  <th className="py-2.5 px-3">Department</th>
                  <th className="py-2.5 px-3">Mode</th>
                  <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#242424]">
                {filteredVouchers.map((v, idx) => (
                  <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-[#1a1a1a] transition-colors">
                    <td className="py-2 px-3 text-slate-400">{idx + 1}</td>
                    <td className="py-2 px-3 text-slate-900 dark:text-zinc-200">{v.payment_date || '-'}</td>
                    <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white">{v.voucher_number}</td>
                    <td className="py-2 px-3 text-slate-900 dark:text-zinc-200 truncate max-w-[180px]">{v.recipient_name || '-'}</td>
                    <td className="py-2 px-3 text-slate-600 dark:text-zinc-400">{v.category_name || '-'}</td>
                    <td className="py-2 px-3 text-slate-600 dark:text-zinc-400">{v.department_name || '-'}</td>
                    <td className="py-2 px-3">{v.payment_method === 'Physical_Cash' ? 'Cash' : 'UPI'}</td>
                    <td className="py-2 px-3 text-right font-medium text-slate-900 dark:text-white tabular-nums">{formatINR(Number(v.total_amount) || 0)}</td>
                    <td className="py-2 px-3 text-[11px] text-[#3ecf8e]">{v.status || 'Approved'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 dark:border-[#282828] bg-slate-50 dark:bg-[#141414] font-semibold text-xs">
                  <td colSpan={7} className="py-2.5 px-3 text-right">Grand Total ({filteredVouchers.length} vouchers):</td>
                  <td className="py-2.5 px-3 text-right font-bold text-sm text-slate-900 dark:text-white tabular-nums">{formatINR(telemetry.totalAmount)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

