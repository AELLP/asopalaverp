import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useScrollLock } from '@/hooks/useScrollLock';
import { useUIStore, PageId } from '@/store/uiStore';
import { useAuthStore, isPrivilegedAdminRole } from '@/store/authStore';
import { useBranchStore } from '@/store/branchStore';
import { searchEngine, SearchResultItem, SearchCategory } from '@/lib/searchEngine';
import { formatINR, formatVoucherNumber, cn } from '@/lib/utils';
import { animateModalOpen, animateModalClose } from '@/lib/animations';
import {
  Search,
  Receipt,
  Users,  HandCoins,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  FileSpreadsheet,
  Keyboard,  Wallet,  Database,  X,
  Bell,} from 'lucide-react';
import {
  AppTableIcon,} from '@/components/icons/AppIcons';
import { Kbd } from '@/components/ui/Kbd';
import { showToast } from '@/components/ui/ToastContainer';

export const GlobalSearchModal: React.FC = () => {
  const {
    isSearchOpen,
    setSearchOpen,
    setActivePage,
    openDrawer,
    setSettleTargetAdvance,    setShortcutsModalOpen,    isStaffAdvanceBetaEnabled,
  } = useUIStore();
  const { user, can } = useAuthStore();
  const { setSelectedBranchId, selectedBranchId } = useBranchStore();

  useScrollLock(isSearchOpen);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<SearchCategory>('all');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  
  const inputRef = useRef<HTMLInputElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeItemRef = useRef<HTMLDivElement | null>(null);

  const handleClose = useCallback(() => {
    animateModalClose(modalRef.current, backdropRef.current, () => {
      setSearchOpen(false);
    });
  }, [setSearchOpen]);

  // Preload search index and reset state when opened
  useEffect(() => {
    if (isSearchOpen) {
      setQuery('');
      setSelectedCategory('all');
      setSelectedIndex(0);
      searchEngine.preloadIndex();
      window.dispatchEvent(
        new CustomEvent('asopalav:dropdown-open', { detail: 'command-palette' })
      );
      animateModalOpen(modalRef.current, backdropRef.current);
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isSearchOpen]);

  // Search Engine Query Execution
  useEffect(() => {
    if (!isSearchOpen) return;

    let isCurrent = true;
    setIsLoading(true);

    searchEngine
      .search(query, {
        category: selectedCategory,
        branchId: selectedBranchId,
      })
      .then((res) => {
        if (!isCurrent) return;
        setResults(res.results);
        setSelectedIndex(0);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('Search error in modal:', err);
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [query, selectedCategory, selectedBranchId, isSearchOpen]);

  // Auto-scroll selected item into view
  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  // Close on outside dropdown events
  useEffect(() => {
    const handleGlobalDropdownOpen = (e: Event) => {
      const customEvt = e as CustomEvent<string>;
      if (customEvt.detail !== 'command-palette') {
        handleClose();
      }
    };
    window.addEventListener('asopalav:dropdown-open', handleGlobalDropdownOpen);
    return () => window.removeEventListener('asopalav:dropdown-open', handleGlobalDropdownOpen);
  }, [handleClose]);

  // Click outside to close
  useEffect(() => {
    if (!isSearchOpen) return;

    function handleOutsideClick(e: MouseEvent | TouchEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        handleClose();
      }
    }

    document.addEventListener('pointerdown', handleOutsideClick as any);
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick as any);
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isSearchOpen, handleClose]);

  // Direct Open Action Handler
  const handleExecuteResult = (item: SearchResultItem) => {
    handleClose();

    if (item.actionType === 'open_voucher' && item.rawItem) {
      openDrawer(item.rawItem);
      showToast({
        type: 'info',
        title: 'Opening Voucher',
        message: `Voucher #${formatVoucherNumber(item.rawItem.voucher_number)}`,
      });
    } else if (item.actionType === 'open_advance' && item.rawItem) {
      setSettleTargetAdvance(item.rawItem);
      showToast({
        type: 'info',
        title: 'Opening Staff Advance',
        message: `Advance #${item.rawItem.receipt_number} for ${item.rawItem.staff_name}`,
      });
    } else if (item.actionType === 'navigate' && item.actionPayload) {
      setActivePage(item.actionPayload.page);
    } else if (item.id.startsWith('cmd-branch-')) {
      const branchId = item.id.replace('cmd-branch-', '');
      setSelectedBranchId(branchId);
      showToast({
        type: 'success',
        title: 'Showroom Switched',
        message: `Active branch set to ${item.title}`,
      });
    } else {
      setActivePage('dashboard');
    }
  };

  // Master Default Studio Commands
  const defaultCommands: SearchResultItem[] = useMemo(() => {
    const list: (SearchResultItem & { perm?: any; betaOnly?: boolean })[] = [
      {
        id: 'cmd-switch-branch',
        category: 'master',
        title: 'Switch Branch Outlet...',
        categoryLabel: 'SHOP BRANCHES',
        subtitle: 'Switch active branch between Satellite, Flagship & All',
        badge: { text: 'Branch', variant: 'neutral' as const },
        relevanceScore: 110,
        actionType: 'navigate' as const,
        actionPayload: { page: 'settings' },
        perm: 'can_manage_periods',
      },
      {
        id: 'cmd-new-expense',
        category: 'vouchers',
        title: 'Add New Expense',
        categoryLabel: 'SHOP WORK',
        subtitle: 'Pay bill from cash box or shop UPI QR',
        relevanceScore: 100,
        actionType: 'navigate' as const,
        actionPayload: { page: 'new-voucher' },
        perm: 'can_create_voucher',
      },
      {
        id: 'cmd-cash-drawer',
        category: 'vouchers',
        title: 'Cash Drawer & UPI',
        categoryLabel: 'SHOP WORK',
        subtitle: 'Check cash in box, UPI balance & drawer passbook',
        relevanceScore: 90,
        actionType: 'navigate' as const,
        actionPayload: { page: 'treasury' },
        perm: 'can_inject_float',
      },
      {
        id: 'cmd-advances',
        category: 'advances',
        title: 'Staff Advances',
        categoryLabel: 'SHOP WORK',
        subtitle: 'Give staff advances & clear with bills or cash returns',
        relevanceScore: 85,
        actionType: 'navigate' as const,
        actionPayload: { page: 'advances' },
        perm: 'can_disburse_advance',
        betaOnly: true,
      },
      {
        id: 'cmd-ledger',
        category: 'vouchers',
        title: 'All Expenses',
        categoryLabel: 'RECORDS & REGISTERS',
        subtitle: 'Browse all shop expense bills with filters & export',
        relevanceScore: 80,
        actionType: 'navigate' as const,
        actionPayload: { page: 'expenses' },
      },
      {
        id: 'cmd-staff',
        category: 'staff',
        title: 'Staff Directory',
        categoryLabel: 'RECORDS & REGISTERS',
        subtitle: 'Manage staff logins, PINs & team members',
        relevanceScore: 75,
        actionType: 'navigate' as const,
        actionPayload: { page: 'staff' },
        perm: 'can_manage_users_roles',
      },
      {
        id: 'cmd-settings',
        category: 'master',
        title: 'Shop Settings',
        categoryLabel: 'SETTINGS & TEAM',
        subtitle: 'Set up branches, expense types & accounting locks',
        relevanceScore: 70,
        actionType: 'navigate' as const,
        actionPayload: { page: 'settings' },
        perm: 'can_manage_periods',
      },
      ...(isPrivilegedAdminRole(user?.role_code)
        ? [
            {
              id: 'cmd-audit',
              category: 'master' as const,
              title: 'Master Security Log Book',
              categoryLabel: 'SECURITY & GOVERNANCE',
              subtitle: 'Inspect real-time cryptographic audit trails and user activities',
              relevanceScore: 68,
              actionType: 'navigate' as const,
              actionPayload: { page: 'audit' as PageId },
            },
          ]
        : []),

      {
        id: 'cmd-shortcuts',
        category: 'actions',
        title: 'Keyboard Shortcuts',
        categoryLabel: 'SYSTEM & TOOLS',
        subtitle: 'View all keyboard shortcuts and function hotkeys',
        relevanceScore: 55,
        actionType: 'navigate' as const,
        actionPayload: { page: 'dashboard' },
      },
      {
        id: 'cmd-lock',
        category: 'actions',
        title: 'Lock Screen',
        categoryLabel: 'SYSTEM & TOOLS',
        subtitle: 'Instantly lock screen with PIN protection',
        relevanceScore: 50,
        actionType: 'navigate' as const,
        actionPayload: { page: 'dashboard' },
      },
    ];

    return list.filter((item) => {
      if (item.betaOnly && !isStaffAdvanceBetaEnabled) return false;
      if (item.perm && !can(item.perm)) return false;
      return true;
    });
  }, [user, can, isStaffAdvanceBetaEnabled]);

  // Display Items: either search results or default quick actions
  const displayItems = query.trim() ? results : defaultCommands;

  // Keyboard navigation inside modal
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (displayItems.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % displayItems.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (displayItems.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + displayItems.length) % displayItems.length);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (displayItems[selectedIndex]) {
        const item = displayItems[selectedIndex] as SearchResultItem;
        if (item.id === 'cmd-shortcuts') {
          handleClose();
          setShortcutsModalOpen(true);
        } else if (item.id === 'cmd-lock') {
          handleClose();
          useAuthStore.getState().lockScreen();
        } else {
          handleExecuteResult(item);
        }
      }
    }
  };

  // Group items by category for clear section headers
  const groupedSections = useMemo(() => {
    if (!query.trim()) {
      const groups: Record<string, SearchResultItem[]> = {};
      defaultCommands.forEach((item) => {
        const label = item.categoryLabel || 'COMMANDS';
        if (!groups[label]) groups[label] = [];
        groups[label].push(item);
      });
      return Object.entries(groups).map(([title, items]) => ({ title, items }));
    }

    const map = new Map<string, SearchResultItem[]>();
    displayItems.forEach((item) => {
      const sectionName =
        item.category === 'vouchers'
          ? 'EXPENSES & BILLS'
          : item.category === 'advances'
          ? 'STAFF ADVANCES'
          : item.category === 'staff'
          ? 'STAFF DIRECTORY'
          : item.category === 'master'
          ? 'SHOP SETTINGS'
          : 'ACTIONS & SHORTCUTS';

      if (!map.has(sectionName)) {
        map.set(sectionName, []);
      }
      map.get(sectionName)!.push(item as SearchResultItem);
    });

    return Array.from(map.entries()).map(([title, items]) => ({ title, items }));
  }, [query, displayItems, defaultCommands]);

  if (!isSearchOpen) return null;

  let itemCounter = 0;

  const getItemIcon = (item: SearchResultItem) => {
    if (item.id === 'cmd-switch-branch') return Sliders;
    if (item.id === 'cmd-new-expense') return Receipt;
    if (item.id === 'cmd-cash-drawer') return Wallet;
    if (item.id === 'cmd-advances') return HandCoins;
    if (item.id === 'cmd-reports' || item.actionPayload?.page === 'reports') return FileSpreadsheet;
    if (item.id === 'cmd-ledger') return AppTableIcon;
    if (item.id === 'cmd-staff') return Users;
    if (item.id === 'cmd-settings') return Sliders;
    if (item.id === 'cmd-audit') return ShieldCheck;
    if (item.id === 'cmd-notifications') return Bell;
    if (item.id === 'cmd-shortcuts') return Keyboard;
    if (item.id === 'cmd-lock') return ShieldAlert;

    if (item.category === 'vouchers') return Receipt;
    if (item.category === 'advances') return HandCoins;
    if (item.category === 'staff') return Users;
    if (item.category === 'master') return Database;
    return Search;
  };

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 select-none font-sans"
      onKeyDown={handleKeyDown}
    >
      <div
        ref={modalRef}
        className="w-full max-w-2xl bg-white dark:bg-[#1c1c1c] border border-slate-200 dark:border-[#2e2e2e] rounded-[12px] shadow-2xl overflow-hidden text-slate-900 dark:text-[#EDEDED] font-sans flex flex-col max-h-[85vh] transition-all my-auto"
      >
        {/* Top Search Input Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-200/80 dark:border-[#2e2e2e] bg-slate-50/50 dark:bg-[#141414]/50 shrink-0">
          <div className="flex-1 flex items-center gap-2.5 bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#2e2e2e] rounded-[6px] px-3 py-2">
            <Search className="w-4 h-4 text-slate-400 dark:text-[#707070] shrink-0 stroke-[2.2]" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search expenses, staff, cash box, or run a command..."
              className="w-full bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-[#707070] focus:outline-none font-sans"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                className="p-1 rounded-[4px] bg-slate-100 dark:bg-[#252525] hover:bg-slate-200 dark:hover:bg-[#2e2e2e] text-slate-600 dark:text-zinc-300 transition-colors cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <Kbd size="xs" className="shrink-0 hidden sm:inline-flex rounded-[6px]">ESC</Kbd>
        </div>

        {/* Scrollable Results List */}
        <div ref={listRef} className="overflow-y-auto max-h-[50vh] p-2 space-y-3">
          {groupedSections.map((sec) => (
            <div key={sec.title} className="space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 dark:text-[#8e8e93] px-3 pt-2 pb-0.5 font-semibold">
                {sec.title}
              </div>

              <div className="space-y-0.5">
                {sec.items.map((item) => {
                  const itemIdx = itemCounter++;
                  const isSelected = selectedIndex === itemIdx;
                  const Icon = getItemIcon(item as SearchResultItem);

                  return (
                    <div
                      key={item.id}
                      ref={isSelected ? activeItemRef : undefined}
                      onClick={() => {
                        if (item.id === 'cmd-shortcuts') {
                          handleClose();
                          setShortcutsModalOpen(true);
                        } else if (item.id === 'cmd-lock') {
                          handleClose();
                          useAuthStore.getState().lockScreen();
                        } else {
                          handleExecuteResult(item as SearchResultItem);
                        }
                      }}
                      onMouseEnter={() => setSelectedIndex(itemIdx)}
                      className={cn(
                        'px-3 py-2 rounded-[6px] flex items-center justify-between gap-3 text-xs transition-colors cursor-pointer select-none',
                        isSelected
                          ? 'bg-emerald-500/10 dark:bg-[#3ecf8e]/10 text-slate-900 dark:text-white font-medium border border-emerald-500/20 dark:border-[#3ecf8e]/20'
                          : 'text-slate-700 dark:text-[#a1a1a1] hover:bg-slate-100 dark:hover:bg-[#252525] hover:text-slate-900 dark:hover:text-white border border-transparent'
                      )}
                    >
                      {/* Left: Icon & Title */}
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className={cn(
                          "w-7 h-7 rounded-[6px] flex items-center justify-center shrink-0 transition-colors",
                          isSelected ? "bg-[#3ecf8e]/20 text-[#3ecf8e]" : "bg-slate-100 dark:bg-[#252525] text-slate-500 dark:text-[#8e8e93]"
                        )}>
                          <Icon className="w-3.5 h-3.5 stroke-[2]" />
                        </div>
                        <div className="truncate min-w-0">
                          <span className="font-medium text-xs truncate block font-sans">
                            {item.title}
                          </span>
                          {item.subtitle && !item.id.startsWith('cmd-') && (
                            <span className="text-[11px] text-slate-400 dark:text-[#8e8e93] truncate block font-sans">
                              {item.subtitle}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right: Shortcut Badge or Amount */}
                      <div className="flex items-center gap-2 shrink-0">
                        {item.amount !== undefined && item.amount > 0 && (
                          <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-[#3ecf8e] tabular-nums">
                            {formatINR(item.amount)}
                          </span>
                        )}

                        {item.badge && item.badge.text && (
                          <kbd className="px-1.5 py-0.5 rounded-[6px] bg-slate-100 dark:bg-[#252525] text-[10px] font-mono font-medium text-slate-500 dark:text-[#a1a1a1] border border-slate-200 dark:border-[#2e2e2e]">
                            {item.badge.text}
                          </kbd>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {displayItems.length === 0 && (
            <div className="py-12 text-center text-xs text-slate-400 dark:text-zinc-500 font-sans space-y-1">
              <Search className="w-5 h-5 mx-auto text-slate-300 dark:text-[#525252]" />
              <p>No commands or results found for "{query}"</p>
              <p className="text-[11px] text-slate-400 dark:text-[#707070]">
                Try searching for a voucher #, staff name, or press ESC.
              </p>
            </div>
          )}
        </div>

        {/* Minimalist Studio Command Footer */}
        <div className="px-4 py-2.5 border-t border-slate-200/80 dark:border-[#2e2e2e] bg-slate-50/70 dark:bg-[#141414] flex items-center justify-between text-[10px] font-mono text-slate-400 dark:text-[#8e8e93] shrink-0">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded-[4px] bg-slate-100 dark:bg-[#252525] border border-slate-200 dark:border-[#2e2e2e] text-[9px]">↑</kbd>
              <kbd className="px-1 py-0.5 rounded-[4px] bg-slate-100 dark:bg-[#252525] border border-slate-200 dark:border-[#2e2e2e] text-[9px]">↓</kbd>
              <span className="ml-0.5">navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded-[4px] bg-slate-100 dark:bg-[#252525] border border-slate-200 dark:border-[#2e2e2e] text-[9px]">↵</kbd>
              <span className="ml-0.5">select</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded-[4px] bg-slate-100 dark:bg-[#252525] border border-slate-200 dark:border-[#2e2e2e] text-[9px]">ESC</kbd>
              <span className="ml-0.5">close</span>
            </span>
            <span className="flex items-center gap-1 text-slate-400 dark:text-zinc-500 font-mono text-[10px]">
              <span>Asopalav Spotlight</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GlobalSearchModal;
