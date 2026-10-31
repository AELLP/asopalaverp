import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useAuthStore } from '@/store/authStore';
import { useBranchStore } from '@/store/branchStore';
import { useOfflineQueue } from '@/lib/offlineQueue';
import { erpService } from '@/lib/erpService';
import { calculateDailyTreasuryBalances, TreasuryDailyBreakdown } from '@/lib/dailyCashBalance';
import { cn, normalizeBranchCode } from '@/lib/utils';
import {
  Menu,
  Search,
  Moon,
  Sun,
  Wallet,
  CloudOff,  Calculator,
  User,
  Lock,
  LogOut,
  ChevronDown,
  Settings,
} from 'lucide-react';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { Kbd } from '@/components/ui/Kbd';
import {
  AppSidebarCollapseIcon,
  AppSidebarExpandIcon,
} from '@/components/icons/AppIcons';
import { useBrandStore } from '@/store/brandStore';
import { UserAvatar } from '@/components/ui/UserAvatar';

interface TopbarProps {
  onOpenKeyboardHelp?: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({ onOpenKeyboardHelp }) => {
  const { brandName } = useBrandStore();
  const {
    activePage,
    setActivePage,
    theme,
    toggleTheme,
    setSearchOpen,
    setCalculatorOpen,
    toggleMobileSidebar,
    toggleSidebarCollapse,
    isSidebarCollapsed,
  } = useUIStore();
  const { user, lockScreen, logout, can } = useAuthStore();
  const { getActiveBranch, selectedBranchId, wallets, fetchBranchesAndWallets } = useBranchStore();
  const { isOnline } = useOfflineQueue();

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  const [isCashDrawerPopoverOpen, setIsCashDrawerPopoverOpen] = useState(false);
  const cashPopoverRef = useRef<HTMLDivElement | null>(null);
  const [todayTreasurySummary, setTodayTreasurySummary] = useState<TreasuryDailyBreakdown | null>(null);

  const activeBranch = getActiveBranch();
  const branchTarget = activeBranch?.branch_id || selectedBranchId || 'Aellp-ASI';
  const targetWallet = wallets[branchTarget] || wallets[normalizeBranchCode(branchTarget)] || wallets['Aellp-ASI'];

  // Live reactive wallet balances from central Zustand store
  const cashBalance = targetWallet ? Number(targetWallet.cash_balance) : 78630;
  const upiBalance = targetWallet ? Number(targetWallet.upi_balance) : 208569;

    
  const userFullName = `${user?.first_name || 'Admin'} ${user?.last_name || ''}`.trim();
  
  const ledgerRef = useRef<any[]>([]);
  const isFetchingLedgerRef = useRef(false);

  // Load today's cash drawer opening, inflows, and outflows (Deduplicated)
  const loadTodayCashFlow = useCallback(async () => {
    if (isFetchingLedgerRef.current) return;
    isFetchingLedgerRef.current = true;
    try {
      const branchToQuery = selectedBranchId === 'ALL' ? undefined : selectedBranchId;
      const ledger = await erpService.getWalletLedger(branchToQuery);
      ledgerRef.current = ledger;
      const currentWallets = useBranchStore.getState().wallets;
      const w = currentWallets[branchTarget] || currentWallets[normalizeBranchCode(branchTarget)] || currentWallets['Aellp-ASI'];
      const activeCash = w ? Number(w.cash_balance) : 78630;
      const activeUpi = w ? Number(w.upi_balance) : 208569;
      const summary = calculateDailyTreasuryBalances(ledger, activeCash, activeUpi);
      setTodayTreasurySummary(summary);
    } catch (err) {
      console.warn('Error loading today cash flow for topbar:', err);
    } finally {
      isFetchingLedgerRef.current = false;
    }
  }, [selectedBranchId, branchTarget]);

  // Recalculate if balances update without repeating network calls
  useEffect(() => {
    if (ledgerRef.current.length > 0) {
      const summary = calculateDailyTreasuryBalances(ledgerRef.current, cashBalance, upiBalance);
      setTodayTreasurySummary(summary);
    }
  }, [cashBalance, upiBalance]);

  // Close user dropdown or cash drawer popover on outside click or ESC
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
      if (cashPopoverRef.current && !cashPopoverRef.current.contains(e.target as Node)) {
        setIsCashDrawerPopoverOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsUserMenuOpen(false);
        setIsCashDrawerPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const lastRefreshRef = useRef(0);
  // Live Wallet Balances Sync (Throttled to max once every 3s)
  const refreshWallet = useCallback(async () => {
    const now = Date.now();
    if (now - lastRefreshRef.current < 3000) return;
    lastRefreshRef.current = now;
    try {
      await fetchBranchesAndWallets(true);
    } catch {
      // Handled gracefully
    }
  }, [fetchBranchesAndWallets]);

  useEffect(() => {
    refreshWallet();
    loadTodayCashFlow();

    // Only update today cash flow calculation on wallet/ledger events (DO NOT re-trigger fetchBranchesAndWallets)
    const handleReconcile = () => {
      loadTodayCashFlow();
    };

    window.addEventListener('asopalav:wallet-updated', handleReconcile);
    window.addEventListener('asopalav:ledger-updated', handleReconcile);
    window.addEventListener('focus', handleReconcile);

    return () => {
      window.removeEventListener('asopalav:wallet-updated', handleReconcile);
      window.removeEventListener('asopalav:ledger-updated', handleReconcile);
      window.removeEventListener('focus', handleReconcile);
    };
  }, [selectedBranchId, branchTarget]);

  const pageTitles: Record<string, string> = {
    dashboard: 'Dashboard',
    'new-voucher': 'Add Expense',
    expenses: 'All Expenses',
    treasury: 'Cash Drawer & UPI',
    advances: 'Staff Advances (Beta)',
    reports: 'Financial & Audit Reports',
    staff: 'Staff Directory',
    settings: 'Shop Settings',
    audit: 'Activity History',
    notifications: 'Alerts & Messages',
    profile: 'My Profile',
    search: 'Search Everything',
  };

  const activePageTitle = pageTitles[activePage] || 'Dashboard';

  return (
    <div className="border-b border-slate-200/80 dark:border-[#242424] bg-white dark:bg-[#141414] select-none text-slate-900 dark:text-white font-sans h-14">
      <div className="h-full px-4 sm:px-5 flex items-center justify-between gap-3 sm:gap-4">
        {/* ========================================================================= */}
        {/* SECTION 1 (LEFT): SIDEBAR TOGGLE & SUPABASE STUDIO BREADCRUMB             */}
        {/* ========================================================================= */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0 min-w-0">
          {/* Desktop Sidebar Toggle */}
          <button
            type="button"
            onClick={toggleSidebarCollapse}
            aria-label={`Toggle Sidebar (${isSidebarCollapsed ? 'Expand' : 'Collapse'})`}
            className="hidden lg:flex items-center justify-center w-9 h-9 rounded-[6px] text-slate-500 dark:text-[#a1a1a1] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#1c1c1c] border border-transparent hover:border-slate-200 dark:hover:border-[#282828] transition-colors cursor-pointer"
            title={`Toggle Sidebar (${isSidebarCollapsed ? 'Expand' : 'Collapse'})`}
          >
            {isSidebarCollapsed ? (
              <AppSidebarExpandIcon className="w-4.5 h-4.5 text-slate-500 dark:text-[#a1a1a1]" />
            ) : (
              <AppSidebarCollapseIcon className="w-4.5 h-4.5 text-slate-500 dark:text-[#a1a1a1]" />
            )}
          </button>

          {/* Mobile Hamburger Drawer Toggle */}
          <button
            type="button"
            onClick={toggleMobileSidebar}
            aria-label="Open navigation sidebar"
            className="lg:hidden flex items-center justify-center w-9 h-9 rounded-[6px] text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-[#1c1c1c] border border-transparent hover:border-slate-200 dark:hover:border-[#282828] transition-colors cursor-pointer shrink-0"
            title="Open Navigation"
          >
            <Menu className="w-5 h-5 stroke-[2]" />
          </button>

          {/* Supabase Style Studio Breadcrumbs */}
          <div className="flex items-center gap-2 min-w-0 select-none font-sans">
            <span className="hidden sm:inline text-xs text-slate-400 dark:text-[#707070] font-normal truncate">
              {brandName} ERP
            </span>
            <span className="hidden sm:inline text-xs text-slate-300 dark:text-[#404040]">/</span>
            <span className="font-semibold text-sm text-slate-900 dark:text-[#ededed] truncate tracking-tight">
              {activePageTitle}
            </span>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SECTION 2 (RIGHT): SEARCH, LIVE BALANCES & OPERATIONAL CONTROLS           */}
        {/* ========================================================================= */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          {/* 1A. Mobile & Tablet (< lg): Search Icon Button */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            className="lg:hidden flex items-center justify-center w-9 h-9 rounded-[6px] border border-slate-200/80 dark:border-[#242424] hover:border-slate-300 dark:hover:border-[#2e2e2e] bg-slate-50/50 dark:bg-[#181818] hover:bg-slate-100 dark:hover:bg-[#202020] text-slate-600 dark:text-[#a1a1a1] transition-colors cursor-pointer shadow-2xs shrink-0"
            title="Search"
          >
            <Search className="w-4 h-4 stroke-[1.8]" />
          </button>

          {/* 1B. Desktop Only (lg+): Global Command Search Bar */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Global Search"
            className="hidden lg:flex items-center justify-between h-9 px-3 w-48 xl:w-60 bg-slate-50/50 dark:bg-[#181818] hover:bg-slate-100 dark:hover:bg-[#202020] border border-slate-200/80 dark:border-[#242424] hover:border-slate-300 dark:hover:border-[#2e2e2e] rounded-[6px] text-xs text-slate-400 dark:text-[#888888] transition-colors cursor-pointer group shadow-2xs select-none shrink-0"
            title="Search expenses, staff, receipts & cash... (Ctrl+K)"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Search className="w-4 h-4 text-slate-400 dark:text-[#606060] group-hover:text-slate-700 dark:group-hover:text-zinc-200 transition-colors shrink-0 stroke-[1.8]" />
              <span className="truncate text-xs font-sans">Search...</span>
            </div>
            <Kbd size="xs" className="hidden xl:inline-flex rounded-[4px]">Ctrl K</Kbd>
          </button>

          {/* 2A & 2B. Cash Box & Online UPI Balance Pills (Restricted to Authorized Roles) */}
          {can('can_inject_float') && (
            <>
              {/* 2A. Cash Box Balance Pill with Today's Opening & Closing Statement Popover */}
              <div className="relative" ref={cashPopoverRef}>
                <button
                  type="button"
                  onClick={() => setIsCashDrawerPopoverOpen((prev) => !prev)}
                  aria-label={`Cash Box Balance: ₹${cashBalance.toLocaleString('en-IN')}`}
                  className={cn(
                    'hidden lg:flex items-center gap-2 h-9 px-3 rounded-[6px] border text-xs font-mono transition-colors shadow-2xs cursor-pointer select-none shrink-0',
                    isCashDrawerPopoverOpen
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e]'
                      : 'border-slate-200/80 dark:border-[#242424] bg-slate-50/50 dark:bg-[#181818] text-slate-800 dark:text-[#ededed] hover:border-slate-300 dark:hover:border-[#2e2e2e] hover:bg-slate-100 dark:hover:bg-[#202020]'
                  )}
                  title="Today's Cash Drawer Balance (Click to view Opening/Closing sheet)"
                >
                  <Wallet className="w-4 h-4 text-slate-400 dark:text-[#707070] shrink-0 stroke-[1.8]" />
                  <span className="text-[11px] uppercase font-mono tracking-wider text-slate-400 dark:text-[#707070]">Cash:</span>
                  <strong className="font-semibold tabular-nums text-xs text-emerald-600 dark:text-[#3ecf8e]">
                    <AnimatedCounter value={cashBalance} isCurrency />
                  </strong>
                  {todayTreasurySummary && (
                    <span className="hidden 2xl:inline-flex items-center gap-1 text-[10px] text-slate-400 dark:text-[#707070] font-mono border-l border-slate-200 dark:border-[#333333] pl-2 ml-0.5">
                      <span>Open: ₹{Math.round(todayTreasurySummary.cash.opening).toLocaleString('en-IN')}</span>
                    </span>
                  )}
                  <ChevronDown
                    className={cn(
                      'w-3 h-3 text-slate-400 transition-transform duration-150',
                      isCashDrawerPopoverOpen && 'rotate-180 text-emerald-600 dark:text-[#3ecf8e]'
                    )}
                  />
                </button>

                {/* Today's Cash Drawer Reconciliation Popover */}
                {isCashDrawerPopoverOpen && (
                  <div className="absolute left-0 mt-1.5 w-80 rounded-[10px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] shadow-2xl z-[100] p-3 font-sans animate-in fade-in zoom-in-95 duration-100">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-[#242424]">
                      <div className="flex items-center gap-1.5">
                        <Wallet className="w-4 h-4 text-[#3ecf8e]" />
                        <span className="text-xs font-semibold text-slate-900 dark:text-white font-sans">
                          Today's Cash Reconciliation
                        </span>
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] font-medium">
                        Live Till
                      </span>
                    </div>

                    <div className="space-y-1.5 text-xs font-mono">
                      <div className="flex items-center justify-between py-1 px-1.5 rounded bg-slate-50 dark:bg-[#141414]">
                        <span className="text-slate-500 dark:text-[#888888]">1. Morning Opening Cash:</span>
                        <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                          ₹{todayTreasurySummary ? Math.round(todayTreasurySummary.cash.opening).toLocaleString('en-IN') : cashBalance.toLocaleString('en-IN')}
                        </span>
                      </div>

                      <div className="flex items-center justify-between py-1 px-1.5 rounded bg-slate-50 dark:bg-[#141414]">
                        <span className="text-slate-500 dark:text-[#888888]">2. Morning Opening UPI:</span>
                        <span className="font-semibold text-sky-600 dark:text-sky-400 tabular-nums">
                          ₹{todayTreasurySummary ? Math.round(todayTreasurySummary.upi.opening).toLocaleString('en-IN') : upiBalance.toLocaleString('en-IN')}
                        </span>
                      </div>

                      <div className="flex items-center justify-between py-1 px-1.5 rounded bg-slate-100/70 dark:bg-[#1a1a1a] border border-slate-200/50 dark:border-[#262626]">
                        <span className="text-slate-600 dark:text-zinc-300 font-medium">Combined Day Opening:</span>
                        <span className="font-bold text-slate-900 dark:text-white tabular-nums">
                          ₹{todayTreasurySummary ? Math.round(todayTreasurySummary.total.opening).toLocaleString('en-IN') : (cashBalance + upiBalance).toLocaleString('en-IN')}
                        </span>
                      </div>

                      <div className="flex items-center justify-between py-1 px-1.5 rounded bg-slate-50 dark:bg-[#141414]">
                        <span className="text-emerald-600 dark:text-[#3ecf8e]">3. Cash Inflows (+) Float:</span>
                        <span className="font-semibold text-emerald-600 dark:text-[#3ecf8e] tabular-nums">
                          +₹{todayTreasurySummary ? Math.round(todayTreasurySummary.cash.inflow).toLocaleString('en-IN') : '0'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between py-1 px-1.5 rounded bg-slate-50 dark:bg-[#141414]">
                        <span className="text-rose-600 dark:text-rose-400">4. Cash Outflows (-) Vouchers:</span>
                        <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                          -₹{todayTreasurySummary ? Math.round(todayTreasurySummary.cash.outflow).toLocaleString('en-IN') : '0'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between py-1.5 px-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-xs">
                        <span className="font-semibold text-emerald-800 dark:text-[#3ecf8e] font-sans">
                          5. Current Cash in Till:
                        </span>
                        <span className="font-bold text-emerald-700 dark:text-[#3ecf8e] tabular-nums text-sm">
                          ₹{cashBalance.toLocaleString('en-IN')}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2.5 mt-2.5 border-t border-slate-100 dark:border-[#242424] flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setIsCashDrawerPopoverOpen(false);
                          setActivePage('treasury');
                        }}
                        className="flex-1 py-1.5 px-2 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-medium text-xs font-sans flex items-center justify-center gap-1 transition-colors cursor-pointer"
                      >
                        <span>Passbook Ledger (F4)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsCashDrawerPopoverOpen(false);
                          setActivePage('reports');
                        }}
                        className="py-1.5 px-2.5 rounded-[6px] border border-slate-200 dark:border-[#282828] hover:bg-slate-50 dark:hover:bg-[#202020] text-slate-700 dark:text-[#A1A1A1] text-xs font-sans transition-colors cursor-pointer"
                      >
                        <span>Reports</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 2B. Online UPI Balance Pill (xl+) */}
              <button
                type="button"
                onClick={() => setActivePage('treasury')}
                aria-label={`UPI Balance: ₹${upiBalance.toLocaleString('en-IN')}`}
                className="hidden xl:flex items-center gap-2 h-9 px-3 rounded-[6px] border border-slate-200/80 dark:border-[#242424] bg-slate-50/50 dark:bg-[#181818] text-slate-800 dark:text-[#ededed] hover:border-slate-300 dark:hover:border-[#2e2e2e] hover:bg-slate-100 dark:hover:bg-[#202020] text-xs font-mono transition-colors shadow-2xs cursor-pointer select-none shrink-0"
                title="UPI account balance (Click to manage)"
              >
                <span className="text-[11px] uppercase font-mono tracking-wider text-slate-400 dark:text-[#707070]">UPI:</span>
                <strong className="font-semibold tabular-nums text-xs text-sky-500 dark:text-sky-400">
                  <AnimatedCounter value={upiBalance} isCurrency />
                </strong>
              </button>
            </>
          )}

          {/* 3. Quick Calculator Trigger */}
          <button
            type="button"
            onClick={() => setCalculatorOpen(true)}
            aria-label="Quick Calculator"
            className="hidden sm:flex items-center justify-center w-9 h-9 rounded-[6px] border border-slate-200/80 dark:border-[#242424] hover:border-slate-300 dark:hover:border-[#2e2e2e] bg-slate-50/50 dark:bg-[#181818] hover:bg-slate-100 dark:hover:bg-[#202020] text-slate-500 dark:text-[#a1a1a1] hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer shadow-2xs shrink-0"
            title="Quick Math & Discount Calculator"
          >
            <Calculator className="w-4 h-4 stroke-[1.8]" />
          </button>

          {/* Offline Notice (Only shown if internet disconnects) */}
          {!isOnline && (
            <span className="flex items-center gap-1.5 h-9 px-2.5 rounded-[6px] text-xs font-medium text-rose-600 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50">
              <CloudOff className="w-3.5 h-3.5" />
              <span>Offline</span>
            </span>
          )}

          {/* 5. User Profile Avatar & Menu */}
          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              onClick={() => setIsUserMenuOpen((prev) => !prev)}
              aria-label={`User Menu: ${userFullName}`}
              aria-expanded={isUserMenuOpen}
              className={cn(
                'flex items-center gap-2.5 h-9 rounded-[6px] transition-colors cursor-pointer select-none px-2.5 border shadow-2xs',
                isUserMenuOpen
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e]'
                  : 'border-slate-200/80 dark:border-[#242424] bg-slate-50/50 dark:bg-[#181818] hover:border-slate-300 dark:hover:border-[#2e2e2e] hover:bg-slate-100 dark:hover:bg-[#202020]'
              )}
              title={`${userFullName} (${user?.role_code || 'Super Admin'})`}
            >
              {/* Avatar Photo / Initials */}
              <div className="relative w-6 h-6 shrink-0 flex items-center justify-center">
                <UserAvatar
                  src={user?.avatar_url}
                  firstName={user?.first_name}
                  lastName={user?.last_name}
                  name={user?.username || userFullName}
                  size={24}
                  className="border border-emerald-500/30 shrink-0 shadow-2xs"
                />
              </div>

              <span className="hidden sm:inline-block text-xs font-semibold text-slate-800 dark:text-zinc-200 max-w-[95px] truncate font-sans">
                {user?.first_name || 'Admin'}
              </span>

              <ChevronDown
                className={cn(
                  'w-3.5 h-3.5 text-slate-400 dark:text-[#707070] transition-transform duration-150',
                  isUserMenuOpen && 'rotate-180 text-emerald-600 dark:text-[#3ecf8e]'
                )}
              />
            </button>

            {/* Dropdown Menu */}
            {isUserMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-64 rounded-[10px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] shadow-2xl z-[100] overflow-hidden font-sans animate-in fade-in zoom-in-95 duration-100">
                {/* Header User Card */}
                <div className="p-3 bg-slate-50 dark:bg-[#141414] border-b border-slate-200/80 dark:border-[#242424]">
                  <div className="flex items-center gap-2.5">
                    <UserAvatar
                      src={user?.avatar_url}
                      firstName={user?.first_name}
                      lastName={user?.last_name}
                      name={user?.username || userFullName}
                      size={36}
                      className="border border-emerald-500/50 shadow-xs shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-xs text-slate-900 dark:text-white truncate">
                        {userFullName}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 dark:text-[#888888] truncate">
                        @{user?.username || 'admin'}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="inline-flex items-center px-1.5 py-0.2 rounded-[4px] text-[9px] font-mono font-semibold bg-emerald-500/10 text-emerald-600 dark:text-[#3ecf8e] border border-emerald-500/20">
                          {user?.role_code || 'Super Admin'}
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono">
                          {activeBranch?.branch_code || 'ASI'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Menu Items */}
                <div className="p-1.5 space-y-0.5 text-xs">
                  {/* My Profile */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      setActivePage('profile');
                    }}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-left transition-colors cursor-pointer',
                      activePage === 'profile'
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] font-medium'
                        : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#222222] hover:text-slate-900 dark:hover:text-white'
                    )}
                  >
                    <User className="w-4 h-4 text-emerald-600 dark:text-[#3ecf8e] shrink-0 stroke-[1.8]" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-xs truncate">My Profile & Avatar</div>
                      <div className="text-[10px] text-slate-400 dark:text-[#707070] truncate">Change photo, PIN, password</div>
                    </div>
                  </button>


                  {/* Shop Settings (Restricted to Authorized Admins) */}
                  {can('can_manage_periods') && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        setActivePage('settings');
                      }}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-left transition-colors cursor-pointer',
                        activePage === 'settings'
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] font-medium'
                          : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#222222] hover:text-slate-900 dark:hover:text-white'
                      )}
                    >
                      <Settings className="w-4 h-4 text-slate-500 dark:text-[#a1a1a1] shrink-0 stroke-[1.8]" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-xs truncate">Shop Settings & Rules</div>
                        <div className="text-[10px] text-slate-400 dark:text-[#707070] truncate">Settings & overrides</div>
                      </div>
                    </button>
                  )}

                  {/* Theme Switcher */}
                  <button
                    type="button"
                    onClick={() => {
                      toggleTheme();
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-left text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#222222] hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                  >
                    {theme === 'light' ? (
                      <Sun className="w-4 h-4 text-amber-500 shrink-0 stroke-[1.8]" />
                    ) : (
                      <Moon className="w-4 h-4 text-zinc-400 shrink-0 stroke-[1.8]" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-xs truncate flex items-center justify-between">
                        <span>Theme Mode</span>
                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-[4px] bg-slate-100 dark:bg-[#252525] text-slate-600 dark:text-zinc-300 capitalize font-medium">
                          {theme === 'dark' ? 'Studio Dark' : theme === 'soft-dark' ? 'Soft Dark' : 'Light'}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 dark:text-[#707070] truncate">
                        Click to cycle White / Dark / Soft Dark
                      </div>
                    </div>
                  </button>

                  <div className="border-t border-slate-100 dark:border-[#262626] my-1" />

                  {/* Lock Screen */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      lockScreen();
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-left text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#222222] hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                  >
                    <Lock className="w-4 h-4 text-amber-500 shrink-0 stroke-[1.8]" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-xs truncate">Lock Screen</div>
                      <div className="text-[10px] text-slate-400 dark:text-[#707070] truncate">Quick lock counter screen</div>
                    </div>
                  </button>

                  {/* Sign Out */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      logout();
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-left text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-4 h-4 text-rose-500 shrink-0 stroke-[1.8]" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-xs truncate">Sign Out</div>
                      <div className="text-[10px] text-rose-400/80 truncate">End active session</div>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Topbar;
