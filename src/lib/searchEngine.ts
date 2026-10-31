import { erpService } from './erpService';
import { useVoucherStore } from '@/store/voucherStore';
import { useBranchStore } from '@/store/branchStore';
import {
  ExpenseVoucher,
  StaffAdvance,
  StaffMember,
  Branch,
  ExpenseCategory,
  Department,
} from '@/types/database';
import { formatINR, formatVoucherNumber } from './utils';

export type SearchCategory =
  | 'all'
  | 'vouchers'
  | 'advances'
  | 'treasury'
  | 'closings'
  | 'staff'
  | 'master'
  | 'actions';

export interface SearchResultItem {
  id: string;
  category: SearchCategory;
  categoryLabel: string;
  title: string;
  subtitle: string;
  badge?: {
    text: string;
    variant: 'emerald' | 'amber' | 'rose' | 'blue' | 'neutral';
  };
  amount?: number;
  date?: string;
  branchCode?: string;
  rawItem?: any;
  relevanceScore: number;
  actionType: 'open_voucher' | 'open_advance' | 'open_staff' | 'navigate' | 'custom';
  actionPayload?: any;
  metadata?: Record<string, any>;
}

export interface SearchFilterOptions {
  category?: SearchCategory;
  branchId?: string;
  status?: string;
  minAmount?: number;
  maxAmount?: number;
  paymentMethod?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'relevance' | 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';
}

export interface SearchQueryResult {
  results: SearchResultItem[];
  categoryCounts: Record<SearchCategory, number>;
  total: number;
  totalFinancialVolume: number;
  vouchersFinancialVolume: number;
  advancesFinancialVolume: number;
  vouchersCount: number;
  advancesCount: number;
  staffCount: number;
  masterCount: number;
  executionTimeMs: number;
}

export interface SearchIndexSnapshot {
  vouchers: ExpenseVoucher[];
  advances: StaffAdvance[];
  staff: StaffMember[];
  branches: Branch[];
  categories: ExpenseCategory[];
  departments: Department[];
}

export class GlobalSearchEngine {
  private cache: SearchIndexSnapshot | null = null;
  private lastFetchTime = 0;
  private readonly CACHE_TTL_MS = 10000; // 10s cache

  public async preloadIndex(force = false): Promise<SearchIndexSnapshot> {
    const now = Date.now();
    if (!force && this.cache && now - this.lastFetchTime < this.CACHE_TTL_MS) {
      return this.cache;
    }

    try {
      const voucherStore = useVoucherStore.getState();
      const branchStore = useBranchStore.getState();

      // Ensure data is loaded in stores
      await Promise.all([
        voucherStore.fetchMasterData(force),
        voucherStore.fetchVouchers('ALL', force),
        branchStore.fetchBranchesAndWallets(force),
      ]);

      const advances = await erpService.getStaffAdvances().catch(() => [] as StaffAdvance[]);

      const currentVouchers = voucherStore.vouchers['ALL'] || Object.values(voucherStore.vouchers).flat();
      const masterData = voucherStore.masterData;
      const branches = branchStore.branches;

      this.cache = {
        vouchers: currentVouchers,
        advances,
        staff: masterData.staff || [],
        branches: branches || [],
        categories: masterData.categories || [],
        departments: masterData.departments || [],
      };
      this.lastFetchTime = now;
      return this.cache;
    } catch (err) {
      console.error('Failed to preload search index:', err);
      return (
        this.cache || {
          vouchers: [],
          advances: [],
          staff: [],
          branches: [],
          categories: [],
          departments: [],
        }
      );
    }
  }

  public invalidateCache(): void {
    this.cache = null;
    this.lastFetchTime = 0;
  }

  public async search(
    rawQuery: string,
    options: SearchFilterOptions = {}
  ): Promise<SearchQueryResult> {
    const startTime = performance.now();
    const index = await this.preloadIndex();
    
    // Parse query and filter qualifiers (e.g. branch:ASI amt:>5000)
    let processedQuery = rawQuery.trim().toLowerCase();
    let inlineBranch = options.branchId;
    let inlineMinAmt = options.minAmount;
    let inlineMaxAmt = options.maxAmount;
    let inlineStatus = options.status;

    // Qualifier: branch:xxx
    const branchMatch = processedQuery.match(/branch:([a-z0-9_-]+)/i);
    if (branchMatch) {
      inlineBranch = branchMatch[1].toUpperCase();
      processedQuery = processedQuery.replace(branchMatch[0], '').trim();
    }

    // Qualifier: min:xxx or amt:>xxx
    const minMatch = processedQuery.match(/(?:min:|amt:>|amount:>)([0-9]+)/i);
    if (minMatch) {
      inlineMinAmt = Number(minMatch[1]);
      processedQuery = processedQuery.replace(minMatch[0], '').trim();
    }

    // Qualifier: max:xxx or amt:<xxx
    const maxMatch = processedQuery.match(/(?:max:|amt:<|amount:<)([0-9]+)/i);
    if (maxMatch) {
      inlineMaxAmt = Number(maxMatch[1]);
      processedQuery = processedQuery.replace(maxMatch[0], '').trim();
    }

    // Qualifier: status:xxx
    const statusMatch = processedQuery.match(/status:([a-z0-9_-]+)/i);
    if (statusMatch) {
      inlineStatus = statusMatch[1].toLowerCase();
      processedQuery = processedQuery.replace(statusMatch[0], '').trim();
    }

    const terms = processedQuery.split(/\s+/).filter(Boolean);

    const allResults: SearchResultItem[] = [];
    const counts: Record<SearchCategory, number> = {
      all: 0,
      vouchers: 0,
      advances: 0,
      treasury: 0,
      closings: 0,
      staff: 0,
      master: 0,
      actions: 0,
    };

    let totalFinancialVolume = 0;
    let vouchersFinancialVolume = 0;
    let advancesFinancialVolume = 0;
    let vouchersCount = 0;
    let advancesCount = 0;
    let staffCount = 0;
    let masterCount = 0;

    // Helper: fuzzy match score calculator
    const scoreItem = (searchableStrings: string[], highPriorityStrings: string[]): number => {
      if (terms.length === 0) return 1;

      let score = 0;
      for (const term of terms) {
        // Exact / prefix match on high-priority terms (e.g. voucher #, payee, receipt #)
        const highMatch = highPriorityStrings.some((s) => s.toLowerCase().includes(term));
        if (highMatch) {
          score += 12;
        }

        // Searchable content match
        const contentMatch = searchableStrings.some((s) => s.toLowerCase().includes(term));
        if (contentMatch) {
          score += 4;
        }
      }
      return score;
    };

    // 1. INDEX: Vouchers & Expenses
    for (const v of index.vouchers) {
      if (inlineBranch && inlineBranch !== 'ALL' && v.branch_id !== inlineBranch && v.branch_code !== inlineBranch) {
        continue;
      }
      if (inlineStatus && inlineStatus !== 'all' && v.status?.toLowerCase() !== inlineStatus.toLowerCase()) {
        continue;
      }
      const vAmt = Number(v.total_amount) || 0;
      if (inlineMinAmt !== undefined && vAmt < inlineMinAmt) continue;
      if (inlineMaxAmt !== undefined && vAmt > inlineMaxAmt) continue;
      if (options.paymentMethod && options.paymentMethod !== 'ALL' && v.payment_method !== options.paymentMethod) {
        continue;
      }
      if (options.dateFrom && v.payment_date && v.payment_date < options.dateFrom) continue;
      if (options.dateTo && v.payment_date && v.payment_date > options.dateTo) continue;

      const highPrio = [formatVoucherNumber(v.voucher_number), v.voucher_number || '', v.recipient_name || '', v.bill_number || ''];
      const body = [
        v.category_name || '',
        v.department_name || '',
        v.remarks || '',
        v.created_by_name || '',
        v.payment_method || '',
        v.branch_code || '',
        String(v.total_amount || ''),
      ];

      const score = scoreItem(body, highPrio);
      if (terms.length === 0 || score > 0) {
        counts.vouchers++;
        vouchersCount++;
        vouchersFinancialVolume += vAmt;
        totalFinancialVolume += vAmt;

        allResults.push({
          id: `voucher-${v.id}`,
          category: 'vouchers',
          categoryLabel: 'Expense Voucher',
          title: `Voucher #${formatVoucherNumber(v.voucher_number)} • ${v.recipient_name}`,
          subtitle: `${v.category_name} · ${v.department_name || 'Counter'} · ${v.payment_method === 'Physical_Cash' ? 'Cash Drawer' : 'Online UPI'} · By ${v.created_by_name}`,
          badge: {
            text: v.status || 'Approved',
            variant: v.status === 'Voided' ? 'rose' : 'emerald',
          },
          amount: vAmt,
          date: v.payment_date,
          branchCode: v.branch_code,
          rawItem: v,
          relevanceScore: score + (terms.length === 0 ? new Date(v.created_at || v.payment_date).getTime() / 1e11 : 0),
          actionType: 'open_voucher',
          actionPayload: v,
          metadata: {
            bill_number: v.bill_number,
            payment_method: v.payment_method,
            category: v.category_name,
            department: v.department_name,
            remarks: v.remarks,
            created_by: v.created_by_name,
          },
        });
      }
    }

    // 2. INDEX: Staff Advances & IOUs
    for (const adv of index.advances) {
      if (inlineBranch && inlineBranch !== 'ALL' && adv.branch_id !== inlineBranch && adv.branch_code !== inlineBranch) {
        continue;
      }
      if (inlineStatus && inlineStatus !== 'all') {
        const isSettledStatus = adv.status === 'Settled_Bills' || adv.status === 'Settled_Cash';
        if (inlineStatus === 'settled' && !isSettledStatus) continue;
        if (inlineStatus === 'active' && adv.status !== 'Active_Unsettled') continue;
      }
      const advAmt = Number(adv.advance_amount) || 0;
      if (inlineMinAmt !== undefined && advAmt < inlineMinAmt) continue;
      if (inlineMaxAmt !== undefined && advAmt > inlineMaxAmt) continue;
      if (options.dateFrom && adv.advance_date && adv.advance_date < options.dateFrom) continue;
      if (options.dateTo && adv.advance_date && adv.advance_date > options.dateTo) continue;

      const highPrio = [adv.receipt_number || '', adv.staff_name || '', adv.staff_code || ''];
      const body = [
        adv.department_name || '',
        adv.purpose || '',
        adv.payment_method || '',
        adv.status || '',
        String(adv.advance_amount || ''),
        String(adv.unsettled_balance || ''),
      ];

      const score = scoreItem(body, highPrio);
      if (terms.length === 0 || score > 0) {
        counts.advances++;
        advancesCount++;
        advancesFinancialVolume += advAmt;
        totalFinancialVolume += advAmt;

        const isSettled = Number(adv.unsettled_balance) <= 0 || adv.status === 'Settled_Bills' || adv.status === 'Settled_Cash';
        allResults.push({
          id: `advance-${adv.id}`,
          category: 'advances',
          categoryLabel: 'Staff Advance',
          title: `Advance #${adv.receipt_number} • ${adv.staff_name} (${adv.staff_code})`,
          subtitle: `${adv.purpose} · Outstanding: ${formatINR(adv.unsettled_balance)} of ${formatINR(adv.advance_amount)}`,
          badge: {
            text: isSettled ? 'Settled' : adv.status === 'Flagged_Salary_Deduction' ? 'Salary Deduction' : 'Active Due',
            variant: isSettled ? 'emerald' : 'amber',
          },
          amount: advAmt,
          date: adv.advance_date,
          branchCode: adv.branch_code,
          rawItem: adv,
          relevanceScore: score + 1,
          actionType: 'open_advance',
          actionPayload: adv,
          metadata: {
            staff_name: adv.staff_name,
            staff_code: adv.staff_code,
            unsettled_balance: adv.unsettled_balance,
            purpose: adv.purpose,
            status: adv.status,
          },
        });
      }
    }

    // 3. INDEX: Staff Directory & Cashiers
    for (const s of index.staff) {
      if (inlineBranch && inlineBranch !== 'ALL' && s.branch_id !== inlineBranch && s.branch_code !== inlineBranch) {
        continue;
      }

      const fullName = `${s.first_name} ${s.last_name || ''}`.trim();
      const highPrio = [s.staff_code || '', fullName, s.mobile_number || ''];
      const body = [s.department_name || '', s.designation || '', s.branch_code || ''];

      const score = scoreItem(body, highPrio);
      if (terms.length === 0 || score > 0) {
        counts.staff++;
        staffCount++;
        allResults.push({
          id: `staff-${s.staff_code}`,
          category: 'staff',
          categoryLabel: 'Staff Directory',
          title: `${fullName} (${s.staff_code})`,
          subtitle: `${s.designation || 'Staff'} · ${s.department_name || 'Showroom'} · Branch: ${s.branch_code || 'ASI'}`,
          badge: {
            text: s.is_active ? 'Active' : 'Inactive',
            variant: s.is_active ? 'emerald' : 'neutral',
          },
          branchCode: s.branch_code,
          rawItem: s,
          relevanceScore: score,
          actionType: 'navigate',
          actionPayload: { page: 'staff', query: s.staff_code },
          metadata: {
            first_name: s.first_name,
            last_name: s.last_name,
            designation: s.designation,
            department: s.department_name,
            mobile: s.mobile_number,
          },
        });
      }
    }

    // 4. INDEX: Master Data (Categories, Departments, Outlets)
    for (const cat of index.categories) {
      const highPrio = [cat.category_name];
      const body = [cat.color_theme || ''];
      const score = scoreItem(body, highPrio);
      if (terms.length === 0 || score > 0) {
        counts.master++;
        masterCount++;
        allResults.push({
          id: `cat-${cat.category_name}`,
          category: 'master',
          categoryLabel: 'Expense Category',
          title: `Category: ${cat.category_name}`,
          subtitle: `Expense Classification · Color: ${cat.color_theme}`,
          badge: {
            text: cat.is_active ? 'Active' : 'Archived',
            variant: cat.is_active ? 'emerald' : 'neutral',
          },
          relevanceScore: score,
          actionType: 'navigate',
          actionPayload: { page: 'settings', tab: 'categories' },
        });
      }
    }

    for (const dept of index.departments) {
      const highPrio = [dept.department_name, dept.department_code || ''];
      const body: string[] = [];
      const score = scoreItem(body, highPrio);
      if (terms.length === 0 || score > 0) {
        counts.master++;
        masterCount++;
        allResults.push({
          id: `dept-${dept.department_code}`,
          category: 'master',
          categoryLabel: 'Showroom Dept',
          title: `Department: ${dept.department_name}`,
          subtitle: `Code: ${dept.department_code} · Operational Floor Location`,
          badge: {
            text: dept.is_active ? 'Active' : 'Inactive',
            variant: 'blue',
          },
          relevanceScore: score,
          actionType: 'navigate',
          actionPayload: { page: 'settings', tab: 'departments' },
        });
      }
    }

    // 5. INDEX: System Actions & Page Shortcuts
    const systemActions: { title: string; subtitle: string; page: string; hotkey?: string; tags: string[] }[] = [
      { title: 'Add New Expense', subtitle: 'Pay cash or online UPI payment', page: 'new-voucher', hotkey: 'F2', tags: ['create', 'new', 'voucher', 'expense', 'bill', 'pay', 'invoice'] },
      { title: 'Cash Drawer & UPI', subtitle: 'Cash in box, UPI balance & drawer passbook', page: 'treasury', hotkey: 'F4', tags: ['float', 'till', 'cash in hand', 'drawer', 'treasury', 'box'] },
      { title: 'Staff Advances', subtitle: 'Give and clear staff money advances', page: 'advances', hotkey: 'F7', tags: ['advance', 'iou', 'salary', 'staff loan', 'reimbursement'] },
      { title: 'Financial Reports', subtitle: 'Tally Prime export, staff advances, CA & audit pack', page: 'reports', hotkey: 'Reports', tags: ['reports', 'tally', 'export', 'ca', 'auditor', 'chartered accountant', 'statement', 'tax', '40a3'] },
      { title: 'All Expenses', subtitle: 'View and search all past bills & expenses', page: 'expenses', hotkey: 'F3', tags: ['ledger', 'register', 'table', 'export', 'csv', 'audit', 'bills'] },
      { title: 'Staff Directory', subtitle: 'Manage shop staff and PIN logins', page: 'staff', hotkey: 'F10', tags: ['staff', 'employee', 'cashier', 'user', 'role', 'pin'] },
      { title: 'Shop Settings', subtitle: 'Shop branches, categories and accounts', page: 'settings', hotkey: 'F11', tags: ['settings', 'config', 'categories', 'departments', 'branches', 'periods'] },
      { title: 'Security Log Book', subtitle: 'Tamper-proof audit logs & activity ledger (Admin & Dev)', page: 'audit', hotkey: 'Logs', tags: ['audit', 'logs', 'security', 'history', 'telemetry', 'tamper', 'admin', 'dev'] },
      { title: 'Search Everything', subtitle: 'Search all bills, people, notes and advances', page: 'search', hotkey: 'Ctrl+K', tags: ['search', 'query', 'find', 'everything'] },
    ];

    for (const act of systemActions) {
      const highPrio = [act.title, act.hotkey || ''];
      const body = [act.subtitle, ...act.tags];
      const score = scoreItem(body, highPrio);
      if (terms.length === 0 || score > 0) {
        counts.actions++;
        allResults.push({
          id: `act-${act.page}`,
          category: 'actions',
          categoryLabel: 'Quick Action',
          title: act.title,
          subtitle: act.subtitle,
          badge: {
            text: act.hotkey || 'Go',
            variant: 'neutral',
          },
          relevanceScore: score + 5,
          actionType: 'navigate',
          actionPayload: { page: act.page },
        });
      }
    }

    // Filter by category if selected
    let filteredResults = allResults;
    if (options.category && options.category !== 'all') {
      filteredResults = allResults.filter((r) => r.category === options.category);
    }

    // Sort results
    if (options.sortBy === 'newest') {
      filteredResults.sort((a, b) => {
        const timeA = a.date ? new Date(a.date).getTime() : 0;
        const timeB = b.date ? new Date(b.date).getTime() : 0;
        return timeB - timeA;
      });
    } else if (options.sortBy === 'oldest') {
      filteredResults.sort((a, b) => {
        const timeA = a.date ? new Date(a.date).getTime() : 0;
        const timeB = b.date ? new Date(b.date).getTime() : 0;
        return timeA - timeB;
      });
    } else if (options.sortBy === 'amount_desc') {
      filteredResults.sort((a, b) => (b.amount || 0) - (a.amount || 0));
    } else if (options.sortBy === 'amount_asc') {
      filteredResults.sort((a, b) => (a.amount || 0) - (b.amount || 0));
    } else {
      // Relevance sort
      filteredResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
    }

    counts.all = allResults.length;
    const executionTimeMs = Math.round((performance.now() - startTime) * 100) / 100;

    return {
      results: filteredResults,
      categoryCounts: counts,
      total: filteredResults.length,
      totalFinancialVolume,
      vouchersFinancialVolume,
      advancesFinancialVolume,
      vouchersCount,
      advancesCount,
      staffCount,
      masterCount,
      executionTimeMs,
    };
  }
}

export const searchEngine = new GlobalSearchEngine();
