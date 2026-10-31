import { useAuthStore, isPrivilegedAdminRole } from '@/store/authStore';

/**
 * Role-Gated Operational Permissions
 * Replaces client-side bypass switches with role verification.
 * Only authenticated SuperAdmins, Admins, Developers, and Owners can authorize
 * exceptional overrides. Cashiers cannot bypass drawer balance limits or period locks.
 */

const getRolePrivilege = (): boolean => {
  try {
    const role = useAuthStore.getState().user?.role_code;
    return isPrivilegedAdminRole(role);
  } catch {
    return false;
  }
};

const getOverridePermissions = () => ({
  isBackdatedAllowed: () => getRolePrivilege(),
  // Strict Financial Control: Never permit silent negative wallet balance
  isNegativeWalletAllowed: () => false,
  is40A3ExceededAllowed: () => getRolePrivilege(),
  isLockedPeriodEntryAllowed: () => getRolePrivilege(),
  isAutoVoucherDigitsAllowed: () => getRolePrivilege(),
  isExcessAdvancesAllowed: () => getRolePrivilege(),
  isCeilingExceededAllowed: () => getRolePrivilege(),
  isCashierVoidAllowed: () => getRolePrivilege(),
  isCashierClosingReopenAllowed: () => getRolePrivilege(),
  isAnyOverrideActive: () => false,
  // Safe no-ops for legacy mutators if called
  togglePolicy: () => {},
  setPolicy: () => {},
  setMasterOverride: () => {},
  resetAllOverrides: () => {},
  policies: {
    allowBackdatedEntries: false,
    allowNegativeWallet: false,
    allow40A3Exceeded: false,
    allowLockedPeriodEntry: false,
    allowAutoVoucherDigits: false,
    allowExcessAdvances: false,
    allowCeilingExceeded: false,
    allowCashierVoidVoucher: false,
    allowCashierClosingReopen: false,
    masterOverride: false,
  },
});

export const useOverrideStore: any = Object.assign(
  () => getOverridePermissions(),
  {
    getState: () => getOverridePermissions(),
  }
);

export default useOverrideStore;
