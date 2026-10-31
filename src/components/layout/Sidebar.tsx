import React, { useState, useRef, useEffect } from 'react';
import { useUIStore, PageId } from '@/store/uiStore';
import { useAuthStore, isPrivilegedAdminRole } from '@/store/authStore';
import { useBranchStore } from '@/store/branchStore';
import { useScrollLock } from '@/hooks/useScrollLock';
import {
  LayoutGrid,
  Receipt,
  Wallet,
  HandCoins,  Users,  ShieldCheck,
  SlidersHorizontal,
  ChevronsUpDown,
  Check,
  Lock,
  X,
  LogOut,
  Sun,
  Moon,
  Keyboard,
  Clock,
  Store,  FileSpreadsheet,
} from 'lucide-react';
import {
  AppTableIcon,  AppSidebarExpandIcon,
} from '@/components/icons/AppIcons';
import { useBrandStore } from '@/store/brandStore';
import { cn } from '@/lib/utils';
import { RolePermissions } from '@/types/database';
import { UserAvatar } from '@/components/ui/UserAvatar';

interface NavItem {
  id: PageId;
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  permission?: keyof RolePermissions;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export const Sidebar: React.FC = () => {
  const { brandName } = useBrandStore();
  const {
    activePage,
    setActivePage,
    isMobileSidebarOpen,
    setMobileSidebarOpen,
    isSidebarCollapsed,
    toggleSidebarCollapse,
    theme,
    toggleTheme,
    setShortcutsModalOpen,
    isStaffAdvanceBetaEnabled,
  } = useUIStore();
  const { user, can, getAllowedBranches, lockScreen, logout, getSessionTimeRemainingFormatted } = useAuthStore();
  const { branches, selectedBranchId, setSelectedBranchId, getActiveBranch } = useBranchStore();

  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);
  const [isProfilePopoverOpen, setIsProfilePopoverOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const profilePopoverRef = useRef<HTMLDivElement | null>(null);

  // Lock background window scrolling when mobile drawer is open
  useScrollLock(isMobileSidebarOpen);

  const allowedBranches = getAllowedBranches(branches);
  const activeBranch = getActiveBranch();
  const canViewAll = isPrivilegedAdminRole(user?.role_code) || can('can_view_all_branches');
  const isBranchSwitcherEnabled = canViewAll || allowedBranches.length > 1;

  // Close dropdowns on outside click or Escape
  useEffect(() => {
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsBranchDropdownOpen(false);
      }
      if (profilePopoverRef.current && !profilePopoverRef.current.contains(e.target as Node)) {
        setIsProfilePopoverOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsBranchDropdownOpen(false);
        setIsProfilePopoverOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Keyboard shortcut: ESC to close mobile drawer
  useEffect(() => {
    if (!isMobileSidebarOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileSidebarOpen, setMobileSidebarOpen]);

  // Master Navigation Architecture (Supabase Studio Precision)
  const navSections: NavSection[] = [
    {
      title: 'CORE OPERATIONS',
      items: [
        {
          id: 'dashboard',
          label: 'Dashboard',
          description: 'Money & shop summary',
          icon: LayoutGrid,
        },
        {
          id: 'new-voucher',
          label: 'Add Expense',
          description: 'Enter new bill or voucher',
          icon: Receipt,
          permission: 'can_create_voucher',
        },
        {
          id: 'expenses',
          label: 'All Expenses',
          description: 'Search all expense bills',
          icon: AppTableIcon,
        },
        {
          id: 'treasury',
          label: 'Cash Drawer & UPI',
          description: 'Cash drawer till & passbook',
          icon: Wallet,
          permission: 'can_inject_float',
        },
        ...(isStaffAdvanceBetaEnabled
          ? [
              {
                id: 'advances' as PageId,
                label: 'Staff Advances',
                description: 'Disbursals & settlements',
                icon: HandCoins,
                badge: 'BETA',
                permission: 'can_disburse_advance' as const,
              },
            ]
          : []),
      ],
    },
    {
      title: 'MANAGEMENT',
      items: [
        {
          id: 'reports',
          label: 'Financial Reports',
          description: 'Tally, Advances & CA Pack',
          icon: FileSpreadsheet,
          permission: 'can_export_tally',
        },
        {
          id: 'staff',
          label: 'Staff Directory',
          description: 'Employees & PIN access',
          icon: Users,
          permission: 'can_manage_users_roles',
        },
        {
          id: 'settings',
          label: 'Shop Settings',
          description: 'Categories & brand rules',
          icon: SlidersHorizontal,
          permission: 'can_manage_periods',
        },
        ...(isPrivilegedAdminRole(user?.role_code)
          ? [
              {
                id: 'audit' as PageId,
                label: 'Security Log Book',
                description: 'Tamper-proof audit ledger',
                icon: ShieldCheck,
              },
            ]
          : []),
      ],
    },
  ];

  const isAllShowrooms = selectedBranchId === 'ALL';
  const currentBadgeCode = isAllShowrooms ? 'ALL' : activeBranch?.branch_code || 'ASI';
  const currentTitle = isAllShowrooms
    ? 'All Showrooms'
    : activeBranch?.branch_name || 'Asopalav - Satellite';
  const currentSubtitle = isAllShowrooms ? 'Combined Enterprise' : 'Active Showroom';

  const userInitials =
    user?.avatar_initials ||
    (user?.first_name
      ? `${user.first_name[0]}${user.last_name ? user.last_name[0] : ''}`.toUpperCase()
      : 'AD');

  const sessionRemainingText = getSessionTimeRemainingFormatted();

  /* ========================================================================= */
  /* DESKTOP SIDEBAR CONTENT (lg: screens and above)                           */
  /* ========================================================================= */
  const desktopSidebarContent = (
    <aside
      className={cn(
        'flex flex-col h-full select-none bg-[#fafafa] dark:bg-[#161616] border-r border-slate-200/80 dark:border-[#242424] text-slate-900 dark:text-[#EDEDED] font-sans transition-[width] duration-200 ease-out shrink-0',
        isSidebarCollapsed ? 'w-16' : 'w-[272px]'
      )}
    >
      {/* 1. TOP HEADER: ACTIVE SHOWROOM SELECTOR */}
      <div className="relative h-14 flex items-center border-b border-slate-200/80 dark:border-[#242424] shrink-0 bg-white dark:bg-[#141414]" ref={dropdownRef}>
        {!isSidebarCollapsed ? (
          <div className="w-full h-full flex items-center">
            <button
              type="button"
              onClick={() => {
                if (isBranchSwitcherEnabled) {
                  setIsBranchDropdownOpen(!isBranchDropdownOpen);
                }
              }}
              disabled={!isBranchSwitcherEnabled}
              aria-label={`Current active showroom: ${currentTitle}`}
              className={cn(
                'w-full h-full px-4 flex items-center justify-between transition-colors text-left group select-none',
                isBranchSwitcherEnabled
                  ? 'hover:bg-slate-50 dark:hover:bg-[#1c1c1c] cursor-pointer'
                  : 'cursor-default opacity-95'
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-[6px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-[#3ecf8e] flex items-center justify-center shrink-0">
                  <Store className="w-4 h-4" />
                </div>
                <div className="truncate min-w-0">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white tracking-tight truncate leading-tight font-sans">
                    {currentTitle}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] font-mono font-medium text-emerald-600 dark:text-[#3ecf8e] bg-emerald-500/10 px-1 py-0.2 rounded-[3px]">
                      {currentBadgeCode}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-[#8e8e8e] font-sans truncate leading-tight">
                      {currentSubtitle}
                    </span>
                  </div>
                </div>
              </div>
              {isBranchSwitcherEnabled && (
                <ChevronsUpDown
                  className={cn(
                    'w-3.5 h-3.5 text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white transition-transform duration-200 shrink-0 ml-1',
                    isBranchDropdownOpen && 'rotate-180 text-slate-900 dark:text-white'
                  )}
                />
              )}
            </button>

            {/* Branch Switcher Popup */}
            {isBranchDropdownOpen && isBranchSwitcherEnabled && (
              <div className="absolute left-0 top-full w-[272px] z-50 bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#2a2a2a] shadow-2xl overflow-hidden py-1 text-xs font-sans rounded-b-[8px]">
                <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
                  {canViewAll && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedBranchId('ALL');
                          setIsBranchDropdownOpen(false);
                        }}
                        className={cn(
                          'w-full flex items-center justify-between px-2.5 py-2 text-xs rounded-[6px] text-left transition-colors font-sans cursor-pointer',
                          selectedBranchId === 'ALL'
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] font-medium'
                            : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#222222]'
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-6 h-6 rounded-[4px] bg-emerald-500/10 text-emerald-600 dark:text-[#3ecf8e] flex items-center justify-center shrink-0">
                            <Store className="w-3.5 h-3.5" />
                          </div>
                          <div className="truncate">
                            <div className="font-medium text-slate-900 dark:text-[#ededed] tracking-tight truncate leading-tight">
                              All Showrooms
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-[#a1a1a1] leading-tight">
                              Combined View
                            </div>
                          </div>
                        </div>
                        {selectedBranchId === 'ALL' && (
                          <Check className="w-3.5 h-3.5 text-[#3ecf8e] shrink-0 stroke-[2.5]" />
                        )}
                      </button>
                      <div className="border-t border-slate-100 dark:border-[#262626] my-1" />
                    </>
                  )}

                  {allowedBranches.map((b) => {
                    const isSelected = b.branch_id === selectedBranchId;
                    return (
                      <button
                        key={b.branch_id}
                        type="button"
                        onClick={() => {
                          setSelectedBranchId(b.branch_id);
                          setIsBranchDropdownOpen(false);
                        }}
                        className={cn(
                          'w-full flex items-center justify-between px-2.5 py-2 text-xs rounded-[6px] text-left transition-colors font-sans cursor-pointer',
                          isSelected
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] font-medium'
                            : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#222222]'
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-6 h-6 rounded-[4px] bg-emerald-500/10 text-emerald-600 dark:text-[#3ecf8e] flex items-center justify-center shrink-0">
                            <Store className="w-3.5 h-3.5" />
                          </div>
                          <div className="truncate">
                            <div className="font-medium text-slate-900 dark:text-[#ededed] tracking-tight truncate leading-tight">
                              {b.branch_name}
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-[#a1a1a1] leading-tight">
                              {b.branch_code} · Active Showroom
                            </div>
                          </div>
                        </div>
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-[#3ecf8e] shrink-0 stroke-[2.5]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="w-full flex justify-center items-center h-full">
            <button
              type="button"
              onClick={() => {
                if (isBranchSwitcherEnabled) {
                  setIsBranchDropdownOpen(!isBranchDropdownOpen);
                }
              }}
              disabled={!isBranchSwitcherEnabled}
              className="w-8 h-8 rounded-[6px] bg-[#3ecf8e] text-[#171717] flex items-center justify-center font-bold text-xs font-mono tracking-tight mx-auto cursor-pointer shadow-xs hover:opacity-90 transition-opacity"
              title={`Active Showroom: ${currentTitle} (${currentBadgeCode})`}
            >
              {currentBadgeCode}
            </button>

            {/* Collapsed Flyout Dropdown */}
            {isBranchDropdownOpen && isBranchSwitcherEnabled && (
              <div className="absolute left-[calc(100%+4px)] top-1 w-64 z-50 rounded-[8px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#2a2a2a] shadow-2xl overflow-hidden py-1 text-xs font-sans animate-in fade-in zoom-in-95 duration-100">
                <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
                  {canViewAll && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedBranchId('ALL');
                          setIsBranchDropdownOpen(false);
                        }}
                        className={cn(
                          'w-full flex items-center justify-between px-2 py-1.5 text-xs rounded-[6px] text-left transition-colors font-sans cursor-pointer',
                          selectedBranchId === 'ALL'
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] font-medium'
                            : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#222222]'
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-6 h-6 rounded-[4px] bg-emerald-500/10 text-emerald-600 dark:text-[#3ecf8e] flex items-center justify-center shrink-0">
                            <Store className="w-3.5 h-3.5" />
                          </div>
                          <div className="truncate">
                            <div className="font-medium text-slate-900 dark:text-[#ededed] tracking-tight truncate leading-tight">
                              All Showrooms
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-[#a1a1a1] leading-tight">
                              Combined View
                            </div>
                          </div>
                        </div>
                        {selectedBranchId === 'ALL' && (
                          <Check className="w-3.5 h-3.5 text-[#3ecf8e] shrink-0 stroke-[2.5]" />
                        )}
                      </button>
                      <div className="border-t border-slate-100 dark:border-[#262626] my-1" />
                    </>
                  )}

                  {allowedBranches.map((b) => {
                    const isSelected = b.branch_id === selectedBranchId;
                    return (
                      <button
                        key={b.branch_id}
                        type="button"
                        onClick={() => {
                          setSelectedBranchId(b.branch_id);
                          setIsBranchDropdownOpen(false);
                        }}
                        className={cn(
                          'w-full flex items-center justify-between px-2 py-1.5 text-xs rounded-[6px] text-left transition-colors font-sans cursor-pointer',
                          isSelected
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] font-medium'
                            : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#222222]'
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-6 h-6 rounded-[4px] bg-emerald-500/10 text-emerald-600 dark:text-[#3ecf8e] flex items-center justify-center shrink-0">
                            <Store className="w-3.5 h-3.5" />
                          </div>
                          <div className="truncate">
                            <div className="font-medium text-slate-900 dark:text-[#ededed] tracking-tight truncate leading-tight">
                              {b.branch_name}
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-[#a1a1a1] leading-tight">
                              {b.branch_code} · Active Showroom
                            </div>
                          </div>
                        </div>
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-[#3ecf8e] shrink-0 stroke-[2.5]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. NAVIGATION SECTIONS & ITEMS */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {navSections.map((section, sIdx) => {
          const visibleItems = section.items.filter((item) => {
            if (!item.permission) return true;
            return can(item.permission);
          });

          if (visibleItems.length === 0) return null;

          return (
            <div key={sIdx} className={cn('space-y-1', sIdx > 0 && 'pt-3 border-t border-slate-200/60 dark:border-[#242424]')}>
              {!isSidebarCollapsed && (
                <div className="px-3 pb-1 text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-400 dark:text-[#707070]">
                  {section.title}
                </div>
              )}
              <div className="space-y-0.5">
                {visibleItems.map((item, iIdx) => {
                  const Icon = item.icon;
                  const isActive = activePage === item.id;

                  return (
                    <button
                      key={`${sIdx}-${iIdx}-${item.label}`}
                      onClick={() => {
                        setActivePage(item.id);
                        setMobileSidebarOpen(false);
                      }}
                      title={item.label}
                      aria-label={item.label}
                      className={cn(
                        'w-full flex items-center justify-between rounded-[6px] text-xs transition-colors font-sans cursor-pointer group select-none',
                        isSidebarCollapsed ? 'justify-center p-2 h-9' : 'px-3 py-2 h-9',
                        isActive
                          ? 'bg-emerald-500/10 dark:bg-[#3ecf8e]/15 text-emerald-800 dark:text-[#3ecf8e] font-semibold shadow-2xs'
                          : 'text-slate-700 dark:text-[#a1a1a1] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Icon
                          className={cn(
                            'w-4 h-4 shrink-0 transition-colors stroke-[1.8]',
                            isActive
                              ? 'text-emerald-600 dark:text-[#3ecf8e]'
                              : 'text-slate-400 dark:text-[#707070] group-hover:text-slate-900 dark:group-hover:text-white'
                          )}
                        />
                        {!isSidebarCollapsed && (
                          <span className="truncate text-xs font-medium font-sans">
                            {item.label}
                          </span>
                        )}
                      </div>
                      {!isSidebarCollapsed && item.badge && (
                        <kbd
                          className={cn(
                            'text-[10px] font-mono px-1.5 py-0.2 rounded-[4px] transition-colors border',
                            isActive
                              ? 'bg-emerald-500/15 text-emerald-800 dark:text-[#3ecf8e] font-semibold border-emerald-500/20'
                              : 'text-slate-400 dark:text-[#606060] group-hover:text-slate-600 dark:group-hover:text-[#a1a1a1] border-transparent'
                          )}
                        >
                          {item.badge}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. BOTTOM UTILITIES & USER PROFILE */}
      <div className="p-3 border-t border-slate-200/80 dark:border-[#242424] shrink-0 space-y-2 bg-white dark:bg-[#141414] relative">
        {/* COLLAPSED MODE: Avatar with rich floating Popover */}
        {isSidebarCollapsed ? (
          <div className="relative flex justify-center" ref={profilePopoverRef}>
            <button
              type="button"
              onClick={() => setIsProfilePopoverOpen(!isProfilePopoverOpen)}
              title={`${user?.first_name || 'Admin'} ${user?.last_name || ''} - Account & Security (4h Session: ${sessionRemainingText})`}
              aria-label="User Account Menu"
              className={cn(
                'w-9 h-9 rounded-full relative flex items-center justify-center cursor-pointer transition-all hover:ring-2 hover:ring-emerald-500/50',
                isProfilePopoverOpen && 'ring-2 ring-[#3ecf8e]'
              )}
            >
              <UserAvatar
                src={user?.avatar_url}
                firstName={user?.first_name}
                lastName={user?.last_name}
                name={user?.username}
                size={32}
                className="border border-emerald-500/40 shadow-xs"
              />
              {/* Online status indicator dot */}
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#3ecf8e] border-2 border-white dark:border-[#141414] rounded-full" />
            </button>

            {/* Collapsed Profile Flyout Popover */}
            {isProfilePopoverOpen && (
              <div className="absolute left-[calc(100%+8px)] bottom-0 z-50 w-64 bg-white dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#2e2e2e] rounded-[12px] shadow-2xl p-3.5 space-y-3 font-sans animate-in fade-in zoom-in-95 duration-150">
                {/* User Info Header */}
                <div className="flex items-center gap-2.5 pb-2.5 border-b border-slate-100 dark:border-[#262626]">
                  <UserAvatar
                    src={user?.avatar_url}
                    firstName={user?.first_name}
                    lastName={user?.last_name}
                    name={user?.username}
                    size={40}
                    className="border-2 border-[#3ecf8e] shadow-xs shrink-0"
                  />
                  <div className="truncate min-w-0">
                    <p className="text-xs font-semibold text-slate-900 dark:text-white leading-tight truncate">
                      {user?.first_name
                        ? `${user.first_name} ${user.last_name || ''}`.trim()
                        : user?.username || 'Admin'}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-[#8e8e8e] font-mono truncate mt-0.5">
                      {user?.role_code ? user.role_code.replace('_', ' ') : 'Super Admin'} · @{user?.username || 'admin'}
                    </p>
                  </div>
                </div>

                {/* 4-Hour Session Security Pill */}
                <div className="px-2.5 py-1.5 rounded-[6px] bg-slate-50 dark:bg-[#202020] border border-slate-200 dark:border-[#2e2e2e] flex items-center justify-between text-[11px] font-mono">
                  <div className="flex items-center gap-1.5 text-slate-600 dark:text-[#a1a1a1]">
                    <Clock className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>4h Session Active</span>
                  </div>
                  <span className="text-emerald-700 dark:text-[#3ecf8e] font-medium tabular-nums">{sessionRemainingText}</span>
                </div>

                {/* Popover Actions List */}
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      setActivePage('profile');
                      setIsProfilePopoverOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-[#242424] transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                      <span>My Profile & Security</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsProfilePopoverOpen(false);
                      lockScreen();
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-amber-50 dark:hover:bg-amber-950/30 hover:text-amber-700 dark:hover:text-amber-400 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                      <span>Lock Screen</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsProfilePopoverOpen(false);
                      setShortcutsModalOpen(true);
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-[#242424] transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Keyboard className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                      <span>Shortcuts</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsProfilePopoverOpen(false);
                      toggleSidebarCollapse();
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-[#242424] transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <AppSidebarExpandIcon className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                      <span>Expand Sidebar</span>
                    </div>
                  </button>
                </div>

                <div className="border-t border-slate-100 dark:border-[#262626] pt-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setIsProfilePopoverOpen(false);
                      logout();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* EXPANDED MODE: User Profile Card & Action Row */
          <div className="space-y-2">
            <button
              onClick={() => {
                setActivePage('profile');
              }}
              title={`${user?.first_name || 'Admin'} ${user?.last_name || ''} - My Profile & Security`}
              aria-label="My Profile & Security"
              className={cn(
                'w-full flex items-center p-2.5 rounded-[6px] text-xs transition-colors font-sans cursor-pointer group select-none border text-left',
                activePage === 'profile'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-[#3ecf8e]'
                  : 'bg-white dark:bg-[#1a1a1a] hover:bg-slate-100 dark:hover:bg-[#202020] border-slate-200/80 dark:border-[#282828] text-slate-800 dark:text-zinc-200'
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0 w-full">
                <UserAvatar
                  src={user?.avatar_url}
                  firstName={user?.first_name}
                  lastName={user?.last_name}
                  name={user?.username}
                  size={32}
                  className="border border-emerald-500/40 shrink-0 shadow-2xs"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-xs text-slate-900 dark:text-white truncate leading-tight group-hover:text-emerald-600 dark:group-hover:text-[#3ecf8e] transition-colors">
                    {user?.first_name
                      ? `${user.first_name} ${user.last_name || ''}`.trim()
                      : user?.username || 'Admin'}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-[#8e8e8e] font-mono truncate leading-tight mt-0.5 flex items-center justify-between">
                    <span>{user?.role_code ? user.role_code.replace('_', ' ') : 'Super Admin'}</span>
                    <span className="text-emerald-600 dark:text-[#3ecf8e] font-medium tabular-nums" title="4h Session Lifespan">
                      {sessionRemainingText}
                    </span>
                  </div>
                </div>
              </div>
            </button>

            {/* Quick Action Toolbar (6px square buttons) */}
            <div className="grid grid-cols-4 gap-1.5 pt-0.5">
              {/* Keyboard Shortcuts Trigger */}
              <button
                type="button"
                onClick={() => {
                  setShortcutsModalOpen(true);
                }}
                title="Keyboard Shortcuts"
                aria-label="Keyboard Shortcuts"
                className="h-8 rounded-[6px] bg-white dark:bg-[#1a1a1a] hover:bg-slate-100 dark:hover:bg-[#222222] border border-slate-200/80 dark:border-[#2a2a2a] text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                <Keyboard className="w-3.5 h-3.5 stroke-[1.8]" />
              </button>

              {/* Instant Lock Screen */}
              <button
                type="button"
                onClick={() => {
                  lockScreen();
                }}
                title="Lock Screen"
                aria-label="Lock Screen"
                className="h-8 rounded-[6px] bg-white dark:bg-[#1a1a1a] hover:bg-amber-50 dark:hover:bg-amber-950/20 border border-slate-200/80 dark:border-[#2a2a2a] text-slate-600 dark:text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400 flex items-center justify-center transition-colors cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5 stroke-[1.8]" />
              </button>

              {/* Theme Mode Toggle */}
              <button
                type="button"
                onClick={() => {
                  toggleTheme();
                }}
                title="Cycle Theme (Light / Dark)"
                aria-label="Toggle Theme"
                className="h-8 rounded-[6px] bg-white dark:bg-[#1a1a1a] hover:bg-slate-100 dark:hover:bg-[#222222] border border-slate-200/80 dark:border-[#2a2a2a] text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                {theme === 'light' ? (
                  <Sun className="w-3.5 h-3.5 text-amber-500" />
                ) : (
                  <Moon className="w-3.5 h-3.5 text-zinc-300" />
                )}
              </button>

              {/* Sign Out Trigger */}
              <button
                type="button"
                onClick={() => {
                  logout();
                }}
                title="Sign Out"
                aria-label="Sign Out"
                className="h-8 rounded-[6px] bg-white dark:bg-[#1a1a1a] hover:bg-rose-50 dark:hover:bg-rose-950/20 border border-slate-200/80 dark:border-[#2a2a2a] text-slate-600 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 flex items-center justify-center transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 stroke-[1.8]" />
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );

  /* ========================================================================= */
  /* NATIVE SLIDE-OVER MOBILE DRAWER (< lg)                                    */
  /* ========================================================================= */
  const mobileSlideOverDrawer = (
    <div className="lg:hidden fixed inset-0 z-50 flex select-none">
      {/* 1. Backdrop Overlay */}
      <div
        onClick={() => {
          setMobileSidebarOpen(false);
        }}
        className="fixed inset-0 bg-black/75 transition-opacity duration-200 animate-in fade-in"
      />

      {/* 2. Full-Screen Mobile Drawer Container */}
      <div className="relative w-full h-full bg-white dark:bg-[#141414] shadow-2xl flex flex-col overflow-hidden z-10 animate-in fade-in slide-in-from-bottom-2 duration-200">
        {/* Drawer Header */}
        <div className="h-13 px-4 flex items-center justify-between border-b border-slate-200/80 dark:border-[#242424] bg-[#fafafa] dark:bg-[#171717] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-[6px] bg-[#3ecf8e] text-[#171717] flex items-center justify-center shadow-xs shrink-0 font-bold font-mono text-xs">
              {currentBadgeCode}
            </div>
            <div className="min-w-0">
              <span className="text-xs font-semibold tracking-tight text-slate-900 dark:text-white font-sans truncate block">
                {brandName} ERP
              </span>
            </div>
          </div>

          {/* Close Button */}
          <button
            type="button"
            onClick={() => {
              setMobileSidebarOpen(false);
            }}
            aria-label="Close navigation menu"
            className="w-8 h-8 rounded-[6px] bg-slate-100 dark:bg-[#222222] hover:bg-slate-200 dark:hover:bg-[#2c2c2c] text-slate-700 dark:text-zinc-200 flex items-center justify-center transition-colors cursor-pointer border border-slate-200/80 dark:border-[#2e2e2e]"
          >
            <X className="w-4 h-4 stroke-[2]" />
          </button>
        </div>

        {/* Scrollable Navigation List */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {navSections.map((section, sIdx) => {
            const visibleItems = section.items.filter((item) => {
              if (!item.permission) return true;
              return can(item.permission);
            });

            if (visibleItems.length === 0) return null;

            return (
              <div key={sIdx} className={cn('space-y-0.5', sIdx > 0 && 'pt-2.5 mt-1 border-t border-slate-200/60 dark:border-[#242424]')}>
                <div className="px-2.5 pb-1 text-[11px] font-mono font-medium uppercase tracking-wider text-slate-400 dark:text-[#707070]">
                  {section.title}
                </div>
                <div className="space-y-0.5">
                  {visibleItems.map((item, iIdx) => {
                    const Icon = item.icon;
                    const isActive = activePage === item.id;

                    return (
                      <button
                        key={`m-${sIdx}-${iIdx}-${item.label}`}
                        onClick={() => {
                          setActivePage(item.id);
                          setMobileSidebarOpen(false);
                        }}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-2.5 rounded-[6px] text-xs transition-colors font-sans cursor-pointer',
                          isActive
                            ? 'bg-emerald-500/10 text-emerald-800 dark:text-[#3ecf8e] font-medium border border-emerald-500/20'
                            : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#202020]'
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-emerald-600 dark:text-[#3ecf8e]' : 'text-slate-400 dark:text-[#707070]')} />
                          <span className="truncate">{item.label}</span>
                        </div>
                        {item.badge && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-black/5 dark:bg-white/10 text-slate-500">
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Mobile Drawer Footer */}
        <div className="p-3 border-t border-slate-200/80 dark:border-[#242424] bg-[#fafafa] dark:bg-[#171717] space-y-2 shrink-0">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-[#3ecf8e] text-[#171717] font-mono font-bold text-[10px] flex items-center justify-center">
                {userInitials}
              </div>
              <span className="font-medium text-slate-800 dark:text-zinc-200 truncate">
                {user?.first_name || 'Admin'}
              </span>
            </div>
            <span className="text-[10px] font-mono text-emerald-600 dark:text-[#3ecf8e] tabular-nums">
              {sessionRemainingText}
            </span>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setMobileSidebarOpen(false);
                lockScreen();
              }}
              className="flex-1 h-8.5 rounded-[6px] bg-slate-100 dark:bg-[#222222] border border-slate-200/80 dark:border-[#2e2e2e] text-slate-700 dark:text-zinc-200 text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Lock Screen</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMobileSidebarOpen(false);
                logout();
              }}
              className="h-8.5 px-3.5 rounded-[6px] bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="hidden lg:block h-full shrink-0">
        {desktopSidebarContent}
      </div>
      {isMobileSidebarOpen && mobileSlideOverDrawer}
    </>
  );
};

export default Sidebar;
