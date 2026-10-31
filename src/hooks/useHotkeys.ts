import { useEffect } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useAuthStore } from '@/store/authStore';
import { showToast } from '@/components/ui/ToastContainer';
import { triggerHaptic } from '@/lib/utils';

export function useHotkeys() {
  const {
    setActivePage,
    closeDrawer,
    closeLightbox,
    activeDrawerVoucher,
    activeLightboxUrl,
    isSearchOpen,
    setSearchOpen,
    isAdvanceModalOpen,
    setAdvanceModalOpen,
    isShortcutsModalOpen,
    setShortcutsModalOpen,
    isCalculatorOpen,
    setCalculatorOpen,
    settleTargetAdvance,
    setSettleTargetAdvance,
    toggleSidebarCollapse,
  } = useUIStore();
  const { isLocked, lockScreen, user, can } = useAuthStore();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // If unauthenticated or screen is locked, only allow unlock interactions in PinLockOverlay
      if (!user || isLocked) return;

      const key = e.key;
      const targetTag = (e.target as HTMLElement)?.tagName;
      const isInputFocused = ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag);

      // Escape to close open modals, drawers, or lightbox (Works everywhere)
      if (key === 'Escape') {
        if (activeLightboxUrl) {
          e.preventDefault();
          closeLightbox();
          return;
        }
        if (isCalculatorOpen) {
          e.preventDefault();
          setCalculatorOpen(false);
          return;
        }
        if (isShortcutsModalOpen) {
          e.preventDefault();
          setShortcutsModalOpen(false);
          return;
        }
        if (activeDrawerVoucher) {
          e.preventDefault();
          closeDrawer();
          return;
        }
        if (isSearchOpen) {
          e.preventDefault();
          setSearchOpen(false);
          return;
        }
        if (isAdvanceModalOpen) {
          e.preventDefault();
          setAdvanceModalOpen(false);
          return;
        }
        if (settleTargetAdvance) {
          e.preventDefault();
          setSettleTargetAdvance(null);
          return;
        }
      }

      // Alt + L: Instant Counter Screen Lock (PIN required to unlock)
      if (e.altKey && (key.toLowerCase() === 'l' || key === '12')) {
        e.preventDefault();
        e.stopPropagation();
        lockScreen();
        return;
      }

      // Alt + S: Staff Directory
      if (e.altKey && key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        if (!can('can_manage_users_roles')) {
          triggerHaptic('error');
          showToast({ type: 'error', title: 'Access Restricted', message: 'Staff management requires appropriate permissions.' });
          return;
        }
        setActivePage('staff');
        return;
      }

      // Alt + M: Showroom Settings & Master Catalogues
      if (e.altKey && (key.toLowerCase() === 'm' || key === 'µ')) {
        e.preventDefault();
        e.stopPropagation();
        if (!can('can_manage_periods')) {
          triggerHaptic('error');
          showToast({ type: 'error', title: 'Access Restricted', message: 'Settings access requires appropriate permissions.' });
          return;
        }
        setActivePage('settings');
        return;
      }

      // Alt + 1: Standard Expense Bill Mode
      if (e.altKey && key === '1') {
        e.preventDefault();
        e.stopPropagation();
        if (!can('can_create_voucher')) {
          triggerHaptic('error');
          showToast({ type: 'error', title: 'Access Restricted', message: 'Creating expenses requires appropriate permissions.' });
          return;
        }
        setActivePage('new-voucher');
        window.dispatchEvent(new CustomEvent('asopalav:set-voucher-mode', { detail: { mode: 'Shop_Vendor' } }));
        return;
      }

      // Alt + 2: Staff Split Mode
      if (e.altKey && key === '2') {
        e.preventDefault();
        e.stopPropagation();
        if (!can('can_create_voucher')) {
          triggerHaptic('error');
          showToast({ type: 'error', title: 'Access Restricted', message: 'Creating expenses requires appropriate permissions.' });
          return;
        }
        setActivePage('new-voucher');
        window.dispatchEvent(new CustomEvent('asopalav:set-voucher-mode', { detail: { mode: 'Staff_Split' } }));
        return;
      }

      // Alt + 3: Courier Parcel Delivery Mode
      if (e.altKey && key === '3') {
        e.preventDefault();
        e.stopPropagation();
        if (!can('can_create_voucher')) {
          triggerHaptic('error');
          showToast({ type: 'error', title: 'Access Restricted', message: 'Creating expenses requires appropriate permissions.' });
          return;
        }
        setActivePage('new-voucher');
        window.dispatchEvent(new CustomEvent('asopalav:set-voucher-mode', { detail: { mode: 'Courier' } }));
        return;
      }

      // Ctrl + B: Toggle Sidebar Collapse (Universal hotkey standard)
      if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebarCollapse();
        return;
      }

      // '?' or 'Ctrl+/' (when not inside input) -> Open Keyboard Shortcuts modal
      if ((key === '?' || ((e.ctrlKey || e.metaKey) && key === '/')) && !isInputFocused) {
        e.preventDefault();
        setShortcutsModalOpen(!isShortcutsModalOpen);
        return;
      }

      // Ctrl + K: Global Command Palette Search
      if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(!isSearchOpen);
        return;
      }

      // '/' when not inside input: Focus Global Search
      if (key === '/' && !isInputFocused) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }

      // F5: POS Quick Math & Tender Calculator (Override browser refresh on POS terminals to preserve transaction state)
      if (key === 'F5') {
        e.preventDefault();
        e.stopPropagation();
        setCalculatorOpen(!isCalculatorOpen);
        return;
      }

      const isAnyModalOpen =
        isSearchOpen ||
        isShortcutsModalOpen ||
        isCalculatorOpen ||
        isAdvanceModalOpen ||
        Boolean(settleTargetAdvance) ||
        Boolean(activeLightboxUrl) ||
        Boolean(activeDrawerVoucher);

      // If a modal/drawer is open, do not trigger background page switches
      if (isAnyModalOpen) return;

      // =========================================================================
      // COMPLETE F1 - F12 ENTERPRISE POS FUNCTION KEY MAP
      // =========================================================================

      // F1: Dashboard & Live Shop Summary
      if (key === 'F1') {
        e.preventDefault();
        e.stopPropagation();
        setActivePage('dashboard');
        return;
      }

      // F2: New Voucher / Add Expense
      if (key === 'F2') {
        e.preventDefault();
        e.stopPropagation();
        if (!can('can_create_voucher')) {
          triggerHaptic('error');
          showToast({ type: 'error', title: 'Access Restricted', message: 'Creating expenses requires appropriate permissions.' });
          return;
        }
        setActivePage('new-voucher');
        return;
      }

      // F3: All Expenses / Ledger
      if (key === 'F3') {
        e.preventDefault();
        e.stopPropagation();
        setActivePage('expenses');
        return;
      }

      // F4: Cash Drawer & UPI / Treasury Float
      if (key === 'F4') {
        e.preventDefault();
        e.stopPropagation();
        if (!can('can_inject_float')) {
          triggerHaptic('error');
          showToast({ type: 'error', title: 'Access Restricted', message: 'Treasury access requires appropriate permissions.' });
          return;
        }
        setActivePage('treasury');
        return;
      }

      // F6: Staff Directory & Showroom Roster
      if (key === 'F6') {
        e.preventDefault();
        e.stopPropagation();
        if (!can('can_manage_users_roles')) {
          triggerHaptic('error');
          showToast({ type: 'error', title: 'Access Restricted', message: 'Staff management requires appropriate permissions.' });
          return;
        }
        setActivePage('staff');
        return;
      }

      // F7: Staff Advances & Imprest Loans
      if (key === 'F7') {
        e.preventDefault();
        e.stopPropagation();
        if (!useUIStore.getState().isStaffAdvanceBetaEnabled) {
          triggerHaptic('error');
          showToast({ type: 'warning', title: 'Beta Feature Disabled', message: 'Staff Advances is currently in Beta mode. Enable it in Settings.' });
          return;
        }
        if (!can('can_disburse_advance')) {
          triggerHaptic('error');
          showToast({ type: 'error', title: 'Access Restricted', message: 'Staff advances access requires appropriate permissions.' });
          return;
        }
        setActivePage('advances');
        return;
      }

      // F8: Activity & Security Audit Logbook
      if (key === 'F8') {
        e.preventDefault();
        e.stopPropagation();
        if (!can('can_view_audit_logs')) {
          triggerHaptic('error');
          showToast({ type: 'error', title: 'Access Restricted', message: 'Audit log access requires appropriate permissions.' });
          return;
        }
        setActivePage('audit');
        return;
      }

      // F10: Alerts & Messages / Notifications
      if (key === 'F10') {
        e.preventDefault();
        e.stopPropagation();
        setActivePage('notifications');
        return;
      }

      // F11: Showroom & App Settings
      if (key === 'F11') {
        e.preventDefault();
        e.stopPropagation();
        if (!can('can_manage_periods')) {
          triggerHaptic('error');
          showToast({ type: 'error', title: 'Access Restricted', message: 'Settings access requires appropriate permissions.' });
          return;
        }
        setActivePage('settings');
        return;
      }

      // F12: My Profile & PIN Security
      if (key === 'F12') {
        e.preventDefault();
        e.stopPropagation();
        setActivePage('profile');
        return;
      }
    }

    // Attach with capture: true to intercept before browser defaults
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [
    isLocked,
    activeDrawerVoucher,
    activeLightboxUrl,
    isSearchOpen,
    isShortcutsModalOpen,
    isCalculatorOpen,
    isAdvanceModalOpen,
    settleTargetAdvance,
    setActivePage,
    closeDrawer,
    closeLightbox,
    setSearchOpen,
    setShortcutsModalOpen,
    setCalculatorOpen,
    setAdvanceModalOpen,
    setSettleTargetAdvance,
    toggleSidebarCollapse,
    lockScreen,
    user,
    can,
  ]);
}
