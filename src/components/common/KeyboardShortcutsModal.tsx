import React, { useRef, useEffect, useMemo } from 'react';
import { useScrollLock } from '@/hooks/useScrollLock';
import { useUIStore, PageId } from '@/store/uiStore';
import { useAuthStore, isPrivilegedAdminRole } from '@/store/authStore';
import { animateModalOpen, animateModalClose } from '@/lib/animations';
import { Kbd } from '@/components/ui/Kbd';
import {
  Keyboard,
  X,
  Shield,
} from 'lucide-react';
import { AsopalavLogo } from '@/components/icons/AsopalavLogo';
import { RolePermissions } from '@/types/database';

interface ShortcutDefinition {
  label: string;
  description?: string;
  keys: string[];
  pageId?: PageId;
  actionId?: string;
  requiredPermission?: keyof RolePermissions;
  allowedRoles?: string[];
  action: () => void;
}

interface ShortcutCategory {
  title: string;
  items: ShortcutDefinition[];
}

export const KeyboardShortcutsModal: React.FC = () => {
  const {
    isShortcutsModalOpen,
    setShortcutsModalOpen,
    setActivePage,
    setSearchOpen,
    toggleSidebarCollapse,
  } = useUIStore();
  const { lockScreen, user, can } = useAuthStore();

  useScrollLock(isShortcutsModalOpen);

  const backdropRef = useRef<HTMLDivElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isShortcutsModalOpen) {
      animateModalOpen(modalRef.current, backdropRef.current);
    }
  }, [isShortcutsModalOpen]);

  const handleClose = () => {
    animateModalClose(modalRef.current, backdropRef.current, () => {
      setShortcutsModalOpen(false);
    });
  };

  const handleAction = (type: 'page' | 'action', val: string) => {
    handleClose();
    if (type === 'page') {
      setActivePage(val as PageId);
    } else if (val === 'search') {
      setSearchOpen(true);
    } else if (val === 'lock') {
      lockScreen();
    } else if (val === 'sidebar') {
      toggleSidebarCollapse();
    } else if (val === 'calculator') {
      useUIStore.getState().setCalculatorOpen(true);
    }
  };

  const userRole = user?.role_code || 'Cashier';
  const isSuperAdmin = isPrivilegedAdminRole(userRole);

  const roleLabelMap: Record<string, string> = {
    Super_Admin: 'Super Admin',
    Director: 'Director',
    Auditor: 'Auditor',
    Store_Manager: 'Store Manager',
    Cashier: 'Cashier',
  };

  const currentRoleName = roleLabelMap[userRole] || userRole.replace('_', ' ');

  const ALL_SHORTCUT_CATEGORIES: ShortcutCategory[] = useMemo(() => [
    {
      title: 'PRIMARY FUNCTION KEYS (F1 - F12)',
      items: [
        {
          label: 'F1 • Showroom Dashboard',
          description: 'Money & daily shop summary',
          keys: ['F1'],
          pageId: 'dashboard',
          allowedRoles: ['Super_Admin', 'Director', 'Store_Manager', 'Cashier', 'Auditor'],
          action: () => handleAction('page', 'dashboard'),
        },
        {
          label: 'F2 • Add Expense / Create Voucher',
          description: 'Enter new bill or voucher',
          keys: ['F2'],
          pageId: 'new-voucher',
          requiredPermission: 'can_create_voucher',
          allowedRoles: ['Super_Admin', 'Director', 'Store_Manager', 'Cashier'],
          action: () => handleAction('page', 'new-voucher'),
        },
        {
          label: 'F3 • All Expenses & Ledger',
          description: 'Search & filter all expense bills',
          keys: ['F3'],
          pageId: 'expenses',
          allowedRoles: ['Super_Admin', 'Director', 'Store_Manager', 'Cashier', 'Auditor'],
          action: () => handleAction('page', 'expenses'),
        },
        {
          label: 'F4 • Cash Drawer & UPI',
          description: 'Cash drawer till & passbook',
          keys: ['F4'],
          pageId: 'treasury',
          requiredPermission: 'can_inject_float',
          allowedRoles: ['Super_Admin', 'Director', 'Store_Manager'],
          action: () => handleAction('page', 'treasury'),
        },
        {
          label: 'F5 • Quick Calculator',
          description: 'Cash counting & discount calculator',
          keys: ['F5'],
          allowedRoles: ['Super_Admin', 'Director', 'Store_Manager', 'Cashier', 'Auditor'],
          action: () => handleAction('action', 'calculator'),
        },
        {
          label: 'F6 • Staff Directory & Roster',
          description: 'Employee list & PIN management',
          keys: ['F6'],
          pageId: 'staff',
          requiredPermission: 'can_manage_users_roles',
          allowedRoles: ['Super_Admin', 'Director'],
          action: () => handleAction('page', 'staff'),
        },
        {
          label: 'F7 • Staff Advances & Disbursals',
          description: 'Staff imprest loans & settlement',
          keys: ['F7'],
          pageId: 'advances',
          allowedRoles: ['Super_Admin', 'Director', 'Store_Manager', 'Cashier'],
          action: () => handleAction('page', 'advances'),
        },

        {
          label: 'F11 • Shop Settings & Catalogues',
          description: 'Expense categories & system rules',
          keys: ['F11'],
          pageId: 'settings',
          requiredPermission: 'can_manage_periods',
          allowedRoles: ['Super_Admin', 'Director'],
          action: () => handleAction('page', 'settings'),
        },
        {
          label: 'F12 • My Profile & PIN Security',
          description: 'Change quick-switch PIN & preferences',
          keys: ['F12'],
          pageId: 'profile',
          allowedRoles: ['Super_Admin', 'Director', 'Store_Manager', 'Cashier', 'Auditor'],
          action: () => handleAction('page', 'profile'),
        },
      ],
    },
    {
      title: 'EXPENSE ENTRY MODES & QUICK WORKFLOWS',
      items: [
        {
          label: 'Standard Vendor Bill Mode',
          description: 'Switch to vendor invoice disbursal',
          keys: ['Alt', '1'],
          pageId: 'new-voucher',
          requiredPermission: 'can_create_voucher',
          allowedRoles: ['Super_Admin', 'Director', 'Store_Manager', 'Cashier'],
          action: () => {
            handleAction('page', 'new-voucher');
            window.dispatchEvent(new CustomEvent('asopalav:set-voucher-mode', { detail: { mode: 'Shop_Vendor' } }));
          },
        },
        {
          label: 'Staff Multi-Allocation Mode',
          description: 'Switch to multi-staff expense reimbursement',
          keys: ['Alt', '2'],
          pageId: 'new-voucher',
          requiredPermission: 'can_create_voucher',
          allowedRoles: ['Super_Admin', 'Director', 'Store_Manager', 'Cashier'],
          action: () => {
            handleAction('page', 'new-voucher');
            window.dispatchEvent(new CustomEvent('asopalav:set-voucher-mode', { detail: { mode: 'Staff_Split' } }));
          },
        },
        {
          label: 'Courier Parcel Delivery Mode',
          description: 'Switch to courier docket payment mode',
          keys: ['Alt', '3'],
          pageId: 'new-voucher',
          requiredPermission: 'can_create_voucher',
          allowedRoles: ['Super_Admin', 'Director', 'Store_Manager', 'Cashier'],
          action: () => {
            handleAction('page', 'new-voucher');
            window.dispatchEvent(new CustomEvent('asopalav:set-voucher-mode', { detail: { mode: 'Courier' } }));
          },
        },
        {
          label: 'Jump to Staff Directory',
          description: 'Fast access to staff roster',
          keys: ['Alt', 'S'],
          pageId: 'staff',
          requiredPermission: 'can_manage_users_roles',
          allowedRoles: ['Super_Admin', 'Director'],
          action: () => handleAction('page', 'staff'),
        },
        {
          label: 'Jump to Shop Settings',
          description: 'Fast access to system settings',
          keys: ['Alt', 'M'],
          pageId: 'settings',
          requiredPermission: 'can_manage_periods',
          allowedRoles: ['Super_Admin', 'Director'],
          action: () => handleAction('page', 'settings'),
        },
      ],
    },
    {
      title: 'SYSTEM & COUNTER TOOLS',
      items: [
        {
          label: 'Instant Screen Lock',
          description: 'Locks screen requiring PIN to unlock',
          keys: ['Alt', 'L'],
          allowedRoles: ['Super_Admin', 'Director', 'Store_Manager', 'Cashier', 'Auditor'],
          action: () => handleAction('action', 'lock'),
        },
        {
          label: 'Global Command Palette Search',
          description: 'Universal search for bills, staff, and commands',
          keys: ['Ctrl', 'K'],
          allowedRoles: ['Super_Admin', 'Director', 'Store_Manager', 'Cashier', 'Auditor'],
          action: () => handleAction('action', 'search'),
        },
        {
          label: 'Toggle Sidebar Collapse',
          description: 'Expand or minimize left navigation bar',
          keys: ['Ctrl', 'B'],
          allowedRoles: ['Super_Admin', 'Director', 'Store_Manager', 'Cashier', 'Auditor'],
          action: () => handleAction('action', 'sidebar'),
        },
        {
          label: 'Open Shortcuts Cheatsheet',
          description: 'Open this keyboard shortcuts dialogue',
          keys: ['?'],
          allowedRoles: ['Super_Admin', 'Director', 'Store_Manager', 'Cashier', 'Auditor'],
          action: () => {},
        },
        {
          label: 'Close Active Popup / Window',
          description: 'Dismiss any modal, drawer, or dropdown',
          keys: ['Esc'],
          allowedRoles: ['Super_Admin', 'Director', 'Store_Manager', 'Cashier', 'Auditor'],
          action: handleClose,
        },
      ],
    },
  ], []);

  // Filter shortcut items strictly based on user role and permissions
  const isShortcutAllowedForUser = (item: ShortcutDefinition): boolean => {
    if (isSuperAdmin) return true;
    if (item.requiredPermission && !can(item.requiredPermission)) return false;
    if (item.allowedRoles && !item.allowedRoles.includes(userRole)) return false;
    return true;
  };

  const displayedCategories = useMemo(() => {
    return ALL_SHORTCUT_CATEGORIES.map((cat) => ({
      title: cat.title,
      items: cat.items.filter(isShortcutAllowedForUser),
    })).filter((cat) => cat.items.length > 0);
  }, [ALL_SHORTCUT_CATEGORIES, userRole, isSuperAdmin]);

  const totalAllowedShortcuts = useMemo(() => {
    return displayedCategories.reduce((sum, cat) => sum + cat.items.length, 0);
  }, [displayedCategories]);

  if (!isShortcutsModalOpen) return null;

  return (
    <div
      ref={backdropRef}
      onClick={handleClose}
      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 select-none font-sans"
    >
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-white dark:bg-[#1c1c1c] border border-slate-200 dark:border-[#2e2e2e] rounded-[12px] shadow-2xl overflow-hidden text-slate-900 dark:text-[#EDEDED] font-sans transition-all flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-[#2e2e2e] flex items-center justify-between bg-slate-50/50 dark:bg-[#141414]/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-[6px] bg-emerald-500/10 border border-emerald-500/20 text-[#3ecf8e] flex items-center justify-center">
              <Keyboard className="w-4 h-4 stroke-[2]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white font-sans">
                  Keyboard Shortcuts
                </h2>
                <span className="px-2 py-0.5 rounded-[4px] bg-[#3ecf8e]/10 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/20 text-[10px] font-mono font-medium flex items-center gap-1">
                  <Shield className="w-3 h-3 text-[#3ecf8e]" />
                  <span>{currentRoleName}</span>
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-7 h-7 flex items-center justify-center rounded-[6px] text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-[#242424] hover:bg-slate-200 dark:hover:bg-[#2c2c2c] transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Shortcuts Content (Only allowed items for the role) */}
        <div className="p-4 overflow-y-auto space-y-4 text-xs font-sans grow">
          {displayedCategories.map((group, idx) => (
            <div key={idx} className="space-y-1.5">
              <div className="px-2 text-[10px] font-mono font-semibold tracking-wider text-slate-400 dark:text-[#8e8e93] uppercase">
                {group.title}
              </div>

              <div className="rounded-[12px] border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.03] divide-y divide-black/[0.04] dark:divide-white/[0.05] overflow-hidden">
                {group.items.map((item, iIdx) => (
                  <div
                    key={iIdx}
                    onClick={() => item.action()}
                    className="flex items-center justify-between px-3.5 py-2.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors text-xs cursor-pointer ios-press"
                  >
                    <div>
                      <div className="text-slate-700 dark:text-zinc-200 font-medium font-sans flex items-center gap-1.5">
                        <span>{item.label}</span>
                      </div>
                      {item.description && (
                        <div className="text-[11px] text-slate-400 dark:text-[#707070] font-sans">
                          {item.description}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {item.keys.map((k, kIdx) => (
                        <Kbd key={kIdx} size="xs" className="rounded-[5px]">
                          {k}
                        </Kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-slate-200/70 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] flex items-center justify-between font-sans text-[11px] text-slate-500 dark:text-zinc-400 shrink-0">
          <span className="font-mono text-[10px] text-slate-400 dark:text-zinc-500">
            {totalAllowedShortcuts} active hotkeys for {currentRoleName}
          </span>
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400 dark:text-zinc-500">
            <AsopalavLogo size={12} className="shrink-0" />
            <span>Asopalav Enterprise</span>
          </div>
        </div>
      </div>
    </div>
  );
};
