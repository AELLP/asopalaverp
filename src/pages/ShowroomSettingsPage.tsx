import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuthStore, isPrivilegedAdminRole } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { useVouchers } from '@/hooks/useVouchers';
import { useBranchStore } from '@/store/branchStore';
import { erpService } from '@/lib/erpService';
import {
  AccountingPeriod,
  CurrencyDenomination,
  AppRole,
  RolePermissions,  StaffMember,
  GstTaxRate,
} from '@/types/database';
import { formatINR, formatDate, cn, triggerHaptic } from '@/lib/utils';
import { MasterDataDrawer, MasterDrawerType } from '@/components/settings/MasterDataDrawer';
import { useNotificationStore } from '@/store/notificationStore';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/ToastContainer';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

import {
  Building2,
  Tags,
  Briefcase,
  Truck,
  Coins,
  Calendar,
  Lock,
  Unlock,
  Plus,
  Edit2,
  FileSpreadsheet,
  Check,
  Search,  X,
  Megaphone,
  Send,
  Trash2,
  Sparkles,
  Shield,  Users,  RefreshCw,
  LucideIcon,  HandCoins,  Percent,
  Copy,
} from 'lucide-react';

export type SettingsTabId =
  | 'periods'
  | 'branches'
  | 'categories'
  | 'departments'
  | 'couriers'
  | 'staff'
  | 'roles'
  | 'denominations'
  | 'gst_rates'
  | 'broadcasts'
  | 'features';

type TableDensity = 'compact' | 'normal' | 'relaxed';

interface SettingsTabMeta {
  id: SettingsTabId;
  name: string;
  group: 'SHOWROOM MASTER DATA';
  tableName?: string;
  icon: LucideIcon;
  description: string;
  drawerType?: MasterDrawerType;
  badge?: string;
}

const SETTINGS_TABS: SettingsTabMeta[] = [
  // SHOWROOM MASTER DATA GROUP (ERP Master Catalogues)
  {
    id: 'periods',
    name: 'Monthly Accounts Lock',
    group: 'SHOWROOM MASTER DATA',
    tableName: 'public.accounting_periods',
    icon: Calendar,
    description: 'Lock past months so expenses cannot be changed after auditing',
  },
  {
    id: 'branches',
    name: 'Shop Branches',
    group: 'SHOWROOM MASTER DATA',
    tableName: 'public.branches',
    icon: Building2,
    description: 'Showroom branch locations, cash box limits, and GST details',
    drawerType: 'branch',
  },
  {
    id: 'categories',
    name: 'Expense Categories',
    group: 'SHOWROOM MASTER DATA',
    tableName: 'public.expense_categories',
    icon: Tags,
    description: 'Types of expenses (Tea, Snacks, Travel, Electricity, Courier...)',
    drawerType: 'category',
  },
  {
    id: 'departments',
    name: 'Shop Departments',
    group: 'SHOWROOM MASTER DATA',
    tableName: 'public.departments',
    icon: Briefcase,
    description: 'Store sections and teams (Sales, Accounts, Housekeeping)',
    drawerType: 'department',
  },
  {
    id: 'couriers',
    name: 'Courier Partners',
    group: 'SHOWROOM MASTER DATA',
    tableName: 'public.courier_partners',
    icon: Truck,
    description: 'Parcel delivery partners, phone numbers, and tracking links',
    drawerType: 'courier',
  },
  {
    id: 'staff',
    name: 'Staff Directory',
    group: 'SHOWROOM MASTER DATA',
    tableName: 'public.staff_members',
    icon: Users,
    description: 'All showroom employees, staff codes, and assigned branch',
    drawerType: 'staff',
  },
  {
    id: 'roles',
    name: 'Roles & Permissions',
    group: 'SHOWROOM MASTER DATA',
    tableName: 'public.app_roles',
    icon: Shield,
    description: 'Who can do what (Cashier, Manager, Admin permissions)',
    drawerType: 'role',
  },
  {
    id: 'denominations',
    name: 'Cash Notes & Coins',
    group: 'SHOWROOM MASTER DATA',
    tableName: 'public.currency_denominations',
    icon: Coins,
    description: 'Currency notes (₹500, ₹200, ₹100...) and coins for cash counting',
  },
  {
    id: 'gst_rates',
    name: 'GST Tax Slabs',
    group: 'SHOWROOM MASTER DATA',
    tableName: 'public.gst_tax_rates',
    icon: Percent,
    description: 'Active GST slabs (5%, 12%, 18%, 28%) for vendor tax invoices',
  },
  {
    id: 'broadcasts',
    name: 'Shop Announcements',
    group: 'SHOWROOM MASTER DATA',
    tableName: 'public.system_broadcasts',
    icon: Megaphone,
    description: 'Show announcement banner to all showroom counters in real-time',
  },
  {
    id: 'features',
    name: 'Beta Features & Modules',
    group: 'SHOWROOM MASTER DATA',
    icon: Sparkles,
    badge: 'BETA',
    description: 'Activate or deactivate experimental showroom modules (e.g. Staff Advances)',
  },
];

function downloadBlob(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const ShowroomSettingsPage: React.FC = () => {
  const { user } = useAuthStore();
  const {
    setBulkImportOpen,
    setActivePage,
    isStaffAdvanceBetaEnabled,
    setStaffAdvanceBetaEnabled,
  } = useUIStore();
  const { branches, fetchBranchesAndWallets } = useBranchStore();
  const { categories, departments, couriers, refresh } = useVouchers();
  const { broadcast, setBroadcast } = useNotificationStore();

  // Active Tab State (Default to 'periods')
  const [activeTabId, setActiveTabId] = useState<SettingsTabId>('periods');
  const [density] = useState<TableDensity>('normal');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [isLoading, setIsLoading] = useState(false);

  // Data Stores
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [denominations, setDenominations] = useState<CurrencyDenomination[]>([]);
  const [gstRates, setGstRates] = useState<GstTaxRate[]>([]);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [permissions, setPermissions] = useState<RolePermissions[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);

  // Drawer / Modal Controls
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerType, setDrawerType] = useState<MasterDrawerType>('branch');
  const [selectedRecord, setSelectedRecord] = useState<any>(null);

  // Period Lock Modal State
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [targetPeriod, setTargetPeriod] = useState<AccountingPeriod | null>(null);
  const [lockReason, setLockReason] = useState('');
  const [isSubmittingLock, setIsSubmittingLock] = useState(false);

    // Broadcast Composer State
  const [broadcastBadge, setBroadcastBadge] = useState('NEW');
  const [broadcastMessage, setBroadcastMessage] = useState(broadcast?.message || '');
  const [broadcastLink, setBroadcastLink] = useState(broadcast?.link || '');
  const [customBadge, setCustomBadge] = useState('');
  const [isCustomBadge, setIsCustomBadge] = useState(false);
  const [isBroadcastPreviewOpen, setIsBroadcastPreviewOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Keyboard shortcut: Press "/" to focus search when inside master tables
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement !== searchInputRef.current &&
        !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fetch all supplementary master data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [p, d, r, perms, stf, g] = await Promise.all([
        erpService.getAccountingPeriods(),
        erpService.getCurrencyDenominations(),
        erpService.getAppRoles(),
        erpService.getAllRolePermissions(),
        erpService.getStaffMembers('ALL'),
        erpService.getGstTaxRates(false),
      ]);
      setPeriods(p || []);
      setDenominations(d || []);
      setRoles(r || []);
      setPermissions(perms || []);
      setStaffMembers(stf || []);
      setGstRates(g || []);
    } catch (err) {
      console.error('Failed to load master table records:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const isAuthorizedAdmin = isPrivilegedAdminRole(user?.role_code);

  useEffect(() => {
    if (isAuthorizedAdmin) {
      loadData();
    }
  }, [isAuthorizedAdmin, loadData]);

  // Sync broadcast state
  useEffect(() => {
    if (broadcast) {
      if (['NEW', 'ALERT', 'CLOSING', 'MAINTENANCE', 'UPDATE', 'NOTICE'].includes(broadcast.badge || 'NEW')) {
        setBroadcastBadge(broadcast.badge || 'NEW');
        setIsCustomBadge(false);
      } else {
        setBroadcastBadge('CUSTOM');
        setCustomBadge(broadcast.badge || '');
        setIsCustomBadge(true);
      }
      setBroadcastMessage(broadcast.message || '');
      setBroadcastLink(broadcast.link || '');
    }
  }, [broadcast]);

  // Active Tab Definition
  const currentTab = useMemo(
    () => SETTINGS_TABS.find((t) => t.id === activeTabId) || SETTINGS_TABS[0],
    [activeTabId]
  );

  // Table Row Counts for badges
  const counts: Record<SettingsTabId, number> = useMemo(
    () => ({
      brand: 1,
      print: 1,
      overrides: 8,
      periods: periods.length,
      branches: branches.length,
      categories: categories.length,
      departments: departments.length,
      couriers: couriers.length,
      staff: staffMembers.length,
      roles: roles.length,
      denominations: denominations.length,
      gst_rates: gstRates.length,
      broadcasts: broadcast?.message ? 1 : 0,
      features: isStaffAdvanceBetaEnabled ? 1 : 0,
    }),
    [periods, branches, categories, departments, couriers, staffMembers, roles, denominations, gstRates, broadcast, isStaffAdvanceBetaEnabled]
  );

  // Handlers for Master Data Drawer
  const handleOpenInsert = () => {
    if (!currentTab.drawerType) {
      toast.info(`Insert for ${currentTab.name} is configured via dedicated actions.`);
      return;
    }
    setSelectedRecord(null);
    setDrawerType(currentTab.drawerType);
    setDrawerOpen(true);
  };

  const handleOpenEdit = (record: any) => {
    if (!currentTab.drawerType) return;
    setSelectedRecord(record);
    setDrawerType(currentTab.drawerType);
    setDrawerOpen(true);
  };

  const handleDrawerSuccess = () => {
    setDrawerOpen(false);
    setSelectedRecord(null);
    loadData();
    refresh();
    fetchBranchesAndWallets(true);
  };

  // Period Lock Actions
  const handleOpenPeriodLockModal = (period: AccountingPeriod) => {
    setTargetPeriod(period);
    setLockReason(period.lock_reason || '');
    setLockModalOpen(true);
  };

  const handleConfirmToggleLock = async () => {
    if (!targetPeriod) return;
    setIsSubmittingLock(true);
    try {
      const willLock = !targetPeriod.is_locked;
      const userName = user ? `${user.first_name} ${user.last_name || ''}`.trim() : 'Store Manager';
      const reasonToUse = lockReason || (willLock ? 'Monthly Accounts Finalized & Audited' : 'Auditor Adjustment Request');
      
      await erpService.togglePeriodLock(
        targetPeriod.period_key,
        willLock,
        userName,
        reasonToUse,
        targetPeriod.start_date,
        targetPeriod.end_date
      );

      // Optimistic UI state update
      setPeriods((prev) =>
        prev.map((p) =>
          p.period_key === targetPeriod.period_key
            ? {
                ...p,
                is_locked: willLock,
                locked_at: willLock ? new Date().toISOString() : undefined,
                locked_by_name: willLock ? userName : undefined,
                lock_reason: willLock ? reasonToUse : undefined,
              }
            : p
        )
      );

      toast.success(`Accounting Period ${targetPeriod.period_key} ${willLock ? 'locked' : 'unlocked'}.`);
      setLockModalOpen(false);
      setTargetPeriod(null);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update accounting period lock. Please try again.');
      return;
    } finally {
      setIsSubmittingLock(false);
    }
  };

  // Broadcast Actions
  const handleSaveBroadcast = () => {
    if (!broadcastMessage.trim()) {
      toast.error('Broadcast message cannot be empty.');
      return;
    }

    if (broadcastLink.trim()) {
      try {
        const parsed = new URL(broadcastLink.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          toast.error('Broadcast links must use http:// or https:// protocol.');
          return;
        }
      } catch {
        toast.error('Please enter a valid URL for the broadcast link.');
        return;
      }
    }

    setIsBroadcastPreviewOpen(true);
  };

  const handleConfirmPublishBroadcast = () => {
    const finalBadge = isCustomBadge ? customBadge.trim().toUpperCase() || 'ANNOUNCEMENT' : broadcastBadge;
    setBroadcast({
      id: `BCAST-${Date.now()}`,
      badge: finalBadge,
      message: broadcastMessage.trim(),
      link: broadcastLink.trim() || undefined,
      created_at: new Date().toISOString(),
    });
    setIsBroadcastPreviewOpen(false);
    toast.success('Global system broadcast banner updated and published.');
  };

  const handleClearBroadcast = () => {
    setBroadcast(null);
    setBroadcastMessage('');
    setBroadcastLink('');
    setBroadcastBadge('NEW');
    setIsCustomBadge(false);
    toast.info('Global broadcast banner cleared.');
  };

  const [copiedGstSql, setCopiedGstSql] = useState(false);

  const handleCopyGstSql = () => {
    triggerHaptic();
    const sql = `-- =============================================================================
-- ASOPALAV ERP — GST TAX SLABS TABLE & DATA SEED FOR SUPABASE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gst_tax_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_percent NUMERIC(5,2) NOT NULL UNIQUE,
  rate_label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Safely add missing columns if table was created manually in Supabase Dashboard
ALTER TABLE public.gst_tax_rates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.gst_tax_rates ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.gst_tax_rates ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;
ALTER TABLE public.gst_tax_rates ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

ALTER TABLE public.gst_tax_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS \"Allow all access to gst_tax_rates\" ON public.gst_tax_rates;
DROP POLICY IF EXISTS \"Allow read access to gst_tax_rates\" ON public.gst_tax_rates;
DROP POLICY IF EXISTS \"Allow write access to gst_tax_rates\" ON public.gst_tax_rates;

CREATE POLICY \"Allow all access to gst_tax_rates\"
  ON public.gst_tax_rates FOR ALL
  TO public, anon, authenticated, service_role
  USING (true)
  WITH CHECK (true);

GRANT ALL ON public.gst_tax_rates TO anon, authenticated, service_role;

INSERT INTO public.gst_tax_rates (rate_percent, rate_label, is_active, display_order)
VALUES
  (5.00, '5% (Fabric & Saree Alterations)', true, 1),
  (12.00, '12% (Readymade Apparel & Packaging)', true, 2),
  (18.00, '18% (Standard Services & Repairs)', true, 3),
  (28.00, '28% (Luxury Goods & Special GTA)', true, 4)
ON CONFLICT (rate_percent) DO UPDATE 
SET rate_label = EXCLUDED.rate_label,
    is_active = EXCLUDED.is_active,
    display_order = EXCLUDED.display_order;
`;
    navigator.clipboard.writeText(sql);
    setCopiedGstSql(true);
    setTimeout(() => setCopiedGstSql(false), 2500);
    toast.success('Setup code copied to clipboard!');
  };

  const handleToggleGstRate = async (rate: GstTaxRate) => {
    const nextStatus = !rate.is_active;
    const userName = user ? `${user.first_name} ${user.last_name || ''}`.trim() : 'Store Manager';
    const ok = await erpService.toggleGstRateStatus(rate.id, nextStatus, userName, user?.role_code || 'Super_Admin');
    if (ok) {
      setGstRates((prev) => prev.map((r) => (r.id === rate.id ? { ...r, is_active: nextStatus } : r)));
      toast.success(`${rate.rate_percent}% GST slab is now ${nextStatus ? 'Active (Visible in POS)' : 'Disabled (Hidden from App)'}`);
    } else {
      toast.error('Failed to update GST rate setting. Please try again.');
    }
  };

  const escapeCsvField = (value: string | number | boolean | null | undefined): string => {
    const str = String(value ?? '');
    // Escape spreadsheet formula injection characters
    if (/^[=+\-@|\t\r]/.test(str)) {
      return `"'${str.replace(/"/g, '""')}"`;
    }
    // Standard CSV escaping
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Export handlers
      // Filtering data rows
  const filteredPeriods = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return periods.filter((p) => {
      if (statusFilter === 'active' && p.is_locked) return false;
      if (statusFilter === 'inactive' && !p.is_locked) return false;
      if (!q) return true;
      return (
        p.period_key.toLowerCase().includes(q) ||
        (p.lock_reason || '').toLowerCase().includes(q) ||
        (p.locked_by_name || '').toLowerCase().includes(q)
      );
    });
  }, [periods, searchQuery, statusFilter]);

  const filteredBranches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return branches.filter((b) => {
      if (statusFilter === 'active' && !b.is_active) return false;
      if (statusFilter === 'inactive' && b.is_active) return false;
      if (!q) return true;
      return (
        b.branch_name.toLowerCase().includes(q) ||
        b.branch_code.toLowerCase().includes(q) ||
        b.city.toLowerCase().includes(q) ||
        (b.gstin || '').toLowerCase().includes(q)
      );
    });
  }, [branches, searchQuery, statusFilter]);

  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return categories.filter((c) => {
      if (statusFilter === 'active' && !c.is_active) return false;
      if (statusFilter === 'inactive' && c.is_active) return false;
      if (!q) return true;
      return (
        c.category_name.toLowerCase().includes(q) ||
        (c.color_theme || '').toLowerCase().includes(q)
      );
    });
  }, [categories, searchQuery, statusFilter]);

  const filteredDepartments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return departments.filter((d) => {
      if (statusFilter === 'active' && !d.is_active) return false;
      if (statusFilter === 'inactive' && d.is_active) return false;
      if (!q) return true;
      return (
        d.department_name.toLowerCase().includes(q) ||
        d.department_code.toLowerCase().includes(q)
      );
    });
  }, [departments, searchQuery, statusFilter]);

  const filteredCouriers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return couriers.filter((cr) => {
      if (statusFilter === 'active' && !cr.is_active) return false;
      if (statusFilter === 'inactive' && cr.is_active) return false;
      if (!q) return true;
      return (
        cr.partner_name.toLowerCase().includes(q) ||
        cr.partner_code.toLowerCase().includes(q) ||
        (cr.contact_phone || '').includes(q)
      );
    });
  }, [couriers, searchQuery, statusFilter]);

  const filteredStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return staffMembers.filter((s) => {
      if (statusFilter === 'active' && !s.is_active) return false;
      if (statusFilter === 'inactive' && s.is_active) return false;
      if (!q) return true;
      return (
        s.first_name.toLowerCase().includes(q) ||
        (s.last_name || '').toLowerCase().includes(q) ||
        s.staff_code.toLowerCase().includes(q) ||
        (s.department_name || '').toLowerCase().includes(q) ||
        (s.branch_code || '').toLowerCase().includes(q)
      );
    });
  }, [staffMembers, searchQuery, statusFilter]);

  const filteredRoles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return roles.filter((r) => {
      if (!q) return true;
      return (
        r.role_title.toLowerCase().includes(q) ||
        r.role_code.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q)
      );
    });
  }, [roles, searchQuery]);

  const filteredDenominations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return denominations.filter((dn) => {
      if (statusFilter === 'active' && !dn.is_active) return false;
      if (statusFilter === 'inactive' && dn.is_active) return false;
      if (!q) return true;
      return (
        dn.display_label.toLowerCase().includes(q) ||
        dn.denomination_value.toString().includes(q)
      );
    });
  }, [denominations, searchQuery, statusFilter]);

  const filteredGstRates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return gstRates.filter((g) => {
      if (statusFilter === 'active' && !g.is_active) return false;
      if (statusFilter === 'inactive' && g.is_active) return false;
      if (!q) return true;
      return (
        g.rate_label.toLowerCase().includes(q) ||
        g.rate_percent.toString().includes(q)
      );
    });
  }, [gstRates, searchQuery, statusFilter]);

  const currentFilteredCount = useMemo(() => {
    switch (activeTabId) {
      case 'periods':
        return filteredPeriods.length;
      case 'branches':
        return filteredBranches.length;
      case 'categories':
        return filteredCategories.length;
      case 'departments':
        return filteredDepartments.length;
      case 'couriers':
        return filteredCouriers.length;
      case 'staff':
        return filteredStaff.length;
      case 'roles':
        return filteredRoles.length;
      case 'denominations':
        return filteredDenominations.length;
      case 'gst_rates':
        return filteredGstRates.length;
      case 'broadcasts':
        return broadcast ? 1 : 0;
      default:
        return counts[activeTabId] || 1;
    }
  }, [
    activeTabId,
    filteredPeriods,
    filteredBranches,
    filteredCategories,
    filteredDepartments,
    filteredCouriers,
    filteredStaff,
    filteredRoles,
    filteredDenominations,
    filteredGstRates,
    broadcast,
    counts,
  ]);

  // Check if active tab is a Master Data table that has a data grid
  const isMasterDataTable = [
    'periods',
    'branches',
    'categories',
    'departments',
    'couriers',
    'staff',
    'roles',
    'denominations',
    'gst_rates',
  ].includes(activeTabId);

  // Density padding classes
  const densityClasses = {
    compact: 'py-2 px-3 text-xs',
    normal: 'py-2.5 px-3.5 text-xs',
    relaxed: 'py-3.5 px-4 text-sm',
  }[density];

  if (!isAuthorizedAdmin) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] bg-white dark:bg-[#141414] text-slate-900 dark:text-[#EDEDED] flex flex-col items-center justify-center p-6 text-center font-sans select-none">
        <div className="max-w-md w-full p-8 rounded-[12px] bg-slate-50 dark:bg-[#181818] border border-slate-200 dark:border-[#282828] shadow-2xl space-y-5">
          <div className="w-14 h-14 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto text-rose-500">
            <Lock className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <span className="px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-700 dark:text-rose-300 text-[10px] font-mono font-medium">
              HTTP 403 FORBIDDEN
            </span>
            <h1 className="text-xl font-medium tracking-tight text-slate-900 dark:text-white font-sans">
              Settings Access Restricted
            </h1>
            <p className="text-xs text-slate-500 dark:text-[#888888] leading-relaxed">
              Showroom configuration and master data catalogues are restricted to <strong>Super Admin</strong> and <strong>Developer</strong> accounts.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActivePage('dashboard')}
            className="w-full py-2.5 px-4 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] text-xs font-semibold font-sans flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-xs"
          >
            <span>Return to Safe Dashboard</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex-1 flex flex-col bg-white dark:bg-[#141414] text-slate-900 dark:text-[#EDEDED] font-sans antialiased selection:bg-[#3ecf8e]/20 selection:text-[#3ecf8e] select-none">
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & UNIFIED SMART SECTION SELECTOR                            */}
      {/* ========================================================================= */}
      <div className="border-b border-slate-200 dark:border-[#282828] bg-white dark:bg-[#141414] px-4 sm:px-6 lg:px-8 py-3.5 relative z-30">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[6px] bg-[#3ecf8e]/10 border border-[#3ecf8e]/30 flex items-center justify-center text-[#3ecf8e] shadow-2xs">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-semibold tracking-tight text-slate-900 dark:text-white font-sans">
                  Showroom Settings &amp; Catalogues
                </h1>
              </div>
              <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans hidden sm:block">
                Centralized ERP configuration, master catalogues, branch settings, and system rules
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Unified Smart Section Dropdown */}
            <div className="relative min-w-[260px] z-30">
              <SearchableSelect
                options={SETTINGS_TABS.map((t) => ({
                  value: t.id,
                  label: t.name,
                  badge: counts[t.id] !== undefined ? `${counts[t.id]} items` : undefined,
                }))}
                value={activeTabId}
                onChange={(val: string) => {
                  setActiveTabId(val as SettingsTabId);
                  setSearchQuery('');
                }}
                searchPlaceholder="Switch section..."
                allowCustom={false}
              />
            </div>

            <span className="text-[10px] font-mono text-[#3ecf8e] bg-emerald-500/10 px-2.5 py-1.5 rounded-full border border-[#3ecf8e]/30 font-medium shrink-0 hidden md:inline">
              Admin Protected
            </span>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. MAIN FULL-WIDTH WORKSPACE                                              */}
      {/* ========================================================================= */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-white dark:bg-[#141414]">
        {/* Main Pane Header */}
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-5 border-b border-slate-200 dark:border-[#282828]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg sm:text-xl font-medium tracking-tight text-slate-900 dark:text-white font-sans flex items-center gap-2.5">
                <currentTab.icon className="w-5 h-5 text-[#3ecf8e]" />
                <span>{currentTab.name}</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-[#888888] font-sans mt-1">
                {currentTab.description}
              </p>
            </div>

              {/* Master Data Header Actions */}
              {isMasterDataTable && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      loadData();
                      refresh();
                      toast.info('Refreshing records...');
                    }}
                    disabled={isLoading}
                    className="h-8.5 w-8.5 flex items-center justify-center rounded-[6px] border border-slate-200 dark:border-[#282828] bg-white dark:bg-[#1a1a1a] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-[#EDEDED] transition-all cursor-pointer shadow-xs"
                    title="Refresh Records"
                  >
                    <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin text-[#3ecf8e]')} />
                  </button>

                  {/* Bulk Import */}
                  {['branches', 'categories', 'departments', 'couriers', 'staff'].includes(activeTabId) && (
                    <button
                      type="button"
                      onClick={() => setBulkImportOpen(true, activeTabId as any)}
                      className="h-8.5 px-3 py-1.5 rounded-[6px] border border-slate-200 dark:border-[#282828] bg-white dark:bg-[#1a1a1a] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-[#EDEDED] text-xs font-medium font-sans flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-[#3ecf8e]" />
                      <span>Import CSV</span>
                    </button>
                  )}

                  {/* Add Record Primary CTA */}
                  {currentTab.drawerType && (
                    <button
                      type="button"
                      onClick={handleOpenInsert}
                      className="h-8.5 px-3.5 py-1.5 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] text-xs font-semibold font-sans flex items-center gap-1.5 transition-all cursor-pointer shadow-xs select-none"
                    >
                      <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Add Record</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Main Pane Body Container */}
          <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6 flex-1">

            {/* =================================================================== */}
            {/* VIEW 1: GLOBAL BROADCAST COMPOSER                                   */}
            {/* =================================================================== */}
            {activeTabId === 'broadcasts' && (
              <div className="max-w-3xl space-y-6 rounded-[12px] bg-white dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#2e2e2e] p-6 shadow-xs animate-in fade-in">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-[8px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    <Megaphone className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-[#EDEDED]">
                      Global System Broadcast Banner
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-[#808080]">
                      Broadcast real-time notices, closing alerts, or system maintenance messages to all showroom counters.
                    </p>
                  </div>
                </div>

                {/* Counter Preview */}
                <div className="space-y-2">
                  <label className="text-xs font-mono text-slate-500 dark:text-[#808080] uppercase tracking-wider">
                    Counter Preview
                  </label>
                  <div className="flex items-center gap-3 px-4 py-2.5 rounded-[6px] bg-slate-50 dark:bg-[#121212] border border-slate-200 dark:border-[#2a2a2a] text-xs">
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 font-mono text-[10px] font-semibold tracking-wider">
                      {isCustomBadge ? customBadge || 'CUSTOM' : broadcastBadge}
                    </span>
                    <span className="text-slate-900 dark:text-[#EDEDED] flex-1">
                      {broadcastMessage || 'Showroom notice message will appear here for all showroom counters.'}
                    </span>
                  </div>
                </div>

                {/* Form Controls */}
                <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-[#242424]">
                  <div className="space-y-1.5">
                    <label className="text-xs font-mono text-slate-900 dark:text-[#EDEDED]">Badge Tag</label>
                    <div className="flex flex-wrap items-center gap-2">
                      {['NEW', 'ALERT', 'CLOSING', 'MAINTENANCE', 'UPDATE', 'NOTICE'].map((badge) => (
                        <button
                          key={badge}
                          type="button"
                          onClick={() => {
                            setBroadcastBadge(badge);
                            setIsCustomBadge(false);
                          }}
                          className={cn(
                            'px-2.5 py-1 rounded-[4px] text-xs font-mono transition-colors cursor-pointer border',
                            !isCustomBadge && broadcastBadge === badge
                              ? 'bg-[#3ecf8e]/10 text-emerald-700 dark:text-[#3ecf8e] border-[#3ecf8e]/30 font-semibold'
                              : 'bg-white dark:bg-[#121212] text-slate-600 dark:text-[#808080] border-slate-200 dark:border-[#262626] hover:text-slate-900 dark:hover:text-[#EDEDED]'
                          )}
                        >
                          {badge}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-mono text-slate-900 dark:text-[#EDEDED]">
                      Broadcast Message *
                    </label>
                    <textarea
                      rows={3}
                      value={broadcastMessage}
                      onChange={(e) => setBroadcastMessage(e.target.value)}
                      placeholder="e.g. Month-end closing scheduled tonight at 9:30 PM. All pending petty vouchers must be cleared."
                      className="w-full px-3 py-2 rounded-[6px] bg-white dark:bg-[#121212] border border-slate-200 dark:border-[#262626] text-xs text-slate-900 dark:text-[#EDEDED] focus:border-[#3ecf8e] focus:outline-none leading-relaxed"
                    />
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleSaveBroadcast}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-[6px] bg-[#3ecf8e] text-[#171717] hover:bg-[#24b47e] text-xs font-semibold shadow-xs transition-all cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Publish Broadcast</span>
                    </button>
                    {broadcast?.message && (
                      <button
                        type="button"
                        onClick={handleClearBroadcast}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-[6px] border border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 text-xs font-medium transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Clear Banner</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* =================================================================== */}
            {/* VIEW 3.5: BETA FEATURES & EXPERIMENTAL MODULE FLAGS                */}
            {/* =================================================================== */}
            {activeTabId === 'features' && (
              <div className="space-y-6 max-w-4xl animate-in fade-in">
                {/* Information Header Banner */}
                <div className="p-4 rounded-[8px] bg-amber-500/5 dark:bg-[#1a1712] border border-amber-500/20 text-xs space-y-1.5">
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-semibold">
                    <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                    <span>Experimental Feature Controls (Private Beta)</span>
                  </div>
                  <p className="text-slate-600 dark:text-zinc-400 leading-relaxed font-sans">
                    Modules in beta mode are kept strictly inactive for standard cashiers to ensure 100% mathematical zero-tolerance reconciliation. You can test and toggle them on/off here anytime.
                  </p>
                </div>

                {/* Feature Toggle Cards */}
                <div className="space-y-4">
                  {/* Card 1: Staff Advances Module */}
                  <div className="p-5 rounded-[12px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] shadow-xs space-y-4 transition-all">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div className="flex items-start gap-3.5">
                        <div className={cn(
                          'w-10 h-10 rounded-[8px] flex items-center justify-center shrink-0 border transition-colors',
                          isStaffAdvanceBetaEnabled
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                            : 'bg-slate-100 dark:bg-[#202020] border-slate-200 dark:border-[#2e2e2e] text-slate-400'
                        )}>
                          <HandCoins className="w-5 h-5 stroke-[2]" />
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-white font-sans">
                              Staff Advances &amp; Salary Disbursals
                            </h3>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                              BETA MODULE
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans leading-relaxed max-w-xl">
                            Enables employee petty cash requests, advance float disbursements, and salary deduction tracking. When deactivated, the Staff Advances page and navigation shortcuts are hidden from cashier screens.
                          </p>
                        </div>
                      </div>

                      {/* Interactive Toggle Button */}
                      <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => {
                            setStaffAdvanceBetaEnabled(!isStaffAdvanceBetaEnabled);
                          }}
                          className={cn(
                            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#3ecf8e] focus:ring-offset-2 dark:focus:ring-offset-[#141414]',
                            isStaffAdvanceBetaEnabled ? 'bg-[#3ecf8e]' : 'bg-slate-300 dark:bg-[#333333]'
                          )}
                          role="switch"
                          aria-checked={isStaffAdvanceBetaEnabled}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out',
                              isStaffAdvanceBetaEnabled ? 'translate-x-5' : 'translate-x-0'
                            )}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Status Ribbon & Direct Jump */}
                    <div className="pt-3 border-t border-slate-100 dark:border-[#262626] flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 text-slate-500 dark:text-zinc-400 font-mono text-[11px]">
                        <span
                          className={cn(
                            'w-2 h-2 rounded-full',
                            isStaffAdvanceBetaEnabled ? 'bg-[#3ecf8e] animate-pulse' : 'bg-slate-400'
                          )}
                        />
                        <span>Status: {isStaffAdvanceBetaEnabled ? 'Active (Visible to users)' : 'Inactive (Hidden in navigation)'}</span>
                      </div>

                      {isStaffAdvanceBetaEnabled && (
                        <button
                          type="button"
                          onClick={() => setActivePage('advances')}
                          className="px-3 py-1.5 rounded-[6px] bg-slate-900 dark:bg-white text-white dark:text-black font-medium text-xs hover:opacity-90 transition-opacity flex items-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <HandCoins className="w-3.5 h-3.5" />
                          <span>Open Staff Advances Console</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* =================================================================== */}
            {/* VIEW 4: MASTER CATALOGUE DATA TABLES (GRID & DDL)                   */}
            {/* =================================================================== */}
            {isMasterDataTable && (
              <div className="space-y-4 animate-in fade-in">
                {/* Master Table Filter Controls */}
                <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-slate-50 dark:bg-[#171717] p-2.5 rounded-[8px] border border-slate-200 dark:border-[#242424]">
                  {/* Search input */}
                  <div className="relative flex-1 min-w-[260px] max-w-lg">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-[#707070]" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={`Filter ${currentTab.name}...`}
                      className="w-full h-10 min-h-[40px] pl-9 pr-12 rounded-[6px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] text-xs text-slate-900 dark:text-[#EDEDED] placeholder-slate-400 dark:placeholder-[#606060] focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 font-mono transition-colors shadow-2xs"
                    />
                    {searchQuery ? (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900 dark:hover:text-[#EDEDED] cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-mono border border-slate-200 dark:border-[#262626] px-1 py-0.2 rounded-[3px] pointer-events-none">
                        /
                      </span>
                    )}
                  </div>

                  {/* Status Filter */}
                  <div className="flex items-center bg-slate-100 dark:bg-[#141414] p-0.5 rounded-[6px] border border-slate-200 dark:border-[#262626]">
                    <button
                      type="button"
                      onClick={() => setStatusFilter('all')}
                      className={cn(
                        'px-2 py-1 rounded-[4px] text-[11px] font-mono transition-colors cursor-pointer',
                        statusFilter === 'all'
                          ? 'bg-white dark:bg-[#222222] text-slate-900 dark:text-[#EDEDED] font-medium shadow-xs'
                          : 'text-slate-500 dark:text-[#707070] hover:text-slate-900 dark:hover:text-[#EDEDED]'
                      )}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusFilter('active')}
                      className={cn(
                        'px-2 py-1 rounded-[4px] text-[11px] font-mono transition-colors cursor-pointer',
                        statusFilter === 'active'
                          ? 'bg-white dark:bg-[#222222] text-emerald-600 dark:text-emerald-400 font-medium shadow-xs'
                          : 'text-slate-500 dark:text-[#707070] hover:text-emerald-600 dark:hover:text-emerald-400'
                      )}
                    >
                      {activeTabId === 'periods' ? 'Open' : 'Active'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusFilter('inactive')}
                      className={cn(
                        'px-2 py-1 rounded-[4px] text-[11px] font-mono transition-colors cursor-pointer',
                        statusFilter === 'inactive'
                          ? 'bg-white dark:bg-[#222222] text-amber-600 dark:text-amber-400 font-medium shadow-xs'
                          : 'text-slate-500 dark:text-[#707070] hover:text-amber-600 dark:hover:text-amber-400'
                      )}
                    >
                      {activeTabId === 'periods' ? 'Locked' : 'Inactive'}
                    </button>
                  </div>
                </div>

                {/* GST Slabs Supabase Status Banner */}
                {activeTabId === 'gst_rates' && (
                  <div className="p-3.5 rounded-[8px] bg-slate-50 dark:bg-[#161618] border border-slate-200 dark:border-[#2e2e32] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-slate-900 dark:text-white">
                          Live Cloud Sync Status
                        </span>
                        <span
                          className={cn(
                            'text-[10px] font-mono px-2 py-0.5 rounded-[4px] border font-medium inline-flex items-center gap-1',
                            gstRates.length > 0 && !gstRates[0].id.startsWith('gst-')
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'
                          )}
                        >
                          {gstRates.length > 0 && !gstRates[0].id.startsWith('gst-')
                            ? '● Connected & In Sync'
                            : '⚠ Setup Required'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-[#A1A1A1]">
                        {gstRates.length > 0 && !gstRates[0].id.startsWith('gst-')
                          ? 'Changes made here sync instantly across all showroom counters.'
                          : 'Tax configuration is pending initialization. Contact administrator.'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleCopyGstSql}
                        className="px-3 py-1.5 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-medium text-xs font-sans flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs active:bg-[#1fa672]"
                        title="Copy setup configuration"
                      >
                        <Copy className="w-3.5 h-3.5 text-[#171717]" />
                        <span>{copiedGstSql ? 'Copied!' : 'Copy Setup Script'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={loadData}
                        disabled={isLoading}
                        className="p-1.5 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#202024] hover:bg-slate-100 dark:hover:bg-[#282828] text-slate-600 dark:text-[#A1A1A1] text-xs cursor-pointer"
                        title="Check cloud records for updates"
                      >
                        <RefreshCw className={cn('w-3.5 h-3.5 text-[#3ecf8e]', isLoading && 'animate-spin')} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Data Grid View */}
                <div className="bg-white dark:bg-[#1a1a1a] rounded-[12px] border border-slate-200 dark:border-[#242424] overflow-hidden shadow-xs">
                    {currentFilteredCount === 0 ? (
                      <div className="py-14">
                        <EmptyState
                          icon={currentTab.icon}
                          title={`No records found in ${currentTab.name}`}
                          description={
                            searchQuery
                              ? `No records matching "${searchQuery}". Clear your search to see all records.`
                              : `The table ${currentTab.tableName} is currently empty.`
                          }
                          actionLabel={currentTab.drawerType ? 'Insert Row' : undefined}
                          onAction={currentTab.drawerType ? handleOpenInsert : undefined}
                        />
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse font-mono text-xs">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-[#171717] border-b border-slate-200 dark:border-[#242424] text-[11px] text-slate-500 dark:text-[#707070] uppercase tracking-wider font-semibold">
                              {activeTabId === 'periods' && (
                                <>
                                  <th className={densityClasses}>Accounting Month</th>
                                  <th className={densityClasses}>Date Range</th>
                                  <th className={densityClasses}>Status</th>
                                  <th className={densityClasses}>Audited By</th>
                                  <th className={densityClasses}>Lock Reason / Note</th>
                                  <th className={cn(densityClasses, 'text-right')}>Action</th>
                                </>
                              )}

                              {activeTabId === 'branches' && (
                                <>
                                  <th className={densityClasses}>Branch Code</th>
                                  <th className={densityClasses}>Branch Name</th>
                                  <th className={densityClasses}>City / State</th>
                                  <th className={densityClasses}>GST Number</th>
                                  <th className={densityClasses}>Cash Box Limits</th>
                                  <th className={densityClasses}>Status</th>
                                  <th className={cn(densityClasses, 'text-right')}>Action</th>
                                </>
                              )}

                              {activeTabId === 'categories' && (
                                <>
                                  <th className={densityClasses}>Category Name</th>
                                  <th className={densityClasses}>Color Theme</th>
                                  <th className={densityClasses}>Status</th>
                                  <th className={cn(densityClasses, 'text-right')}>Action</th>
                                </>
                              )}

                              {activeTabId === 'departments' && (
                                <>
                                  <th className={densityClasses}>Department Code</th>
                                  <th className={densityClasses}>Department Name</th>
                                  <th className={densityClasses}>Status</th>
                                  <th className={cn(densityClasses, 'text-right')}>Action</th>
                                </>
                              )}

                              {activeTabId === 'couriers' && (
                                <>
                                  <th className={densityClasses}>Partner Code</th>
                                  <th className={densityClasses}>Partner Name</th>
                                  <th className={densityClasses}>Contact Phone</th>
                                  <th className={densityClasses}>Status</th>
                                  <th className={cn(densityClasses, 'text-right')}>Action</th>
                                </>
                              )}

                              {activeTabId === 'staff' && (
                                <>
                                  <th className={densityClasses}>Staff Code</th>
                                  <th className={densityClasses}>Full Name</th>
                                  <th className={densityClasses}>Branch</th>
                                  <th className={densityClasses}>Department</th>
                                  <th className={densityClasses}>Designation</th>
                                  <th className={densityClasses}>Status</th>
                                  <th className={cn(densityClasses, 'text-right')}>Action</th>
                                </>
                              )}

                              {activeTabId === 'roles' && (
                                <>
                                  <th className={densityClasses}>Role Code</th>
                                  <th className={densityClasses}>Role Title</th>
                                  <th className={densityClasses}>Description</th>
                                  <th className={densityClasses}>Role Type</th>
                                  <th className={cn(densityClasses, 'text-right')}>Action</th>
                                </>
                              )}

                              {activeTabId === 'denominations' && (
                                <>
                                  <th className={densityClasses}>Cash Value</th>
                                  <th className={densityClasses}>Display Label</th>
                                  <th className={densityClasses}>Type (Note / Coin)</th>
                                  <th className={densityClasses}>Display Order</th>
                                  <th className={densityClasses}>Status</th>
                                </>
                              )}

                              {activeTabId === 'gst_rates' && (
                                <>
                                  <th className={densityClasses}>Tax Rate (%)</th>
                                  <th className={densityClasses}>Slab Description / Category</th>
                                  <th className={densityClasses}>Display Order</th>
                                  <th className={densityClasses}>Status</th>
                                  <th className={cn(densityClasses, 'text-right')}>Action</th>
                                </>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-[#242424]">
                            {/* PERIODS ROWS */}
                            {activeTabId === 'periods' &&
                              filteredPeriods.map((p) => (
                                <tr key={p.period_key} className="hover:bg-slate-50 dark:hover:bg-[#202020] transition-colors">
                                  <td className={cn(densityClasses, 'font-semibold text-slate-900 dark:text-white')}>
                                    {p.period_key}
                                  </td>
                                  <td className={densityClasses}>
                                    {formatDate(p.start_date)} → {formatDate(p.end_date)}
                                  </td>
                                  <td className={densityClasses}>
                                    <span
                                      className={cn(
                                        'px-2 py-0.5 rounded-full text-[10px] font-mono inline-flex items-center gap-1',
                                        p.is_locked
                                          ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                          : 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border border-[#3ecf8e]/30'
                                      )}
                                    >
                                      {p.is_locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                                      <span>{p.is_locked ? 'Locked' : 'Open'}</span>
                                    </span>
                                  </td>
                                  <td className={densityClasses}>{p.locked_by_name || '—'}</td>
                                  <td className={cn(densityClasses, 'max-w-xs truncate text-slate-500')}>
                                    {p.lock_reason || '—'}
                                  </td>
                                  <td className={cn(densityClasses, 'text-right')}>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenPeriodLockModal(p)}
                                      className="px-2 py-1 rounded-[4px] border border-slate-200 dark:border-[#333] hover:bg-slate-100 dark:hover:bg-[#282828] text-[11px] font-mono cursor-pointer"
                                    >
                                      {p.is_locked ? 'Unlock' : 'Lock'}
                                    </button>
                                  </td>
                                </tr>
                              ))}

                            {/* BRANCHES ROWS */}
                            {activeTabId === 'branches' &&
                              filteredBranches.map((b) => (
                                <tr key={b.branch_id} className="hover:bg-slate-50 dark:hover:bg-[#202020] transition-colors">
                                  <td className={cn(densityClasses, 'font-semibold text-slate-900 dark:text-white')}>
                                    {b.branch_code}
                                  </td>
                                  <td className={densityClasses}>{b.branch_name}</td>
                                  <td className={densityClasses}>
                                    {b.city}, {b.state}
                                  </td>
                                  <td className={densityClasses}>{b.gstin || '—'}</td>
                                  <td className={densityClasses}>
                                    Max Cash: {formatINR(b.max_cash_ceiling || 25000)} | Min Float: {formatINR(b.min_cash_threshold || 3000)}
                                  </td>
                                  <td className={densityClasses}>
                                    <span
                                      className={cn(
                                        'px-2 py-0.5 rounded-full text-[10px] font-mono',
                                        b.is_active
                                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e]'
                                          : 'bg-slate-200 dark:bg-[#252525] text-slate-500'
                                      )}
                                    >
                                      {b.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                  </td>
                                  <td className={cn(densityClasses, 'text-right')}>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEdit(b)}
                                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#333] text-slate-500 hover:text-slate-900 dark:hover:text-white"
                                      title="Edit Branch"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              ))}

                            {/* CATEGORIES ROWS */}
                            {activeTabId === 'categories' &&
                              filteredCategories.map((c) => (
                                <tr key={c.category_name} className="hover:bg-slate-50 dark:hover:bg-[#202020] transition-colors">
                                  <td className={cn(densityClasses, 'font-semibold text-slate-900 dark:text-white')}>
                                    {c.category_name}
                                  </td>
                                  <td className={densityClasses}>
                                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-100 dark:bg-[#252525]">
                                      {c.color_theme || 'Default'}
                                    </span>
                                  </td>
                                  <td className={densityClasses}>
                                    <span
                                      className={cn(
                                        'px-2 py-0.5 rounded-full text-[10px] font-mono',
                                        c.is_active
                                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e]'
                                          : 'bg-slate-200 dark:bg-[#252525] text-slate-500'
                                      )}
                                    >
                                      {c.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                  </td>
                                  <td className={cn(densityClasses, 'text-right')}>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEdit(c)}
                                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#333] text-slate-500 hover:text-slate-900 dark:hover:text-white"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              ))}

                            {/* DEPARTMENTS ROWS */}
                            {activeTabId === 'departments' &&
                              filteredDepartments.map((d) => (
                                <tr key={d.department_code} className="hover:bg-slate-50 dark:hover:bg-[#202020] transition-colors">
                                  <td className={cn(densityClasses, 'font-semibold text-slate-900 dark:text-white')}>
                                    {d.department_code}
                                  </td>
                                  <td className={densityClasses}>{d.department_name}</td>
                                  <td className={densityClasses}>
                                    <span
                                      className={cn(
                                        'px-2 py-0.5 rounded-full text-[10px] font-mono',
                                        d.is_active
                                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e]'
                                          : 'bg-slate-200 dark:bg-[#252525] text-slate-500'
                                      )}
                                    >
                                      {d.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                  </td>
                                  <td className={cn(densityClasses, 'text-right')}>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEdit(d)}
                                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#333] text-slate-500 hover:text-slate-900 dark:hover:text-white"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              ))}

                            {/* COURIERS ROWS */}
                            {activeTabId === 'couriers' &&
                              filteredCouriers.map((cr) => (
                                <tr key={cr.partner_code} className="hover:bg-slate-50 dark:hover:bg-[#202020] transition-colors">
                                  <td className={cn(densityClasses, 'font-semibold text-slate-900 dark:text-white')}>
                                    {cr.partner_code}
                                  </td>
                                  <td className={densityClasses}>{cr.partner_name}</td>
                                  <td className={densityClasses}>{cr.contact_phone || '—'}</td>
                                  <td className={densityClasses}>
                                    <span
                                      className={cn(
                                        'px-2 py-0.5 rounded-full text-[10px] font-mono',
                                        cr.is_active
                                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e]'
                                          : 'bg-slate-200 dark:bg-[#252525] text-slate-500'
                                      )}
                                    >
                                      {cr.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                  </td>
                                  <td className={cn(densityClasses, 'text-right')}>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEdit(cr)}
                                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#333] text-slate-500 hover:text-slate-900 dark:hover:text-white"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              ))}

                            {/* STAFF ROWS */}
                            {activeTabId === 'staff' &&
                              filteredStaff.map((s) => (
                                <tr key={s.staff_code} className="hover:bg-slate-50 dark:hover:bg-[#202020] transition-colors">
                                  <td className={cn(densityClasses, 'font-semibold text-slate-900 dark:text-white')}>
                                    {s.staff_code}
                                  </td>
                                  <td className={densityClasses}>
                                    {s.first_name} {s.last_name}
                                  </td>
                                  <td className={densityClasses}>{s.branch_code || 'ASI'}</td>
                                  <td className={densityClasses}>{s.department_name || '—'}</td>
                                  <td className={densityClasses}>{s.designation || '—'}</td>
                                  <td className={densityClasses}>
                                    <span
                                      className={cn(
                                        'px-2 py-0.5 rounded-full text-[10px] font-mono',
                                        s.is_active
                                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e]'
                                          : 'bg-slate-200 dark:bg-[#252525] text-slate-500'
                                      )}
                                    >
                                      {s.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                  </td>
                                  <td className={cn(densityClasses, 'text-right')}>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEdit(s)}
                                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#333] text-slate-500 hover:text-slate-900 dark:hover:text-white"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              ))}

                            {/* ROLES ROWS */}
                            {activeTabId === 'roles' &&
                              filteredRoles.map((r) => (
                                <tr key={r.role_code} className="hover:bg-slate-50 dark:hover:bg-[#202020] transition-colors">
                                  <td className={cn(densityClasses, 'font-semibold text-slate-900 dark:text-white')}>
                                    {r.role_code}
                                  </td>
                                  <td className={densityClasses}>{r.role_title}</td>
                                  <td className={cn(densityClasses, 'max-w-xs truncate text-slate-500')}>
                                    {r.description || '—'}
                                  </td>
                                  <td className={densityClasses}>
                                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-100 dark:bg-[#252525]">
                                      {r.is_system_role ? 'System Fixed' : 'Custom'}
                                    </span>
                                  </td>
                                  <td className={cn(densityClasses, 'text-right')}>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEdit(r)}
                                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#333] text-slate-500 hover:text-slate-900 dark:hover:text-white"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              ))}

                            {/* DENOMINATIONS ROWS */}
                            {activeTabId === 'denominations' &&
                              filteredDenominations.map((dn) => (
                                <tr key={dn.denomination_value} className="hover:bg-slate-50 dark:hover:bg-[#202020] transition-colors">
                                  <td className={cn(densityClasses, 'font-semibold text-slate-900 dark:text-white')}>
                                    {formatINR(dn.denomination_value)}
                                  </td>
                                  <td className={densityClasses}>{dn.display_label}</td>
                                  <td className={densityClasses}>{dn.is_coin ? 'Coin' : 'Currency Note'}</td>
                                  <td className={densityClasses}>{dn.sort_order}</td>
                                  <td className={densityClasses}>
                                    <span
                                      className={cn(
                                        'px-2 py-0.5 rounded-full text-[10px] font-mono',
                                        dn.is_active
                                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e]'
                                          : 'bg-slate-200 dark:bg-[#252525] text-slate-500'
                                      )}
                                    >
                                      {dn.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                  </td>
                                </tr>
                              ))}

                            {/* GST TAX SLABS ROWS */}
                            {activeTabId === 'gst_rates' &&
                              filteredGstRates.map((slab) => (
                                <tr key={slab.id} className="hover:bg-slate-50 dark:hover:bg-[#202020] transition-colors">
                                  <td className={cn(densityClasses, 'font-semibold font-mono text-slate-900 dark:text-white')}>
                                    {slab.rate_percent}%
                                  </td>
                                  <td className={densityClasses}>{slab.rate_label}</td>
                                  <td className={cn(densityClasses, 'font-mono text-xs')}>{slab.display_order}</td>
                                  <td className={densityClasses}>
                                    <span
                                      className={cn(
                                        'px-2 py-0.5 rounded-full text-[10px] font-mono inline-flex items-center gap-1',
                                        slab.is_active
                                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border border-[#3ecf8e]/30'
                                          : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                      )}
                                    >
                                      {slab.is_active ? 'Active (Visible in POS)' : 'Disabled (Hidden)'}
                                    </span>
                                  </td>
                                  <td className={cn(densityClasses, 'text-right')}>
                                    <button
                                      type="button"
                                      onClick={() => handleToggleGstRate(slab)}
                                      className={cn(
                                        'px-2.5 py-1 text-xs font-medium rounded-[6px] transition-colors cursor-pointer border',
                                        slab.is_active
                                          ? 'border-rose-200 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20'
                                          : 'border-[#3ecf8e]/40 text-emerald-700 dark:text-[#3ecf8e] hover:bg-emerald-50 dark:hover:bg-emerald-950/20'
                                      )}
                                    >
                                      {slab.is_active ? 'Disable Slab' : 'Enable Slab'}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
              </div>
            )}
          </div>
        </div>

      {/* ========================================================================= */}
      {/* MASTER DATA MODAL DRAWER                                                  */}
      {/* ========================================================================= */}
      {drawerOpen && (
        <MasterDataDrawer
          isOpen={drawerOpen}
          type={drawerType}
          record={selectedRecord}
          onClose={() => setDrawerOpen(false)}
          onSuccess={handleDrawerSuccess}
        />
      )}

      {/* ========================================================================= */}
      {/* PERIOD LOCK AUDIT MODAL (PRE-COMMIT VERIFICATION SLIP)                    */}
      {/* ========================================================================= */}
      {lockModalOpen && targetPeriod && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="relative w-full max-w-md rounded-[12px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#2e2e2e] p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <button
              type="button"
              onClick={() => setLockModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'w-10 h-10 rounded-[8px] flex items-center justify-center shrink-0 border',
                  targetPeriod.is_locked
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                    : 'bg-rose-500/10 text-rose-500 border-rose-500/30'
                )}
              >
                {targetPeriod.is_locked ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white font-sans">
                  {targetPeriod.is_locked ? 'Unlock Accounting Month' : 'Lock Accounting Month'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-[#888888]">
                  {targetPeriod.is_locked
                    ? 'Allow expense voucher modifications for this month.'
                    : 'Prevent all future edits and additions for audited books.'}
                </p>
              </div>
            </div>

            {/* Verification Slip */}
            <div className="p-4 rounded-[8px] bg-slate-50 dark:bg-[#121212] border border-slate-200 dark:border-[#262626] space-y-2 text-xs font-sans">
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60 dark:border-[#202020]">
                <span className="text-slate-500 dark:text-[#888888]">Accounting Period:</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">{targetPeriod.period_key}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60 dark:border-[#202020]">
                <span className="text-slate-500 dark:text-[#888888]">Date Range:</span>
                <span className="font-mono text-slate-800 dark:text-zinc-200">
                  {formatDate(targetPeriod.start_date)} → {formatDate(targetPeriod.end_date)}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60 dark:border-[#202020]">
                <span className="text-slate-500 dark:text-[#888888]">Current Status:</span>
                <span className="font-mono font-medium text-slate-800 dark:text-zinc-200">
                  {targetPeriod.is_locked ? 'Locked (Protected)' : 'Open (Editable)'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-slate-500 dark:text-[#888888]">Action Requested:</span>
                <span className={cn('font-mono font-semibold', targetPeriod.is_locked ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400')}>
                  {targetPeriod.is_locked ? 'UNLOCK PERIOD' : 'LOCK PERIOD'}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-800 dark:text-zinc-200 font-sans block">
                Audit Reason / Justification Note
              </label>
              <textarea
                rows={2}
                value={lockReason}
                onChange={(e) => setLockReason(e.target.value)}
                placeholder="e.g. Monthly books verified by chartered accountant. Final tally complete."
                className="w-full px-3 py-2 rounded-[6px] bg-slate-50 dark:bg-[#121212] border border-slate-300 dark:border-[#2e2e2e] text-xs font-sans text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#3ecf8e] outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-[#242424]">
              <button
                type="button"
                onClick={() => setLockModalOpen(false)}
                disabled={isSubmittingLock}
                className="px-4 py-2 rounded-[6px] border border-slate-300 dark:border-[#333] text-xs font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#222] transition-colors cursor-pointer"
              >
                Back &amp; Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmToggleLock}
                disabled={isSubmittingLock}
                className={cn(
                  'px-4 py-2 rounded-[6px] text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors',
                  targetPeriod.is_locked
                    ? 'bg-amber-500 hover:bg-amber-600 text-black'
                    : 'bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717]'
                )}
              >
                <Check className="w-3.5 h-3.5 stroke-[3]" />
                <span>
                  {isSubmittingLock
                    ? 'Saving...'
                    : targetPeriod.is_locked
                    ? 'Confirm Unlock'
                    : 'Confirm Lock'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* GLOBAL BROADCAST PRE-COMMIT CONFIRMATION PREVIEW MODAL                    */}
      {/* ========================================================================= */}
      {isBroadcastPreviewOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="relative w-full max-w-md rounded-[12px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <button
              type="button"
              onClick={() => setIsBroadcastPreviewOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-[8px] bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                <Megaphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white font-sans">
                  Confirm Shop Announcement
                </h3>
                <p className="text-xs text-slate-500 dark:text-[#888888]">
                  This message will be broadcast live to all showroom counters.
                </p>
              </div>
            </div>

            {/* Verification Slip */}
            <div className="p-4 rounded-[8px] bg-slate-50 dark:bg-[#121212] border border-slate-200 dark:border-[#262626] space-y-2.5 text-xs font-sans">
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60 dark:border-[#202020]">
                <span className="text-slate-500 dark:text-[#888888]">Badge Tag:</span>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 font-mono text-[10px] font-bold">
                  {isCustomBadge ? customBadge || 'CUSTOM' : broadcastBadge}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60 dark:border-[#202020]">
                <span className="text-slate-500 dark:text-[#888888]">Audience:</span>
                <span className="font-medium text-slate-900 dark:text-white">All Showroom Counters</span>
              </div>
              <div className="space-y-1 py-1">
                <span className="text-slate-500 dark:text-[#888888] block">Announcement Message:</span>
                <p className="p-2.5 rounded-[6px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#2c2c2c] text-slate-900 dark:text-[#EDEDED] leading-relaxed">
                  {broadcastMessage}
                </p>
              </div>
              {broadcastLink && (
                <div className="flex justify-between items-center py-1 border-t border-slate-200/60 dark:border-[#202020]">
                  <span className="text-slate-500 dark:text-[#888888]">Attachment Link:</span>
                  <span className="font-mono text-[11px] text-[#3ecf8e] truncate max-w-[200px]">
                    {broadcastLink}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-[#242424]">
              <button
                type="button"
                onClick={() => setIsBroadcastPreviewOpen(false)}
                className="px-4 py-2 rounded-[6px] border border-slate-300 dark:border-[#333] text-xs font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#222] transition-colors cursor-pointer"
              >
                Back &amp; Edit
              </button>
              <button
                type="button"
                onClick={handleConfirmPublishBroadcast}
                className="px-5 py-2 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Confirm &amp; Broadcast</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShowroomSettingsPage;
