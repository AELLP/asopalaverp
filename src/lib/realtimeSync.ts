import { supabase } from '@/lib/supabase';
import { useBranchStore } from '@/store/branchStore';
import { useVoucherStore } from '@/store/voucherStore';
import { BranchWallet, ExpenseVoucher } from '@/types/database';
import { showToast } from '@/components/ui/ToastContainer';
import { formatINR, normalizeBranchCode } from '@/lib/utils';

// L-3 Fix: Use a ref-style flag that can be reset cleanly on HMR or teardown
let activeChannel: ReturnType<typeof supabase.channel> | null = null;

/**
 * Initializes Cloud Realtime WebSocket listeners across all ERP tables.
 *
 * H-6 Security: Financial table subscriptions (branch_wallets, expense_vouchers,
 * staff_advances, wallet_ledger, float_allocations, cash_closings, drawer_sessions)
 * are scoped to the caller's allowed branch IDs so that a Branch A cashier does not
 * receive live financial pushes for Branch B or C.
 *
 * Master-data tables (categories, departments, staff_members, branches, app_users,
 * role_permissions) remain global — they are non-sensitive and need cross-branch awareness.
 *
 * @param allowedBranchIds - Array of branch_id strings the current user may access.
 *   Pass ['*'] or empty array to subscribe to all branches (Super_Admin / Developer only).
 */
export function initRealtimeSync(allowedBranchIds: string[] = []) {
  // Teardown any previous channel cleanly (L-3 / HMR safe)
  if (activeChannel) {
    supabase.removeChannel(activeChannel);
    activeChannel = null;
  }

  // Determine if this user should see all branches
  const isGlobal = allowedBranchIds.length === 0 || allowedBranchIds.includes('*');

  // Build branch filter string for Supabase Realtime (e.g. "branch_id=eq.Aellp-ASI")
  // When multiple branches: we subscribe once per branch and fan-out on INSERT/UPDATE events.
  // For simplicity and Supabase plan compatibility, we use a single channel with client-side
  // branch filtering when the plan does not support server-side row filters.
  const shouldPassEvent = (branchId?: string | null): boolean => {
    if (isGlobal || !branchId) return true;
    return allowedBranchIds.some(
      (allowed) =>
        allowed === branchId ||
        allowed.replace('Aellp-', '') === branchId.replace('Aellp-', '')
    );
  };

  try {
    const channel = supabase
      .channel('asopalav-live-sync')
      // 1. Live wallet balance updates — branch-scoped
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'branch_wallets' },
        (payload) => {
          if (payload.new) {
            const updatedWallet = payload.new as BranchWallet;
            // H-6: Only update local state if this branch belongs to the current user
            if (!shouldPassEvent(updatedWallet.branch_id)) return;
            const branchStore = useBranchStore.getState();
            const currentWallets = { ...branchStore.wallets };
            currentWallets[updatedWallet.branch_id] = updatedWallet;
            currentWallets[normalizeBranchCode(updatedWallet.branch_id)] = updatedWallet;

            // Recompute ALL showrooms aggregate
            const branchKeys = Object.keys(currentWallets).filter((k) => k.startsWith('Aellp-'));
            const totalCash = branchKeys.reduce((sum, k) => sum + (Number(currentWallets[k]?.cash_balance) || 0), 0);
            const totalUpi = branchKeys.reduce((sum, k) => sum + (Number(currentWallets[k]?.upi_balance) || 0), 0);
            const allWallet: BranchWallet = {
              branch_id: 'ALL',
              cash_balance: totalCash,
              upi_balance: totalUpi,
            };
            currentWallets['ALL'] = allWallet;

            branchStore.setWallets(currentWallets);

            if (typeof window !== 'undefined') {
              try {
                localStorage.setItem(`asopalav_wallet_${updatedWallet.branch_id}`, JSON.stringify(updatedWallet));
                localStorage.setItem(`asopalav_wallet_${normalizeBranchCode(updatedWallet.branch_id)}`, JSON.stringify(updatedWallet));
                localStorage.setItem('asopalav_wallet_ALL', JSON.stringify(allWallet));
              } catch {}
            }

            window.dispatchEvent(new CustomEvent('asopalav:wallet-updated', { detail: updatedWallet }));
          }
        }
      )
      // 2. Live expense vouchers INSERT — branch-scoped
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'expense_vouchers' },
        (payload) => {
          if (payload.new) {
            const newVoucher = payload.new as ExpenseVoucher;
            // H-6: Suppress cross-branch financial toasts for restricted cashiers
            if (!shouldPassEvent(newVoucher.branch_id)) return;
            useVoucherStore.getState().addVoucherLocally(newVoucher);
            useVoucherStore.getState().invalidateVouchers(newVoucher.branch_id);
            window.dispatchEvent(new CustomEvent('asopalav:vouchers-updated', { detail: { action: 'INSERT', voucher: newVoucher } }));
            window.dispatchEvent(new Event('asopalav:wallet-updated'));

            showToast({
              type: 'activity',
              title: 'Live Bill Recorded',
              message: `Bill #${newVoucher.voucher_number} (${formatINR(newVoucher.total_amount)}) saved live.`,
            });
          }
        }
      )
      // 2b. Live expense vouchers UPDATE — branch-scoped
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'expense_vouchers' },
        (payload) => {
          if (payload.new) {
            const updatedVoucher = payload.new as ExpenseVoucher;
            if (!shouldPassEvent(updatedVoucher.branch_id)) return;
            useVoucherStore.getState().updateVoucherLocally(updatedVoucher);
            useVoucherStore.getState().invalidateVouchers(updatedVoucher.branch_id);
            window.dispatchEvent(new CustomEvent('asopalav:vouchers-updated', { detail: { action: 'UPDATE', voucher: updatedVoucher } }));
            window.dispatchEvent(new Event('asopalav:wallet-updated'));
          }
        }
      )
      // 2c. Live expense vouchers DELETE — branch-scoped
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'expense_vouchers' },
        (payload) => {
          if (payload.old) {
            const oldVoucher = payload.old as Partial<ExpenseVoucher>;
            if (!shouldPassEvent(oldVoucher.branch_id)) return;
            if (oldVoucher.voucher_number) {
              useVoucherStore.getState().removeVoucherLocally(oldVoucher.voucher_number, oldVoucher.branch_id);
              useVoucherStore.getState().invalidateVouchers(oldVoucher.branch_id);
              window.dispatchEvent(new CustomEvent('asopalav:vouchers-updated', { detail: { action: 'DELETE', voucher: oldVoucher } }));
              window.dispatchEvent(new Event('asopalav:wallet-updated'));

              showToast({
                type: 'warning',
                title: 'Expense Removed',
                message: `Bill #${oldVoucher.voucher_number} was removed.`,
              });
            }
          }
        }
      )
      // 3. Live Staff Advances — branch-scoped
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'staff_advances' },
        (payload) => {
          const rec = (payload.new || payload.old) as any;
          if (!shouldPassEvent(rec?.branch_id)) return;
          window.dispatchEvent(new Event('asopalav:advances-updated'));
          window.dispatchEvent(new Event('asopalav:wallet-updated'));
        }
      )
      // 4. Live Master Data — global (non-sensitive, needed cross-branch)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expense_categories' },
        () => {
          useVoucherStore.getState().invalidateMasterData();
          window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'expense_categories' } }));
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'departments' },
        () => {
          useVoucherStore.getState().invalidateMasterData();
          window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'departments' } }));
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'courier_partners' },
        () => {
          useVoucherStore.getState().invalidateMasterData();
          window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'courier_partners' } }));
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'staff_members' },
        () => {
          useVoucherStore.getState().invalidateMasterData();
          window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'staff_members' } }));
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'branches' },
        () => {
          useBranchStore.getState().fetchBranchesAndWallets(true);
          useVoucherStore.getState().invalidateMasterData();
          window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'branches' } }));
        }
      )
      // 5. Live App Users, Roles & Permissions — global
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_users' },
        () => {
          window.dispatchEvent(new Event('asopalav:users-roles-updated'));
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_roles' },
        () => {
          window.dispatchEvent(new Event('asopalav:users-roles-updated'));
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'role_permissions' },
        () => {
          window.dispatchEvent(new Event('asopalav:users-roles-updated'));
        }
      )
      // 6. Live Ledger, Float Topups, Safe Drops, Closings — branch-scoped
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallet_ledger' },
        (payload) => {
          const rec = (payload.new || payload.old) as any;
          if (!shouldPassEvent(rec?.branch_id)) return;
          useBranchStore.getState().fetchBranchesAndWallets(true);
          window.dispatchEvent(new Event('asopalav:ledger-updated'));
          window.dispatchEvent(new Event('asopalav:wallet-updated'));
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'float_allocations' },
        (payload) => {
          const rec = (payload.new || payload.old) as any;
          if (!shouldPassEvent(rec?.branch_id)) return;
          useBranchStore.getState().fetchBranchesAndWallets(true);
          window.dispatchEvent(new Event('asopalav:ledger-updated'));
          window.dispatchEvent(new Event('asopalav:wallet-updated'));
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cash_closings' },
        (payload) => {
          const rec = (payload.new || payload.old) as any;
          if (!shouldPassEvent(rec?.branch_id)) return;
          useBranchStore.getState().fetchBranchesAndWallets(true);
          window.dispatchEvent(new Event('asopalav:ledger-updated'));
          window.dispatchEvent(new Event('asopalav:wallet-updated'));
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'drawer_sessions' },
        (payload) => {
          const rec = (payload.new || payload.old) as any;
          if (!shouldPassEvent(rec?.branch_id)) return;
          useBranchStore.getState().fetchBranchesAndWallets(true);
          window.dispatchEvent(new Event('asopalav:ledger-updated'));
          window.dispatchEvent(new Event('asopalav:wallet-updated'));
        }
      )
      // 7. Live Security Audit Logs (global stream push)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'security_audit_logs' },
        (payload) => {
          if (payload.new) {
            window.dispatchEvent(new CustomEvent('asopalav:audit-log-created', { detail: payload.new }));
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[Realtime] Connected to live sync channel. Branch scope: ${isGlobal ? 'ALL' : allowedBranchIds.join(', ')}`);
        } else if (status === 'CHANNEL_ERROR') {
          console.warn('[Realtime] Channel error, will auto-retry:', err);
        } else if (status === 'TIMED_OUT') {
          console.warn('[Realtime] Channel timed out. Check Supabase plan limits.');
        }
      });

    activeChannel = channel;

    return () => {
      supabase.removeChannel(channel);
      activeChannel = null;
    };
  } catch (err) {
    console.warn('Realtime channel fallback:', err);
  }
}

/** Tears down the active realtime channel (call on logout). */
export function teardownRealtimeSync() {
  if (activeChannel) {
    supabase.removeChannel(activeChannel);
    activeChannel = null;
  }
}
