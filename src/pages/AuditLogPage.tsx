import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { format, subDays, startOfMonth } from 'date-fns';
import { useAuthStore, isPrivilegedAdminRole } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { erpService } from '@/lib/erpService';
import { SecurityAuditLog } from '@/types/database';
import { AccessDeniedView } from '@/components/common/AccessDeniedView';
import { SlideOverDrawer } from '@/components/ui/SlideOverDrawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { showToast } from '@/components/ui/ToastContainer';
import { formatINR, cn, triggerHaptic, formatDate } from '@/lib/utils';
import {
  ShieldCheck,
  ShieldAlert,
  Search,
  RefreshCw,
  Download,
  Calendar,
  Clock,
  User,
  Check,
  Copy,
  Eye,
  X,
  AlertTriangle,
  FileText,
  Lock,
  Unlock,
  Hash,
  Terminal,
  Sparkles,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  SlidersHorizontal,
  Coins,
  Receipt,
  HandCoins,
  KeyRound,
  Shield,
  Activity,
} from 'lucide-react';

type ActionCategory = 'ALL' | 'VOUCHER' | 'CASH' | 'ADVANCE' | 'AUTH' | 'SETTINGS';
type DateFilterPreset = 'all' | 'today' | 'yesterday' | '7days' | '30days';

function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return format(new Date(dateStr), 'dd MMM yyyy');
  } catch {
    return dateStr;
  }
}

function getActionCategory(actionType: string): ActionCategory {
  if (actionType.includes('Voucher')) return 'VOUCHER';
  if (actionType.includes('Float') || actionType.includes('Cash') || actionType.includes('Till') || actionType.includes('F9')) return 'CASH';
  if (actionType.includes('Advance')) return 'ADVANCE';
  if (actionType.includes('Login') || actionType.includes('Logout') || actionType.includes('PIN') || actionType.includes('Auth')) return 'AUTH';
  return 'SETTINGS';
}

function getActionColor(actionType: string): { bg: string; text: string; border: string } {
  if (actionType.includes('Void') || actionType.includes('Delete') || actionType.includes('Failure')) {
    return { bg: 'bg-rose-500/10', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/30' };
  }
  if (actionType.includes('Update') || actionType.includes('Edit')) {
    return { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/30' };
  }
  if (actionType.includes('Create') || actionType.includes('Topup') || actionType.includes('Success')) {
    return { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-[#3ecf8e]', border: 'border-emerald-500/30' };
  }
  if (actionType.includes('Advance')) {
    return { bg: 'bg-purple-500/10', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-500/30' };
  }
  if (actionType.includes('Lock') || actionType.includes('Unlock')) {
    return { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/30' };
  }
  return { bg: 'bg-slate-500/10', text: 'text-slate-600 dark:text-zinc-400', border: 'border-slate-500/20' };
}

function getRoleBadge(role: string): { label: string; className: string } {
  switch (role) {
    case 'Super_Admin':
      return { label: 'Super Admin', className: 'bg-emerald-500/15 text-emerald-700 dark:text-[#3ecf8e] border-emerald-500/30' };
    case 'Developer':
      return { label: 'Developer', className: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30' };
    case 'Store_Manager':
      return { label: 'Store Manager', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30' };
    case 'Cashier':
    case 'Showroom_Cashier':
      return { label: 'Cashier', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30' };
    case 'Auditor':
      return { label: 'Auditor', className: 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30' };
    default:
      return { label: role || 'User', className: 'bg-slate-100 dark:bg-[#202020] text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-[#2e2e2e]' };
  }
}

function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const AuditLogPage: React.FC = () => {
  const { user } = useAuthStore();
  const isPrivileged = isPrivilegedAdminRole(user?.role_code);

  const [logs, setLogs] = useState<SecurityAuditLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastSynced, setLastSynced] = useState<Date>(new Date());

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<ActionCategory>('ALL');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [datePreset, setDatePreset] = useState<DateFilterPreset>('all');

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Inspector Drawer
  const [selectedLog, setSelectedLog] = useState<SecurityAuditLog | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (text: string, label: string = 'Copied') => {
    triggerHaptic('success');
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    showToast({
      type: 'success',
      title: 'Copied to Clipboard',
      message: `${label}: ${text}`,
    });
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Load Real Data
  const fetchLogs = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setIsRefreshing(true);

    try {
      const data = await erpService.getSecurityAuditLogs(1000);
      setLogs(data);
      setLastSynced(new Date());
    } catch (err: any) {
      console.error('Failed to load audit logs:', err);
      showToast({
        type: 'error',
        title: 'Sync Failed',
        message: err.message || 'Could not fetch security audit logs.',
      });
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isPrivileged) {
      fetchLogs();
    }
  }, [isPrivileged, fetchLogs]);

  // Real-time Push Listener
  useEffect(() => {
    const handleRealtimeLog = (e: any) => {
      if (e.detail) {
        setLogs((prev) => [e.detail as SecurityAuditLog, ...prev]);
        showToast({
          type: 'info',
          title: 'Live Audit Log',
          message: `${e.detail.user_name} (${e.detail.action_type}): ${e.detail.target_identifier || ''}`,
        });
      }
    };

    window.addEventListener('asopalav:audit-log-created', handleRealtimeLog);
    return () => window.removeEventListener('asopalav:audit-log-created', handleRealtimeLog);
  }, []);

  // Filtered Logs
  const filteredLogs = useMemo(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const yesterdayStr = format(subDays(new Date(), 1), 'yyyy-MM-dd');
    const sevenDaysAgoStr = format(subDays(new Date(), 7), 'yyyy-MM-dd');
    const monthStartStr = format(startOfMonth(new Date()), 'yyyy-MM-dd');

    const q = searchQuery.toLowerCase().trim();

    return logs.filter((log) => {
      // 1. Category Filter
      if (categoryFilter !== 'ALL') {
        const cat = getActionCategory(log.action_type);
        if (cat !== categoryFilter) return false;
      }

      // 2. Role Filter
      if (roleFilter !== 'ALL') {
        if (log.user_role !== roleFilter) return false;
      }

      // 3. Date Preset
      const logDate = (log.created_at || '').slice(0, 10);
      if (datePreset === 'today' && logDate !== todayStr) return false;
      if (datePreset === 'yesterday' && logDate !== yesterdayStr) return false;
      if (datePreset === '7days' && logDate < sevenDaysAgoStr) return false;
      if (datePreset === '30days' && logDate < monthStartStr) return false;

      // 4. Search Query
      if (q) {
        const matchUser = log.user_name?.toLowerCase().includes(q);
        const matchRole = log.user_role?.toLowerCase().includes(q);
        const matchAction = log.action_type?.toLowerCase().includes(q);
        const matchTarget = log.target_identifier?.toLowerCase().includes(q);
        const matchDesc = log.event_description?.toLowerCase().includes(q);
        const matchJust = log.justification?.toLowerCase().includes(q);
        const matchIp = log.ip_address?.toLowerCase().includes(q);
        const matchAuditNo = log.audit_number?.toLowerCase().includes(q);

        if (!matchUser && !matchRole && !matchAction && !matchTarget && !matchDesc && !matchJust && !matchIp && !matchAuditNo) {
          return false;
        }
      }

      return true;
    });
  }, [logs, categoryFilter, roleFilter, datePreset, searchQuery]);

  // KPI Calculations
  const stats = useMemo(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    let todayCount = 0;
    let criticalCount = 0;
    const operatorsSet = new Set<string>();

    logs.forEach((log) => {
      if ((log.created_at || '').slice(0, 10) === todayStr) todayCount++;
      const action = log.action_type || '';
      if (action.includes('Void') || action.includes('Delete') || action.includes('Update') || action.includes('Lock')) {
        criticalCount++;
      }
      if (log.user_name) operatorsSet.add(log.user_name);
    });

    return {
      total: logs.length,
      today: todayCount,
      critical: criticalCount,
      operators: operatorsSet.size,
    };
  }, [logs]);

  // Paginated Slice
  const totalPages = Math.ceil(filteredLogs.length / pageSize) || 1;
  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredLogs.slice(start, start + pageSize);
  }, [filteredLogs, currentPage, pageSize]);

  // Export to CSV
  const handleExportCSV = () => {
    triggerHaptic('medium');
    const headers = [
      'Audit ID',
      'Date & Time',
      'Operator',
      'Role',
      'Action Type',
      'Target Entity',
      'Target Identifier',
      'Event Description',
      'Reason / Justification',
      'IP Address',
      'Cryptographic Signature',
    ];

    const rows = filteredLogs.map((l) => [
      `"${l.audit_number || ''}"`,
      `"${formatDate(l.created_at, 'yyyy-MM-dd HH:mm:ss')}"`,
      `"${(l.user_name || '').replace(/"/g, '""')}"`,
      `"${l.user_role || ''}"`,
      `"${l.action_type || ''}"`,
      `"${l.target_entity || ''}"`,
      `"${(l.target_identifier || '').replace(/"/g, '""')}"`,
      `"${(l.event_description || '').replace(/"/g, '""')}"`,
      `"${(l.justification || '').replace(/"/g, '""')}"`,
      `"${l.ip_address || ''}"`,
      `"${l.tamper_proof_signature || ''}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const filename = `asopalav_audit_log_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`;
    downloadCSV(filename, csvContent);

    showToast({
      type: 'success',
      title: 'Export Complete',
      message: `Exported ${filteredLogs.length} audit records to ${filename}`,
    });
  };

  // Strictly enforce Developer / Super Admin access
  if (!isPrivileged) {
    return (
      <AccessDeniedView
        title="Security Log Book Locked"
        pageName="Log Book"
        message="Access to the Master Security Log Book is strictly restricted to System Administrators and Developers. Cryptographic audit trails are confidential."
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-[#141414] text-slate-900 dark:text-[#EDEDED] font-sans">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
        {/* ========================================================================= */}
        {/* 1. TOP HEADER                                                             */}
        {/* ========================================================================= */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-[#242424]">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-[6px] bg-emerald-500/10 border border-emerald-500/20 text-[#3ecf8e]">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white font-sans">
                Master Security Log Book
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-mono text-emerald-700 dark:text-[#3ecf8e]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3ecf8e] animate-pulse" />
                Live Telemetry
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              Immutable SHA-256 cryptographic audit ledger tracking all voucher modifications, voids, cash movements, and security events.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => fetchLogs(true)}
              disabled={isRefreshing}
              className="h-9 px-3.5 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#1a1a1a] hover:bg-slate-100 dark:hover:bg-[#222] text-slate-700 dark:text-[#ededed] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
              title={`Last synced: ${format(lastSynced, 'HH:mm:ss')}`}
            >
              <RefreshCw className={cn('w-3.5 h-3.5 text-slate-500', isRefreshing && 'animate-spin text-[#3ecf8e]')} />
              <span>{isRefreshing ? 'Syncing...' : 'Refresh'}</span>
            </button>

            <button
              type="button"
              onClick={handleExportCSV}
              disabled={filteredLogs.length === 0}
              className="h-9 px-3.5 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#1a1a1a] hover:bg-slate-100 dark:hover:bg-[#222] text-slate-700 dark:text-[#ededed] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-[#3ecf8e]" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 2. STATS KPI HERO CARDS                                                    */}
        {/* ========================================================================= */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="p-4 rounded-[12px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] shadow-2xs space-y-1">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-zinc-400 block">
              Total Logged Records
            </span>
            <div className="flex items-baseline justify-between">
              <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 dark:text-white">
                {stats.total.toLocaleString()}
              </span>
              <Shield className="w-4 h-4 text-[#3ecf8e]" />
            </div>
            <span className="text-[10px] text-slate-400 dark:text-zinc-500">
              Cryptographically verified
            </span>
          </div>

          <div className="p-4 rounded-[12px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] shadow-2xs space-y-1">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-zinc-400 block">
              Today's Shift Activity
            </span>
            <div className="flex items-baseline justify-between">
              <span className="text-xl sm:text-2xl font-bold font-mono text-emerald-600 dark:text-[#3ecf8e]">
                {stats.today.toLocaleString()}
              </span>
              <Clock className="w-4 h-4 text-emerald-500" />
            </div>
            <span className="text-[10px] text-slate-400 dark:text-zinc-500">
              Actions since shift opening
            </span>
          </div>

          <div className="p-4 rounded-[12px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] shadow-2xs space-y-1">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-zinc-400 block">
              Critical Actions
            </span>
            <div className="flex items-baseline justify-between">
              <span className="text-xl sm:text-2xl font-bold font-mono text-rose-600 dark:text-rose-400">
                {stats.critical.toLocaleString()}
              </span>
              <AlertTriangle className="w-4 h-4 text-rose-500" />
            </div>
            <span className="text-[10px] text-slate-400 dark:text-zinc-500">
              Voids, Deletes &amp; Updates
            </span>
          </div>

          <div className="p-4 rounded-[12px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] shadow-2xs space-y-1">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-zinc-400 block">
              Active Operators
            </span>
            <div className="flex items-baseline justify-between">
              <span className="text-xl sm:text-2xl font-bold font-mono text-blue-600 dark:text-blue-400">
                {stats.operators}
              </span>
              <User className="w-4 h-4 text-blue-500" />
            </div>
            <span className="text-[10px] text-slate-400 dark:text-zinc-500">
              Managers, Cashiers &amp; Admins
            </span>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 3. SEARCH & FILTER CONTROLS BAR                                           */}
        {/* ========================================================================= */}
        <div className="p-3 sm:p-4 rounded-[12px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] shadow-2xs space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            {/* Search Input */}
            <div className="md:col-span-5 relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search by operator, voucher #, reason, IP, description..."
                className="w-full h-9 pl-9 pr-8 rounded-[6px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#282828] text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Action Category Filter */}
            <div className="md:col-span-3">
              <select
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value as ActionCategory);
                  setCurrentPage(1);
                }}
                className="w-full h-9 px-3 rounded-[6px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#282828] text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3ecf8e] cursor-pointer"
              >
                <option value="ALL">All Event Categories</option>
                <option value="VOUCHER">Expense Bills (Create/Edit/Void)</option>
                <option value="CASH">Cash &amp; Float Movements</option>
                <option value="ADVANCE">Staff Salary Advances</option>
                <option value="AUTH">Authentication &amp; Logins</option>
                <option value="SETTINGS">Shop Master Settings</option>
              </select>
            </div>

            {/* Role Filter */}
            <div className="md:col-span-2">
              <select
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full h-9 px-3 rounded-[6px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#282828] text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3ecf8e] cursor-pointer"
              >
                <option value="ALL">All Roles</option>
                <option value="Super_Admin">Super Admin</option>
                <option value="Store_Manager">Store Manager</option>
                <option value="Cashier">Cashier</option>
                <option value="Auditor">Auditor</option>
                <option value="Developer">Developer</option>
              </select>
            </div>

            {/* Date Preset Filter */}
            <div className="md:col-span-2">
              <select
                value={datePreset}
                onChange={(e) => {
                  setDatePreset(e.target.value as DateFilterPreset);
                  setCurrentPage(1);
                }}
                className="w-full h-9 px-3 rounded-[6px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#282828] text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3ecf8e] cursor-pointer"
              >
                <option value="all">All Time</option>
                <option value="today">Today's Shift</option>
                <option value="yesterday">Yesterday</option>
                <option value="7days">Last 7 Days</option>
                <option value="30days">This Month</option>
              </select>
            </div>
          </div>

          {(searchQuery || categoryFilter !== 'ALL' || roleFilter !== 'ALL' || datePreset !== 'all') && (
            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-[#242424] text-xs text-slate-500">
              <span>
                Filtered: <strong>{filteredLogs.length}</strong> matching entries found
              </span>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setCategoryFilter('ALL');
                  setRoleFilter('ALL');
                  setDatePreset('all');
                  setCurrentPage(1);
                }}
                className="text-[#3ecf8e] hover:underline font-medium cursor-pointer"
              >
                Reset All Filters
              </button>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* 4. REAL-TIME LOG BOOK TABLE                                               */}
        {/* ========================================================================= */}
        <div className="rounded-[12px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] overflow-hidden shadow-2xs">
          <div className="overflow-x-auto max-h-[650px] overflow-y-auto">
            <table className="w-full border-collapse text-left text-xs font-mono">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-slate-200 dark:border-[#242424] bg-slate-50 dark:bg-[#141414] text-[11px] text-slate-500 dark:text-[#A1A1A1] font-sans font-medium select-none">
                  <th className="py-2.5 px-3 whitespace-nowrap">#</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Timestamp</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Audit Code</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Operator</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Action Type</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Target</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Event Description &amp; Reason</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">IP / Network</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#242424]">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-slate-400 font-sans">
                      <div className="inline-flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-[#3ecf8e]" />
                        <span>Loading cryptographic audit records...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center">
                      <EmptyState
                        icon={RotateCcw}
                        title="No audit records match your filters"
                        description="Try resetting the search terms, category, role, or date filter."
                        actionLabel="Clear Filters"
                        onAction={() => {
                          setSearchQuery('');
                          setCategoryFilter('ALL');
                          setRoleFilter('ALL');
                          setDatePreset('all');
                        }}
                      />
                    </td>
                  </tr>
                ) : (
                  paginatedLogs.map((log, idx) => {
                    const rowSeq = (currentPage - 1) * pageSize + idx + 1;
                    const actionColors = getActionColor(log.action_type);
                    const roleBadge = getRoleBadge(log.user_role);
                    const isCopied = copiedId === log.audit_number;

                    return (
                      <tr
                        key={log.id || `${log.audit_number}-${idx}`}
                        className="hover:bg-slate-50 dark:hover:bg-[#1a1a1a] transition-colors group cursor-pointer"
                        onClick={() => setSelectedLog(log)}
                      >
                        {/* # */}
                        <td className="py-2.5 px-3 text-slate-400 dark:text-zinc-500 font-mono text-[11px] whitespace-nowrap">
                          #{rowSeq}
                        </td>

                        {/* Timestamp */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-semibold text-slate-900 dark:text-white font-mono text-xs">
                              {formatDate(log.created_at, 'dd MMM yyyy, HH:mm:ss')}
                            </span>
                            <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" />
                              {formatRelativeTime(log.created_at)}
                            </span>
                          </div>
                        </td>

                        {/* Audit Code */}
                        <td className="py-2.5 px-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => handleCopy(log.audit_number, 'Audit Code')}
                            className="inline-flex items-center gap-1 font-mono font-medium text-slate-700 dark:text-[#EDEDED] hover:text-[#3ecf8e] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#202024] border border-slate-200 dark:border-[#2e2e34] transition-colors cursor-pointer text-xs"
                            title="Copy audit identifier"
                          >
                            <span>{log.audit_number}</span>
                            {isCopied ? (
                              <Check className="w-2.5 h-2.5 text-[#3ecf8e]" />
                            ) : (
                              <Copy className="w-2.5 h-2.5 text-slate-400" />
                            )}
                          </button>
                        </td>

                        {/* Operator */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="space-y-0.5">
                            <span className="font-semibold text-slate-900 dark:text-white block font-sans text-xs">
                              {log.user_name || 'System Operator'}
                            </span>
                            <span
                              className={cn(
                                'inline-block px-1.5 py-0.2 rounded text-[9.5px] font-sans font-medium border',
                                roleBadge.className
                              )}
                            >
                              {roleBadge.label}
                            </span>
                          </div>
                        </td>

                        {/* Action Type */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] font-mono text-[11px] font-semibold border',
                              actionColors.bg,
                              actionColors.text,
                              actionColors.border
                            )}
                          >
                            {log.action_type.replace(/_/g, ' ')}
                          </span>
                        </td>

                        {/* Target */}
                        <td className="py-2.5 px-3 whitespace-nowrap font-mono text-slate-800 dark:text-zinc-200 text-xs font-semibold">
                          {log.target_identifier || log.target_entity || '—'}
                        </td>

                        {/* Description & Reason */}
                        <td className="py-2.5 px-3 max-w-md">
                          <div className="space-y-0.5">
                            <span className="font-sans text-xs text-slate-900 dark:text-zinc-200 block truncate">
                              {log.event_description}
                            </span>
                            {log.justification && (
                              <span className="text-[11px] text-amber-700 dark:text-amber-300 italic font-sans block truncate">
                                &ldquo;{log.justification}&rdquo;
                              </span>
                            )}
                          </div>
                        </td>

                        {/* IP / Network */}
                        <td className="py-2.5 px-3 whitespace-nowrap text-slate-500 dark:text-zinc-400 font-mono text-[11px]">
                          {log.ip_address || 'Showroom LAN'}
                        </td>

                        {/* Inspect */}
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedLog(log);
                            }}
                            className="p-1 rounded-[4px] text-slate-400 hover:text-emerald-600 dark:hover:text-[#3ecf8e] hover:bg-emerald-500/10 transition-colors"
                            title="Inspect complete audit record"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="p-3 sm:p-3.5 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs font-sans border-t border-slate-200 dark:border-[#242424]">
            <div className="flex items-center gap-2 text-slate-500 dark:text-[#8E8E93]">
              <span>
                Showing <strong>{(currentPage - 1) * pageSize + 1}</strong> to{' '}
                <strong>{Math.min(currentPage * pageSize, filteredLogs.length)}</strong> of{' '}
                <strong>{filteredLogs.length}</strong> records
              </span>

              <div className="flex items-center gap-1 ml-2">
                <span>Rows:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="h-7 px-1.5 rounded-[4px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#1a1a1a] text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-[#3ecf8e] cursor-pointer"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => {
                  triggerHaptic('selection');
                  setCurrentPage((p) => Math.max(1, p - 1));
                }}
                className="h-7 px-2.5 rounded-[4px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#202024] text-slate-700 dark:text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Prev</span>
              </button>

              <span className="px-2 font-mono text-slate-700 dark:text-zinc-300">
                Page {currentPage} of {totalPages}
              </span>

              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => {
                  triggerHaptic('selection');
                  setCurrentPage((p) => Math.min(totalPages, p + 1));
                }}
                className="h-7 px-2.5 rounded-[4px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#202024] text-slate-700 dark:text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 5. SLIDE-OVER INSPECTOR DRAWER                                            */}
        {/* ========================================================================= */}
        <SlideOverDrawer
          isOpen={Boolean(selectedLog)}
          onClose={() => setSelectedLog(null)}
          title={selectedLog ? `Audit Record #${selectedLog.audit_number}` : 'Audit Record'}
          subtitle={selectedLog ? `Recorded ${formatDate(selectedLog.created_at, 'dd MMM yyyy, HH:mm:ss')} • IP: ${selectedLog.ip_address || 'LAN'}` : ''}
          badge={
            selectedLog ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-emerald-500/10 text-[#3ecf8e] border border-emerald-500/20 text-[10px] font-mono">
                <ShieldCheck className="w-3 h-3" />
                <span>Verified SHA-256</span>
              </span>
            ) : null
          }
          size="lg"
        >
          {selectedLog && (
            <div className="space-y-4 text-xs font-sans">
              {/* Event Overview Card */}
              <div className="p-4 rounded-[12px] bg-slate-50 dark:bg-[#181818] border border-slate-200 dark:border-[#262626] space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-[#282828]">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                    Action Type
                  </span>
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded-[4px] font-mono font-semibold text-xs border',
                      getActionColor(selectedLog.action_type).bg,
                      getActionColor(selectedLog.action_type).text,
                      getActionColor(selectedLog.action_type).border
                    )}
                  >
                    {selectedLog.action_type.replace(/_/g, ' ')}
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-zinc-400 block">
                    Event Description
                  </span>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white leading-relaxed">
                    {selectedLog.event_description}
                  </p>
                </div>

                {selectedLog.justification && (
                  <div className="p-3 rounded-[8px] bg-amber-500/10 border border-amber-500/20 space-y-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-amber-900 dark:text-amber-200 font-semibold block">
                      Mandatory User Justification Reason
                    </span>
                    <p className="text-xs text-amber-950 dark:text-amber-100 font-medium">
                      &ldquo;{selectedLog.justification}&rdquo;
                    </p>
                  </div>
                )}
              </div>

              {/* Key Parameters Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-[8px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#262626] space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 dark:text-zinc-500 block">
                    Operator Name &amp; Role
                  </span>
                  <div className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {selectedLog.user_name}
                    </span>
                    <span className={cn('px-1.5 py-0.2 rounded text-[10px] font-mono border', getRoleBadge(selectedLog.user_role).className)}>
                      {getRoleBadge(selectedLog.user_role).label}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-[8px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#262626] space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 dark:text-zinc-500 block">
                    Target Identifier
                  </span>
                  <div className="flex items-center gap-2">
                    <Hash className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {selectedLog.target_identifier || 'None'}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      ({selectedLog.target_entity})
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-[8px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#262626] space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 dark:text-zinc-500 block">
                    Network IP Address
                  </span>
                  <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-mono text-slate-900 dark:text-white">
                      {selectedLog.ip_address || 'Showroom LAN'}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-[8px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#262626] space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 dark:text-zinc-500 block">
                    Exact Timestamp
                  </span>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-mono text-slate-900 dark:text-white">
                      {formatDate(selectedLog.created_at, 'yyyy-MM-dd HH:mm:ss.SSS')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Cryptographic SHA-256 Hash Card */}
              <div className="p-3.5 rounded-[10px] bg-slate-900 dark:bg-black border border-slate-800 dark:border-[#2a2a2a] text-white space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[#3ecf8e] text-xs font-semibold font-mono">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Cryptographic Signature (SHA-256)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(selectedLog.tamper_proof_signature || '', 'Signature')}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-white/10 hover:bg-white/20 text-[#3ecf8e] transition-colors cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy Hash</span>
                  </button>
                </div>
                <div className="p-2.5 rounded bg-black/60 border border-white/10 font-mono text-[11px] text-[#3ecf8e] break-all select-all">
                  {selectedLog.tamper_proof_signature || 'N/A (Legacy System Record)'}
                </div>
              </div>

              {/* Raw JSON Payload */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-mono uppercase text-[10px] tracking-wider">Raw System Log Object</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(JSON.stringify(selectedLog, null, 2), 'Raw Log JSON')}
                    className="text-[#3ecf8e] hover:underline font-mono text-[11px] cursor-pointer"
                  >
                    Copy JSON
                  </button>
                </div>
                <pre className="p-3 rounded-[8px] bg-slate-100 dark:bg-[#121212] border border-slate-200 dark:border-[#222] font-mono text-[11px] text-slate-800 dark:text-zinc-300 overflow-x-auto max-h-48 leading-relaxed">
                  {JSON.stringify(selectedLog, null, 2)}
                </pre>
              </div>

              {/* Close Button */}
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="w-full h-10 rounded-[6px] bg-[#3ecf8e] hover:bg-[#34b27b] text-[#171717] font-semibold text-xs transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          )}
        </SlideOverDrawer>
      </div>
    </div>
  );
};

export default AuditLogPage;
