import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { useNotificationStore } from '@/store/notificationStore';
import { useAuthStore } from '@/store/authStore';
import { showToast } from '@/components/ui/ToastContainer';

export type MutationType =
  | 'create_voucher'
  | 'voucher_splits'
  | 'disburse_advance'
  | 'settle_advance'
  | 'float_topup'
  | 'cash_closing'
  | 'void_voucher'
  | 'update_voucher'
  | 'delete_voucher'
  | 'flag_salary_deduction'
  | 'waive_advance'
  | 'delete_advance'
  | 'wallet_upsert'
  | 'wallet_ledger';

export interface OfflineMutation {
  id: string;
  type: MutationType;
  table: string;
  action: 'insert' | 'upsert' | 'update' | 'delete';
  payload: any;
  matchField?: string;
  matchValue?: any;
  timestamp: string;
  retryCount: number;
  lastError?: string;
  description: string;
}

interface OfflineQueueState {
  mutations: OfflineMutation[];
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: string | null;
  lastSyncStatus: 'idle' | 'success' | 'partial' | 'error';
  enqueueMutation: (mutation: {
    type: MutationType;
    table: string;
    action: 'insert' | 'upsert' | 'update' | 'delete';
    payload: any;
    matchField?: string;
    matchValue?: any;
    description: string;
  }) => string;
  removeMutation: (id: string) => void;
  clearQueue: () => void;
  processSyncQueue: () => Promise<{ succeeded: number; failed: number }>;
  setOnlineStatus: (isOnline: boolean) => void;
}

const STORAGE_KEY = 'asopalav_offline_mutations';

const loadPersistedMutations = (): OfflineMutation[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('Failed to load offline mutations from localStorage:', e);
    return [];
  }
};

const savePersistedMutations = (mutations: OfflineMutation[]) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mutations));
  } catch (e) {
    console.warn('Failed to save offline mutations to localStorage:', e);
  }
};

export const useOfflineQueue = create<OfflineQueueState>((set, get) => ({
  mutations: loadPersistedMutations(),
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isSyncing: false,
  lastSyncTime: null,
  lastSyncStatus: 'idle',

  setOnlineStatus: (isOnline: boolean) => {
    set({ isOnline });
    if (isOnline && get().mutations.length > 0 && !get().isSyncing) {
      get().processSyncQueue();
    }
  },

  enqueueMutation: (mutationData) => {
    const newMutation: OfflineMutation = {
      ...mutationData,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      retryCount: 0,
    };

    const updated = [...get().mutations, newMutation];
    set({ mutations: updated });
    savePersistedMutations(updated);

    // If online, attempt background sync immediately
    if (get().isOnline && !get().isSyncing) {
      setTimeout(() => {
        get().processSyncQueue();
      }, 500);
    }

    return newMutation.id;
  },

  removeMutation: (id: string) => {
    const updated = get().mutations.filter((m) => m.id !== id);
    set({ mutations: updated });
    savePersistedMutations(updated);
  },

  clearQueue: () => {
    set({ mutations: [] });
    savePersistedMutations([]);
  },

  processSyncQueue: async () => {
    const { mutations, isSyncing, isOnline } = get();
    if (isSyncing || mutations.length === 0 || !isOnline) {
      return { succeeded: 0, failed: 0 };
    }

    set({ isSyncing: true, lastSyncStatus: 'idle' });

    // C-2 Security: Validate session is still active before replaying mutations.
    // A mutation queued hours ago may now have an expired or revoked session.
    let currentUserId: string | null = null;
        try {
      const authUser = useAuthStore.getState().user;
      currentUserId = authUser?.id ?? null;
          } catch {}

    // High-risk mutation types that MUST have a verified active session to replay
    const ROLE_GATED_TYPES: Set<string> = new Set([
      'create_voucher',
      'disburse_advance',
      'float_topup',
      'cash_closing',
      'void_voucher',
      'delete_voucher',
      'waive_advance',
      'wallet_upsert',
    ]);

    let succeeded = 0;
    let failed = 0;
    const remainingMutations: OfflineMutation[] = [];

    for (const mutation of mutations) {
      try {
        // C-2: Block high-risk mutations if no active authenticated session
        if (ROLE_GATED_TYPES.has(mutation.type) && !currentUserId) {
          console.warn(`[OfflineQueue] Blocking replay of '${mutation.type}' — no active session. Will retry after login.`);
          remainingMutations.push(mutation);
          failed++;
          continue;
        }

        let query: any = (supabase as any).from(mutation.table);

        if (mutation.action === 'insert') {
          const { error } = await query.insert(
            Array.isArray(mutation.payload) ? mutation.payload : [mutation.payload]
          );
          if (error) throw error;
        } else if (mutation.action === 'upsert') {
          const { error } = await query.upsert(
            Array.isArray(mutation.payload) ? mutation.payload : [mutation.payload]
          );
          if (error) throw error;
        } else if (mutation.action === 'update') {
          if (!mutation.matchField || mutation.matchValue === undefined) {
            throw new Error('Update mutation missing matchField/matchValue');
          }
          const { error } = await query
            .update(mutation.payload)
            .eq(mutation.matchField, mutation.matchValue);
          if (error) throw error;
        } else if (mutation.action === 'delete') {
          if (!mutation.matchField || mutation.matchValue === undefined) {
            throw new Error('Delete mutation missing matchField/matchValue');
          }
          const { error } = await query.delete().eq(mutation.matchField, mutation.matchValue);
          if (error) throw error;
        }

        succeeded++;
      } catch (err: any) {
        console.error(`Failed to replay mutation ${mutation.id} (${mutation.description}):`, err);
        failed++;
        // Cap retries at 10 to prevent infinite billing loops
        if (mutation.retryCount < 10) {
          remainingMutations.push({
            ...mutation,
            retryCount: mutation.retryCount + 1,
            lastError: err?.message || 'Database sync error',
          });
        } else {
          console.error(`Mutation ${mutation.id} permanently failed after 10 retries. Discarding.`);
        }
      }
    }

    const newSyncStatus =
      failed === 0 ? 'success' : succeeded > 0 ? 'partial' : 'error';

    set({
      mutations: remainingMutations,
      isSyncing: false,
      lastSyncTime: new Date().toISOString(),
      lastSyncStatus: newSyncStatus,
    });
    savePersistedMutations(remainingMutations);

    if (succeeded > 0) {
      useNotificationStore.getState().addNotification({
        title: 'Offline Sync Complete',
        message: `Successfully synchronized ${succeeded} counter transaction(s) to cloud database.${
          failed > 0 ? ` (${failed} pending retry)` : ''
        }`,
        type: 'system',
        target_roles: ['Super_Admin', 'Store_Manager', 'Cashier'],
      });
      window.dispatchEvent(new CustomEvent('asopalav:wallet-updated'));

      showToast({
        type: 'success',
        title: 'Sync Complete',
        message: `Saved ${succeeded} offline transaction(s) to cloud.`,
      });
    }

    return { succeeded, failed };
  },
}));

// Setup automatic online/offline browser event listeners
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useOfflineQueue.getState().setOnlineStatus(true);
    showToast({
      type: 'success',
      title: 'Connected to Internet',
      message: 'Internet connection is back. Live cloud sync active.',
    });
  });
  window.addEventListener('offline', () => {
    useOfflineQueue.getState().setOnlineStatus(false);
    showToast({
      type: 'warning',
      title: 'No Internet Connection',
      message: 'Working in offline mode. Changes will sync when back online.',
    });
  });
}
