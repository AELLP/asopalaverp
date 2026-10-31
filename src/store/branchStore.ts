import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { Branch, BranchWallet, DrawerSession } from '@/types/database';
import { DEFAULT_BRANCHES, normalizeBranchCode, normalizeBranchId } from '@/lib/utils';
import { showToast } from '@/components/ui/ToastContainer';

import { useAuthStore } from '@/store/authStore';

interface BranchState {
  selectedBranchId: string; // 'Aellp-ASI', 'Aellp-AP', 'ASM', etc.
  branches: Branch[];
  wallets: Record<string, BranchWallet>;
  currentSession: DrawerSession | null;
  loading: boolean;
  lastFetched: number;
  setSelectedBranchId: (id: string) => void;
  setBranches: (branches: Branch[]) => void;
  setWallets: (wallets: Record<string, BranchWallet>) => void;
  setCurrentSession: (session: DrawerSession | null) => void;
  getActiveBranch: () => Branch;
  fetchBranchesAndWallets: (force?: boolean) => Promise<void>;
}

let branchFetchInFlight: Promise<void> | null = null;
let lastForceFetchTime = 0;

const getInitialBranch = (): string => {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const b = params.get('branch');
    if (b) {
      if (b.toUpperCase() === 'ALL') return 'ALL';
      return normalizeBranchId(b);
    }
  }
  return 'Aellp-ASI';
};

export const useBranchStore = create<BranchState>((set, get) => ({
  selectedBranchId: getInitialBranch(),
  branches: DEFAULT_BRANCHES,
  wallets: {},
  currentSession: null,
  loading: false,

  setSelectedBranchId: (id) => {
    const authState = useAuthStore.getState();
    const canonicalId = id === 'ALL' ? 'ALL' : normalizeBranchId(id);

    // Security boundary: If user is logged in and not authorized for this branch, block and fallback
    if (authState.user && !authState.isBranchAllowed(canonicalId)) {
      const allowed = authState.getAllowedBranches(get().branches);
      const fallbackId = allowed[0]?.branch_id || 'Aellp-ASI';
      set({ selectedBranchId: fallbackId });
      showToast({
        type: 'warning',
        title: 'Access Restricted',
        message: 'You are only authorized to access your assigned showroom branch.',
      });
      return;
    }

    const prev = get().selectedBranchId;
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (canonicalId === 'Aellp-ASI' || !canonicalId) {
        url.searchParams.delete('branch');
      } else {
        url.searchParams.set('branch', canonicalId);
      }
      window.history.pushState({ branch: canonicalId }, '', url.toString());
    }
    set({ selectedBranchId: canonicalId });

    if (prev !== canonicalId) {
      const branchObj = get().getActiveBranch();
      showToast({
        type: 'info',
        title: 'Shop Switched',
        message: `Active branch is now ${branchObj.branch_name}.`,
      });
    }
  },
  setBranches: (branches) => set({ branches }),
  setWallets: (wallets) => set({ wallets }),
  setCurrentSession: (session) => set({ currentSession: session }),

  getActiveBranch: () => {
    const { selectedBranchId, branches } = get();
    if (selectedBranchId === 'ALL') {
      return {
        branch_id: 'ALL',
        branch_code: 'ALL',
        branch_name: 'All Showrooms',
        short_name: 'All Showrooms',
        entity_company_name: 'Asopalav Endeavours LLP',
        accountant_name: 'Central Accounts',
        contact_phone: '+91 9925009050',
        contact_email: 'accounts@asopalav.com',
        city: 'All Cities',
        state: 'Gujarat',
        address: 'All Showrooms Combined',
        min_cash_threshold: 0,
        max_cash_ceiling: 100000,
        max_upi_ceiling: 200000,
        is_active: true,
      };
    }

    const targetCode = normalizeBranchCode(selectedBranchId);
    const branchList = branches && branches.length > 0 ? branches : DEFAULT_BRANCHES;
    const found = branchList.find(
      (b) =>
        b.branch_id === selectedBranchId ||
        normalizeBranchCode(b.branch_id) === targetCode ||
        normalizeBranchCode(b.branch_code) === targetCode
    );

    if (found) return found;

    // Fallback to matching default branch catalog
    const defaultFound = DEFAULT_BRANCHES.find(
      (b) =>
        b.branch_id === selectedBranchId ||
        normalizeBranchCode(b.branch_id) === targetCode ||
        normalizeBranchCode(b.branch_code) === targetCode
    );

    return defaultFound || DEFAULT_BRANCHES[0];
  },

  lastFetched: 0,

  fetchBranchesAndWallets: async (force = false) => {
    const now = Date.now();
    if (force && now - lastForceFetchTime < 3000) return;
    if (force) lastForceFetchTime = now;
    const { lastFetched, branches } = get();

    // Cache valid for 5 minutes when not forced; force=true always fetches immediately from Supabase
    if (!force && lastFetched > 0 && branches.length >= DEFAULT_BRANCHES.length) {
      if (now - lastFetched < 5 * 60 * 1000) {
        return;
      }
    }

    if (branchFetchInFlight) {
      return branchFetchInFlight;
    }

    set({ loading: true });

    branchFetchInFlight = (async () => {
      try {
        // 1. Fetch real branches and wallets in parallel
        const [bRes, wRes] = await Promise.all([
          supabase.from('branches').select('*').eq('is_active', true).order('branch_name'),
          supabase.from('branch_wallets').select('*'),
        ]);

        let mergedBranches = bRes.data && bRes.data.length > 0 ? bRes.data : [...DEFAULT_BRANCHES];
        set({ branches: mergedBranches });

        const walletMap: Record<string, BranchWallet> = {};
        if (wRes.data && wRes.data.length > 0) {
          wRes.data.forEach((w) => {
            walletMap[w.branch_id] = w;
            walletMap[normalizeBranchCode(w.branch_id)] = w;
            if (typeof window !== 'undefined') {
              try {
                localStorage.setItem(`asopalav_wallet_${w.branch_id}`, JSON.stringify(w));
                localStorage.setItem(`asopalav_wallet_${normalizeBranchCode(w.branch_id)}`, JSON.stringify(w));
              } catch {}
            }
          });

          // Compute unified ALL showrooms wallet
          const totalCash = wRes.data.reduce((sum, w) => sum + (Number(w.cash_balance) || 0), 0);
          const totalUpi = wRes.data.reduce((sum, w) => sum + (Number(w.upi_balance) || 0), 0);
          const allWallet: BranchWallet = {
            branch_id: 'ALL',
            cash_balance: totalCash,
            upi_balance: totalUpi,
          };
          walletMap['ALL'] = allWallet;
          if (typeof window !== 'undefined') {
            try {
              localStorage.setItem('asopalav_wallet_ALL', JSON.stringify(allWallet));
            } catch {}
          }
        }
        set({ wallets: walletMap });
        set({ lastFetched: Date.now() });

// Read query completed: Zustand state updated reactively
      } catch (e) {
        console.warn('Error fetching branches and wallets from database:', e);
      } finally {
        set({ loading: false });
        branchFetchInFlight = null;
      }
    })();

    return branchFetchInFlight;
  },
}));

/**
 * Consolidated into src/lib/realtimeSync.ts 'asopalav-live-sync' channel.
 * Kept as a lightweight no-op export for backwards compatibility.
 */
export const initWalletRealtimeSubscription = () => {
  // Consolidated into single channel via initRealtimeSync()
};

