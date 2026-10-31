import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { AppUser, RolePermissions, Branch } from '@/types/database';
import { DEFAULT_BRANCHES, normalizeBranchCode } from '@/lib/utils';
import bcrypt from 'bcryptjs';
import { showToast } from '@/components/ui/ToastContainer';
import { useUIStore } from '@/store/uiStore';

export interface CashierProfile extends AppUser {
  lock_pin_hash?: string;
  designation_title?: string;
  pin?: string;
}

export const isPrivilegedAdminRole = (role?: string | null): boolean => {
  if (!role) return false;
  const normalized = role.trim().toLowerCase().replace(/[- ]/g, '_');
  return (
    normalized === 'super_admin' ||
    normalized === 'superadmin' ||
    normalized === 'admin' ||
    normalized === 'developer' ||
    normalized === 'owner'
  );
};

const DEFAULT_SUPER_PERMISSIONS: RolePermissions = {
  role_code: 'Super_Admin',
  can_create_voucher: true,
  can_void_voucher: true,
  can_backdate_voucher: true,
  can_disburse_advance: true,
  can_settle_advance: true,
  max_advance_limit: 10000000.0,
  can_inject_float: true,
  can_verify_f9_closing: true,
  can_export_tally: true,
  can_download_hr_payroll: true,
  can_view_all_branches: true,
  can_view_audit_logs: true,
  can_manage_users_roles: true,
  can_manage_periods: true,
};

const DEFAULT_MANAGER_PERMISSIONS: RolePermissions = {
  role_code: 'Store_Manager',
  can_create_voucher: true,
  can_void_voucher: true,
  can_backdate_voucher: false,
  can_disburse_advance: true,
  can_settle_advance: true,
  max_advance_limit: 50000.0,
  can_inject_float: true,
  can_verify_f9_closing: true,
  can_export_tally: true,
  can_download_hr_payroll: true,
  can_view_all_branches: false,
  can_view_audit_logs: true,
  can_manage_users_roles: false,
  can_manage_periods: false,
};

const DEFAULT_CASHIER_PERMISSIONS: RolePermissions = {
  role_code: 'Cashier',
  can_create_voucher: true,
  can_void_voucher: false,
  can_backdate_voucher: false,
  can_disburse_advance: true,
  can_settle_advance: true,
  max_advance_limit: 10000.0,
  can_inject_float: false,
  can_verify_f9_closing: false,
  can_export_tally: false,
  can_download_hr_payroll: false,
  can_view_all_branches: false,
  can_view_audit_logs: false,
  can_manage_users_roles: false,
  can_manage_periods: false,
};

const DEFAULT_AUDITOR_PERMISSIONS: RolePermissions = {
  role_code: 'Auditor',
  can_create_voucher: false,
  can_void_voucher: false,
  can_backdate_voucher: false,
  can_disburse_advance: false,
  can_settle_advance: false,
  max_advance_limit: 0,
  can_inject_float: false,
  can_verify_f9_closing: false,
  can_export_tally: true,
  can_download_hr_payroll: true,
  can_view_all_branches: true,
  can_view_audit_logs: true,
  can_manage_users_roles: false,
  can_manage_periods: false,
};

const SESSION_STORAGE_KEY = 'asopalav_session_user';
const SESSION_TIMESTAMP_KEY = 'asopalav_session_timestamp';
const PIN_STORAGE_KEY = 'asopalav_custom_pins';

// 4-Hour maximum session lifetime for showroom terminal security
export const SESSION_LIFETIME_MS = 4 * 60 * 60 * 1000; // 4 Hours = 14,400,000 ms

const getStoredSession = (): { user: AppUser | null; timestamp: number | null } => {
  if (typeof window === 'undefined') return { user: null, timestamp: null };
  try {
    const rawUser = localStorage.getItem(SESSION_STORAGE_KEY);
    const rawTs = localStorage.getItem(SESSION_TIMESTAMP_KEY);
    if (!rawUser) return { user: null, timestamp: null };

    const timestamp = rawTs ? Number(rawTs) : null;
    const now = Date.now();

    // If timestamp is missing, invalid or expired, purge and require login
    if (!rawTs || !timestamp || isNaN(timestamp) || (now - timestamp > SESSION_LIFETIME_MS)) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(SESSION_TIMESTAMP_KEY);
      return { user: null, timestamp: null };
    }

    return { user: JSON.parse(rawUser), timestamp };
  } catch {
    return { user: null, timestamp: null };
  }
};

const getCustomPins = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(PIN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

interface AuthState {
  user: AppUser | null;
  sessionLoginTime: number | null;
  permissions: RolePermissions | null;
  isAuthenticated: boolean;
  isLocked: boolean;
  availableCashiers: CashierProfile[];
  selectedCashier: CashierProfile | null;
  setSelectedCashier: (cashier: CashierProfile | null) => void;
  fetchAvailableCashiers: () => Promise<void>;
  login: (user: AppUser) => Promise<void>;
  logout: (reason?: string) => void;
  checkSessionExpiry: () => boolean;
  getSessionRemainingMs: () => number;
  getSessionTimeRemainingFormatted: () => string;
  lockScreen: () => void;
  unlockScreen: (pin: string) => boolean;
  quickSwitchCashierByPin: (pin: string, targetUserId?: string) => boolean;
  updateUserPin: (userId: string, newPin: string) => void;
  loadPermissions: (roleCode: string) => Promise<void>;
  can: (permission: keyof RolePermissions) => boolean;
  isBranchAllowed: (branchId: string) => boolean;
  getAllowedBranches: (allBranches: Branch[]) => Branch[];
  /**
   * C-3 Security: Re-validates the cached session role against Supabase.
   * Call on app startup and after a screen unlock from lock state.
   * If the DB role differs from the session role (tampered localStorage), forces logout.
   */
  verifySessionIntegrity: () => Promise<void>;
}

const storedSessionData = getStoredSession();
const initialSession = storedSessionData.user;
const initialTimestamp = storedSessionData.timestamp;

export const useAuthStore = create<AuthState>((set, get) => {
  return {
    user: initialSession,
    sessionLoginTime: initialTimestamp,
    permissions: isPrivilegedAdminRole(initialSession?.role_code)
      ? DEFAULT_SUPER_PERMISSIONS
      : initialSession?.role_code === 'Store_Manager'
      ? DEFAULT_MANAGER_PERMISSIONS
      : initialSession
      ? DEFAULT_CASHIER_PERMISSIONS
      : null,
    isAuthenticated: Boolean(initialSession),
    isLocked: false,
    availableCashiers: initialSession ? [initialSession as CashierProfile] : [],
    selectedCashier: (initialSession as CashierProfile) || null,

    setSelectedCashier: (cashier) => set({ selectedCashier: cashier }),

    fetchAvailableCashiers: async () => {
      try {
        const { data, error } = await supabase
          .from('app_users')
          .select('id, username, first_name, last_name, email, avatar_url, role_code, assigned_branches, avatar_initials, theme_preference, is_active, lock_pin_hash')
          .eq('is_active', true)
          .order('first_name', { ascending: true });

        if (error) {
          console.warn('Error fetching cashiers roster:', error);
          return;
        }

        if (data && data.length > 0) {
          const customPins = getCustomPins();
          const cashiers: CashierProfile[] = data.map((u: any) => {
            const { password_hash, ...safeUser } = u;
            return {
              ...safeUser,
              avatar_url: safeUser.avatar_url || null,
              lock_pin_hash: customPins[safeUser.id] || safeUser.lock_pin_hash || null,
              designation_title: safeUser.role_code ? safeUser.role_code.replace(/_/g, ' ') : 'Cashier',
            };
          });
          set({ availableCashiers: cashiers });

          const currentUser = get().user;
          if (currentUser) {
            const matched = cashiers.find((c) => c.id === currentUser.id || c.username === currentUser.username);
            if (matched) {
              set({
                selectedCashier: matched,
                user: {
                  ...currentUser,
                  avatar_url: matched.avatar_url || currentUser.avatar_url,
                  first_name: matched.first_name || currentUser.first_name,
                  last_name: matched.last_name || currentUser.last_name,
                },
              });
            }
          }
        }
      } catch (err) {
        console.warn('Failed to load active cashier roster:', err);
      }
    },

    login: async (user) => {
      const now = Date.now();
      if (typeof window !== 'undefined') {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
        localStorage.setItem(SESSION_TIMESTAMP_KEY, String(now));
      }

      set({
        user,
        sessionLoginTime: now,
        selectedCashier: user as CashierProfile,
        isAuthenticated: true,
        isLocked: false,
      });

      await get().loadPermissions(user.role_code);
      await get().fetchAvailableCashiers();
      useUIStore.getState().setActivePage('dashboard', true);
    },

    logout: (reason?: string) => {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        localStorage.removeItem(SESSION_TIMESTAMP_KEY);
        // M-8 Security: Clear custom PINs on logout so shared terminals don't retain other users' PIN hashes
        localStorage.removeItem(PIN_STORAGE_KEY);
      }
      useUIStore.getState().setActivePage('dashboard', false);
      set({
        user: null,
        sessionLoginTime: null,
        permissions: null,
        isAuthenticated: false,
        isLocked: false,
        selectedCashier: null,
        availableCashiers: [],
      });
      showToast({
        type: reason ? 'warning' : 'info',
        title: reason ? 'Session Expired' : 'Logged Out',
        message: reason || 'You have been safely signed out.',
      });
    },

    checkSessionExpiry: () => {
      const { sessionLoginTime, isAuthenticated, logout } = get();
      if (!isAuthenticated || !sessionLoginTime) return false;
      const elapsed = Date.now() - sessionLoginTime;
      if (elapsed >= SESSION_LIFETIME_MS) {
        logout('Your 4-hour session has expired for showroom security. Please log in again.');
        return true;
      }
      return false;
    },

    getSessionRemainingMs: () => {
      const { sessionLoginTime, isAuthenticated } = get();
      if (!isAuthenticated || !sessionLoginTime) return 0;
      const remaining = SESSION_LIFETIME_MS - (Date.now() - sessionLoginTime);
      return Math.max(0, remaining);
    },

    getSessionTimeRemainingFormatted: () => {
      const remainingMs = get().getSessionRemainingMs();
      if (remainingMs <= 0) return 'Expired';
      const totalMinutes = Math.floor(remainingMs / (1000 * 60));
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      if (hours > 0) {
        return `${hours}h ${minutes}m`;
      }
      return `${minutes}m`;
    },

    lockScreen: () => {
      const current = get().user;
      const roster = get().availableCashiers;
      const matched = current ? roster.find((c) => c.id === current.id) : roster[0];
      set({ isLocked: true, selectedCashier: matched || (current as CashierProfile) || null });
      get().fetchAvailableCashiers();
      showToast({
        type: 'info',
        title: 'Counter Locked',
        message: 'Screen locked with PIN protection.',
      });
    },

    unlockScreen: (pin: string) => {
      const { user, selectedCashier, availableCashiers } = get();
      const target = selectedCashier || (user ? availableCashiers.find((c) => c.id === user.id) : null) || (user as CashierProfile);
      const customPins = getCustomPins();

      const verifyPin = (candidatePin: string, storedHash?: string | null): boolean => {
        // H-2 Security: Never compare plain-text PIN directly — always use bcrypt
        if (!storedHash || !candidatePin) return false;
        if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
          try {
            return bcrypt.compareSync(candidatePin, storedHash);
          } catch {
            return false;
          }
        }
        // Legacy plain-text pin in DB (pre-hash era) — treat as invalid and refuse match
        return false;
      };

      if (target) {
        const targetPin = customPins[target.id] || target.lock_pin_hash || (target as any).pin;
        if (verifyPin(pin, targetPin)) {
          set({ user: target, isLocked: false });
          get().loadPermissions(target.role_code);
          showToast({
            type: 'success',
            title: 'Counter Unlocked',
            message: `Unlocked by ${target.first_name || 'Cashier'}.`,
          });
          return true;
        }
      }

      if (user) {
        const userPin = customPins[user.id] || (user as any).lock_pin_hash;
        if (verifyPin(pin, userPin)) {
          set({ isLocked: false });
          showToast({
            type: 'success',
            title: 'Counter Unlocked',
            message: `Unlocked by ${user.first_name || 'Cashier'}.`,
          });
          return true;
        }
      }

      showToast({
        type: 'error',
        title: 'Wrong PIN',
        message: 'The lock PIN entered is incorrect.',
      });
      return false;
    },

    quickSwitchCashierByPin: (pin: string, targetUserId?: string) => {
      const { availableCashiers } = get();
      const customPins = getCustomPins();

      const verifyPin = (candidatePin: string, storedHash?: string | null): boolean => {
        // H-2 Security: Never compare plain-text PIN directly — always use bcrypt
        if (!storedHash || !candidatePin) return false;
        if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
          try {
            return bcrypt.compareSync(candidatePin, storedHash);
          } catch {
            return false;
          }
        }
        // Legacy plain-text pin in DB (pre-hash era) — treat as invalid and refuse match
        return false;
      };

      if (targetUserId) {
        const target = availableCashiers.find((c) => c.id === targetUserId);
        if (target) {
          const targetPin = customPins[target.id] || target.lock_pin_hash || (target as any).pin;
          if (verifyPin(pin, targetPin)) {
            const switchTime = Date.now();
            set({ user: target, selectedCashier: target, isLocked: false });
            if (typeof window !== 'undefined') {
              // H-1 Security: Reset session timestamp so the 4-hour TTL restarts for the switched-to user
              localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(target));
              localStorage.setItem(SESSION_TIMESTAMP_KEY, String(switchTime));
            }
            get().loadPermissions(target.role_code);
            showToast({
              type: 'activity',
              title: 'Cashier Switched',
              message: `Active cashier is now ${target.first_name} ${target.last_name || ''}.`,
            });
            return true;
          }
        }
        showToast({
          type: 'error',
          title: 'Incorrect PIN',
          message: 'The PIN entered does not match this cashier profile.',
        });
        return false;
      }

      const match = availableCashiers.find((c) => {
        const cashierPin = customPins[c.id] || c.lock_pin_hash || (c as any).pin;
        return verifyPin(pin, cashierPin);
      });

      if (match) {
        const switchTime = Date.now();
        set({ user: match, selectedCashier: match, isLocked: false });
        if (typeof window !== 'undefined') {
          // H-1 Security: Reset session timestamp so the 4-hour TTL restarts for the switched-to user
          localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(match));
          localStorage.setItem(SESSION_TIMESTAMP_KEY, String(switchTime));
        }
        get().loadPermissions(match.role_code);
        showToast({
          type: 'activity',
          title: 'Cashier Switched',
          message: `Active cashier is now ${match.first_name} ${match.last_name || ''}.`,
        });
        return true;
      }

      showToast({
        type: 'error',
        title: 'Incorrect PIN',
        message: 'No cashier profile matched this PIN.',
      });
      return false;
    },

    updateUserPin: (userId: string, newPin: string) => {
      const hashedPin = bcrypt.hashSync(newPin, 10);
      const customPins = getCustomPins();
      customPins[userId] = hashedPin;
      localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(customPins));

      const updated = get().availableCashiers.map((c) =>
        c.id === userId ? { ...c, lock_pin_hash: hashedPin } : c
      );
      set({ availableCashiers: updated });

      // M-9: Also sync to Supabase so PIN persists across devices and cache clears
      (async () => {
        try {
          const { supabase: sb } = await import('@/lib/supabase');
          await sb.from('app_users').update({ lock_pin_hash: hashedPin }).eq('id', userId);
        } catch (e) {
          console.warn('[PIN] Could not sync PIN to Supabase — stored locally only:', e);
        }
      })();
      showToast({
        type: 'success',
        title: 'PIN Updated',
        message: 'Your personal quick-switch lock PIN has been saved.',
      });
    },

    loadPermissions: async (roleCode: string) => {
      try {
        const { data } = await supabase
          .from('role_permissions')
          .select('*')
          .eq('role_code', roleCode)
          .maybeSingle();

        if (data) {
          set({ permissions: data });
          return;
        }
      } catch (e) {
        console.warn('Error loading role permissions from database:', e);
      }

      if (isPrivilegedAdminRole(roleCode)) {
        set({ permissions: DEFAULT_SUPER_PERMISSIONS });
      } else if (roleCode === 'Store_Manager') {
        set({ permissions: DEFAULT_MANAGER_PERMISSIONS });
      } else if (roleCode === 'Cashier' || roleCode === 'Showroom_Cashier') {
        set({ permissions: DEFAULT_CASHIER_PERMISSIONS });
      } else if (roleCode === 'Auditor') {
        set({ permissions: DEFAULT_AUDITOR_PERMISSIONS });
      } else {
        set({ permissions: DEFAULT_CASHIER_PERMISSIONS });
      }
    },

    can: (permission) => {
      const { permissions, user } = get();
      if (isPrivilegedAdminRole(user?.role_code)) return true;
      if (!permissions) return false;
      return Boolean(permissions[permission]);
    },

    isBranchAllowed: (branchId: string) => {
      const { user, can } = get();
      if (!user) return false;
      const isSuper = isPrivilegedAdminRole(user.role_code) || can('can_view_all_branches');
      if (branchId === 'ALL') return isSuper;
      if (isSuper) return true;

      const assigned = user.assigned_branches && user.assigned_branches.length > 0
        ? user.assigned_branches
        : ['Aellp-ASI'];

      if (assigned.includes('*')) return isSuper;

      const targetCode = normalizeBranchCode(branchId);
      return assigned.some(
        (b) => b === branchId || normalizeBranchCode(b) === targetCode
      );
    },

    getAllowedBranches: (allBranches: Branch[]) => {
      const { user, can } = get();
      const list = allBranches && allBranches.length > 0 ? allBranches : DEFAULT_BRANCHES;
      if (!user) return [list[0]];
      const isSuper = isPrivilegedAdminRole(user.role_code) || can('can_view_all_branches');
      if (isSuper) return list;

      const assigned = user.assigned_branches && user.assigned_branches.length > 0
        ? user.assigned_branches
        : ['Aellp-ASI'];

      const filtered = list.filter((b) => {
        const bCode = normalizeBranchCode(b.branch_code || b.branch_id);
        return assigned.some(
          (ub) => ub === b.branch_id || normalizeBranchCode(ub) === bCode
        );
      });
      return filtered.length > 0 ? filtered : [list[0]];
    },

    verifySessionIntegrity: async () => {
      const { user } = get();
      if (!user?.id) return; // No session to verify

      try {
        const { supabase: sb } = await import('@/lib/supabase');
        const { data: dbUser, error } = await sb
          .from('app_users')
          .select('role_code, is_active, assigned_branches')
          .eq('id', user.id)
          .maybeSingle();

        if (error) {
          // Network error — do NOT force logout, session is still locally valid
          console.warn('[C-3 SessionIntegrity] Could not reach DB, skipping integrity check:', error.message);
          return;
        }

        if (!dbUser) {
          // User ID not found in DB — may have been deleted
          console.warn('[C-3 SessionIntegrity] User ID not found in DB. Forcing logout.');
          get().logout('Account not found. Please log in again.');
          return;
        }

        if (!dbUser.is_active) {
          console.warn('[C-3 SessionIntegrity] Account is deactivated in DB. Forcing logout.');
          get().logout('Your account has been deactivated by an administrator.');
          return;
        }

        // Normalize roles for comparison
        const sessionRole = user.role_code === 'Showroom_Cashier' ? 'Cashier' : user.role_code;
        const dbRole = dbUser.role_code === 'Showroom_Cashier' ? 'Cashier' : dbUser.role_code;

        if (dbRole && dbRole !== sessionRole) {
          // Role was changed in DB (e.g., demotion from Super_Admin to Cashier)
          // Update the session to reflect reality without full logout
          console.warn(`[C-3 SessionIntegrity] Role mismatch: session='${sessionRole}', DB='${dbRole}'. Updating session.`);
          const updatedUser = { ...user, role_code: dbRole };
          if (typeof window !== 'undefined') {
            localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updatedUser));
          }
          set({ user: updatedUser });
          await get().loadPermissions(dbRole);

          showToast({
            type: 'warning',
            title: 'Session Updated',
            message: 'Your account permissions were updated by an administrator. Your session has been refreshed.',
          });
        }
      } catch (e) {
        console.warn('[C-3 SessionIntegrity] Integrity check failed (non-critical):', e);
      }
    },
  };
});

if (typeof window !== 'undefined') {
  window.addEventListener('asopalav:users-roles-updated', () => {
    const state = useAuthStore.getState();
    if (state.user?.role_code) {
      state.loadPermissions(state.user.role_code);
      state.verifySessionIntegrity();
      state.fetchAvailableCashiers();
    }
  });
}
