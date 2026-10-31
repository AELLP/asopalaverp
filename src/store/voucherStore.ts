import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { normalizeBranchCode, normalizeBranchId } from '@/lib/utils';
import {
  ExpenseVoucher,
  ExpenseCategory,
  Department,
  CourierPartner,
  StaffMember,
} from '@/types/database';

interface MasterDataCache {
  categories: ExpenseCategory[];
  departments: Department[];
  couriers: CourierPartner[];
  staff: StaffMember[];
  lastFetched: number;
}

interface VoucherStoreState {
  vouchers: Record<string, ExpenseVoucher[]>; // key: canonical branchId or code or 'ALL'
  vouchersLastFetched: Record<string, number>;
  masterData: MasterDataCache;
  loadingVouchers: boolean;
  loadingMaster: boolean;

  // Actions
  fetchMasterData: (force?: boolean) => Promise<void>;
  fetchVouchers: (branchId?: string, force?: boolean) => Promise<void>;
  addVoucherLocally: (voucher: ExpenseVoucher) => void;
  updateVoucherLocally: (voucher: ExpenseVoucher) => void;
  removeVoucherLocally: (voucherNumber: string, branchId?: string) => void;
  invalidateMasterData: () => void;
  invalidateVouchers: (branchId?: string) => void;
}

// In-flight promise deduplication
let masterDataInFlight: Promise<void> | null = null;
const vouchersInFlight: Record<string, Promise<void> | null> = {};

// Cache duration: 10 minutes for master data, 10 minutes for vouchers (synchronized via Realtime)
const MASTER_CACHE_TTL = 10 * 60 * 1000;
const VOUCHERS_CACHE_TTL = 10 * 60 * 1000;

export const useVoucherStore = create<VoucherStoreState>((set, get) => ({
  vouchers: {},
  vouchersLastFetched: {},
  masterData: {
    categories: [],
    departments: [],
    couriers: [],
    staff: [],
    lastFetched: 0,
  },
  loadingVouchers: false,
  loadingMaster: false,

  fetchMasterData: async (force = false) => {
    const now = Date.now();
    const { masterData } = get();

    // Return cached if still valid and not forced
    if (!force && masterData.lastFetched > 0 && now - masterData.lastFetched < MASTER_CACHE_TTL) {
      return;
    }

    // Deduplicate in-flight requests only when not forced
    if (!force && masterDataInFlight) {
      return masterDataInFlight;
    }

    set({ loadingMaster: true });

    masterDataInFlight = (async () => {
      try {
        const [cRes, dRes, crRes, sRes] = await Promise.all([
          supabase.from('expense_categories').select('*').eq('is_active', true).order('category_name'),
          supabase.from('departments').select('*').eq('is_active', true).order('department_name'),
          supabase.from('courier_partners').select('*').eq('is_active', true).order('partner_name'),
          supabase.from('staff_members').select('*').eq('is_active', true).order('first_name'),
        ]);

        set({
          masterData: {
            categories: cRes.data || [],
            departments: dRes.data || [],
            couriers: crRes.data || [],
            staff: sRes.data || [],
            lastFetched: Date.now(),
          },
        });
      } catch (err) {
        console.warn('Error fetching master data:', err);
      } finally {
        set({ loadingMaster: false });
        masterDataInFlight = null;
      }
    })();

    return masterDataInFlight;
  },

  fetchVouchers: async (branchId = 'ALL', force = false) => {
    const now = Date.now();
    const code = normalizeBranchCode(branchId);
    const isAll = !branchId || branchId === 'ALL' || code === 'ALL';
    const cacheKey = isAll ? 'ALL' : normalizeBranchId(branchId);
    const lastFetched = get().vouchersLastFetched[cacheKey] || 0;

    // Return cached if still valid and not forced
    if (!force && lastFetched > 0 && now - lastFetched < VOUCHERS_CACHE_TTL) {
      return;
    }

    // Deduplicate in-flight requests for this branch
    if (vouchersInFlight[cacheKey]) {
      return vouchersInFlight[cacheKey]!;
    }

    set({ loadingVouchers: true });

    vouchersInFlight[cacheKey] = (async () => {
      try {
        let vQuery = supabase
          .from('expense_vouchers')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(10000);

        if (!isAll) {
          vQuery = vQuery.or(`branch_id.eq.${cacheKey},branch_id.eq.${code},branch_code.eq.${code}`);
        }

        const { data, error } = await vQuery;

        let voucherList: ExpenseVoucher[] = [];
        if (!error && data !== null) {
          voucherList = data;
          localStorage.setItem(`asopalav_vouchers_${cacheKey}`, JSON.stringify(data.slice(0, 500)));
        } else {
          const local =
            localStorage.getItem(`asopalav_vouchers_${cacheKey}`) ||
            (code !== 'ALL' ? localStorage.getItem(`asopalav_vouchers_${code}`) : null);
          if (local) {
            try {
              const parsed = JSON.parse(local);
              if (Array.isArray(parsed)) {
                voucherList = parsed;
              }
            } catch {
              // Ignore JSON error
            }
          }
        }

        set((state) => ({
          vouchers: {
            ...state.vouchers,
            [cacheKey]: voucherList,
            ...(code !== 'ALL' ? { [code]: voucherList, [branchId]: voucherList } : {}),
          },
          vouchersLastFetched: {
            ...state.vouchersLastFetched,
            [cacheKey]: Date.now(),
            ...(code !== 'ALL' ? { [code]: Date.now(), [branchId]: Date.now() } : {}),
          },
        }));
      } catch (err) {
        console.warn('Error fetching vouchers:', err);
        const fallbackList: ExpenseVoucher[] = [];
        set((state) => ({
          vouchers: {
            ...state.vouchers,
            [cacheKey]: fallbackList,
            ...(code !== 'ALL' ? { [code]: fallbackList, [branchId]: fallbackList } : {}),
          },
        }));
      } finally {
        set({ loadingVouchers: false });
        vouchersInFlight[cacheKey] = null;
      }
    })();

    return vouchersInFlight[cacheKey]!;
  },

  addVoucherLocally: (voucher: ExpenseVoucher) => {
    set((state) => {
      const code = normalizeBranchCode(voucher.branch_code || voucher.branch_id);
      const canonicalBranchKey = normalizeBranchId(voucher.branch_id);
      const allKey = 'ALL';

      const isSameVoucher = (v: ExpenseVoucher) =>
        v.voucher_number === voucher.voucher_number &&
        (!voucher.branch_id || !v.branch_id || normalizeBranchCode(v.branch_code || v.branch_id) === code);

      const updateList = (list?: ExpenseVoucher[]) => {
        if (!list) return [voucher];
        if (list.some(isSameVoucher)) {
          return list.map((v) => (isSameVoucher(v) ? voucher : v));
        }
        return [voucher, ...list];
      };

      return {
        vouchers: {
          ...state.vouchers,
          [allKey]: updateList(state.vouchers[allKey]),
          [canonicalBranchKey]: updateList(state.vouchers[canonicalBranchKey]),
          [code]: updateList(state.vouchers[code]),
          ...(voucher.branch_id ? { [voucher.branch_id]: updateList(state.vouchers[voucher.branch_id]) } : {}),
        },
      };
    });
  },

  updateVoucherLocally: (voucher: ExpenseVoucher) => {
    set((state) => {
      const code = normalizeBranchCode(voucher.branch_code || voucher.branch_id);
      const canonicalBranchKey = normalizeBranchId(voucher.branch_id);
      const allKey = 'ALL';

      const isSameVoucher = (v: ExpenseVoucher) =>
        v.voucher_number === voucher.voucher_number &&
        (!voucher.branch_id || !v.branch_id || normalizeBranchCode(v.branch_code || v.branch_id) === code);

      const updateList = (list?: ExpenseVoucher[]) => {
        if (!list) return [voucher];
        return list.map((v) => (isSameVoucher(v) ? { ...v, ...voucher } : v));
      };

      return {
        vouchers: {
          ...state.vouchers,
          [allKey]: updateList(state.vouchers[allKey]),
          [canonicalBranchKey]: updateList(state.vouchers[canonicalBranchKey]),
          [code]: updateList(state.vouchers[code]),
          ...(voucher.branch_id ? { [voucher.branch_id]: updateList(state.vouchers[voucher.branch_id]) } : {}),
        },
      };
    });
  },

  removeVoucherLocally: (voucherNumber: string, branchId?: string) => {
    set((state) => {
      const allKey = 'ALL';
      const targetCode = branchId ? normalizeBranchCode(branchId) : null;
      const filterList = (list?: ExpenseVoucher[]) => {
        if (!list) return [];
        return list.filter(
          (v) =>
            !(
              v.voucher_number === voucherNumber &&
              (!targetCode || !v.branch_id || normalizeBranchCode(v.branch_code || v.branch_id) === targetCode)
            )
        );
      };

      const updatedVouchers: Record<string, ExpenseVoucher[]> = {
        ...state.vouchers,
        [allKey]: filterList(state.vouchers[allKey]),
      };

      if (branchId) {
        const code = normalizeBranchCode(branchId);
        const canonicalId = normalizeBranchId(branchId);
        if (updatedVouchers[canonicalId]) updatedVouchers[canonicalId] = filterList(updatedVouchers[canonicalId]);
        if (updatedVouchers[code]) updatedVouchers[code] = filterList(updatedVouchers[code]);
        if (updatedVouchers[branchId]) updatedVouchers[branchId] = filterList(updatedVouchers[branchId]);
      } else {
        Object.keys(updatedVouchers).forEach((bKey) => {
          updatedVouchers[bKey] = filterList(updatedVouchers[bKey]);
        });
      }

      return { vouchers: updatedVouchers };
    });
  },

  invalidateMasterData: () => {
    set((state) => ({
      masterData: {
        ...state.masterData,
        lastFetched: 0,
      },
    }));
  },

  invalidateVouchers: (branchId) => {
    if (branchId) {
      const code = normalizeBranchCode(branchId);
      const canonicalId = normalizeBranchId(branchId);
      set((state) => ({
        vouchersLastFetched: {
          ...state.vouchersLastFetched,
          [branchId]: 0,
          [code]: 0,
          [canonicalId]: 0,
          ALL: 0,
        },
      }));
    } else {
      set({ vouchersLastFetched: {} });
    }
  },
}));
