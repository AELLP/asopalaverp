import { supabase } from '@/lib/supabase';
import { logSecurityEvent, getLocalAuditLogs } from '@/lib/audit';
import { useNotificationStore } from '@/store/notificationStore';
import { useOfflineQueue } from '@/lib/offlineQueue';
import { useVoucherStore } from '@/store/voucherStore';
import { useBranchStore } from '@/store/branchStore';
import { useOverrideStore } from '@/store/overrideStore';
import { format } from 'date-fns';
import bcrypt from 'bcryptjs';
import { normalizeBranchCode, normalizeBranchId, formatVoucherNumber, generateVoucherCollisionToken } from '@/lib/utils';
import {
  BranchWallet,
  WalletLedger,
  FloatAllocation,
  ExpenseVoucher,
  VoucherSplit,
  StaffAdvance,
  CashClosing,
  AccountingPeriod,
  
  CurrencyDenomination,
  AppUser,
  AppRole,
  RolePermissions,
  StaffMember,
  Department,
  SecurityAuditLog,
  GstTaxRate,
} from '@/types/database';

export const isPrivilegedAdminRole = (role?: string | null): boolean => {
  if (!role) return false;
  const normalized = role.toLowerCase().replace(/[\s_-]+/g, '');
  return (
    normalized === 'superadmin' ||
    normalized === 'admin' ||
    normalized === 'developer' ||
    normalized === 'owner'
  );
};

export interface CreateVoucherParams {
  voucher: Omit<ExpenseVoucher, 'id' | 'created_at'>;
  splits?: Array<{
    staffCode: string;
    staffName: string;
    departmentName: string;
    categoryName: string;
    amount: number;
  }>;
  userName: string;
  userRole: string;
}

export interface DisburseAdvanceParams {
  advance: Omit<
    StaffAdvance,
    'id' | 'created_at' | 'bills_submitted_amount' | 'cash_returned_amount' | 'unsettled_balance' | 'settlement_proofs' | 'status'
  >;
  userName: string;
  userRole: string;
}

export interface SettleAdvanceParams {
  advanceId: string;
  receiptNumber: string;
  staffCode: string;
  branchId: string;
  branchCode: string;
  billsSubmittedAmount: number;
  cashReturnedAmount: number;
  settlementProofs: string[];
  userName: string;
  userRole: string;
}

export interface FloatTopupParams {
  branchId: string;
  branchCode: string;
  walletType: 'Cash' | 'UPI';
  amount: number;
  referenceNotes?: string;
  authorizedByName: string;
  receivedByName: string;
  createdAt?: string;
}

export interface SafeDropParams {
  branchId: string;
  branchCode: string;
  amount: number;
  reason?: string;
  transferredByName: string;
  verifiedByName: string;
}

export interface SaveCashClosingParams {
  branchId: string;
  branchCode: string;
  closingDate: string;
  openingCash: number;
  cashInflow: number;
  cashOutflow: number;
  expectedCash: number;
  actualCash: number;
  variance: number;
  varianceDisposition?: 'Cashier_Charge' | 'Expense_Writeoff' | 'Excess_Income' | 'Unresolved' | string;
  chargeStaffCode?: string;
  chargeStaffName?: string;
  denominationsDetail: string;
  denominationsBreakdown: Record<string, number>;
  closingNotes?: string;
  cashierName: string;
  verifiedByName: string;
}

// Memory cache and in-flight request deduplication to minimize Supabase Egress & Log Ingestion
const ledgerMemoryCache: Record<string, { entries: WalletLedger[]; timestamp: number }> = {};
const ledgerInFlight: Record<string, Promise<WalletLedger[]> | null> = {};

class ERPService {
  // --------------------------------------------------------------------------
  // 1. ACCOUNTING PERIODS & LOCKING
  // --------------------------------------------------------------------------
  async getAccountingPeriods(): Promise<AccountingPeriod[]> {
    try {
      const { data, error } = await supabase
        .from('accounting_periods')
        .select('*')
        .order('period_key', { ascending: false });

      if (!error && data && data.length > 0) {
        localStorage.setItem('asopalav_accounting_periods', JSON.stringify(data));
        return data;
      }
    } catch (e) {
      console.warn('Using local accounting periods fallback', e);
    }

    const local = localStorage.getItem('asopalav_accounting_periods');
    if (local) {
      try {
        const parsed = JSON.parse(local);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {
        // ignore
      }
    }

    const defaultPeriods: AccountingPeriod[] = [
      {
        period_key: '2026-10',
        start_date: '2026-10-01',
        end_date: '2026-10-31',
        is_locked: false,
      },
      {
        period_key: '2026-09',
        start_date: '2026-09-01',
        end_date: '2026-09-30',
        is_locked: false,
      },
      {
        period_key: '2026-08',
        start_date: '2026-08-01',
        end_date: '2026-08-31',
        is_locked: true,
        locked_at: '2026-08-31T23:59:59Z',
        locked_by_name: 'Hemendra Bhai',
        lock_reason: 'Monthly Accounts Finalized & Audited',
      },
    ];

    try {
      await supabase.from('accounting_periods').upsert(defaultPeriods, { onConflict: 'period_key' });
    } catch {
      // offline/fallback
    }

    localStorage.setItem('asopalav_accounting_periods', JSON.stringify(defaultPeriods));
    return defaultPeriods;
  }

  async togglePeriodLock(
    periodKey: string,
    lock: boolean,
    userName: string,
    reason?: string,
    startDate?: string,
    endDate?: string
  ) {
    const start = startDate || `${periodKey}-01`;
    const parts = periodKey.split('-');
    const year = parseInt(parts[0], 10) || new Date().getFullYear();
    const month = parseInt(parts[1], 10) || (new Date().getMonth() + 1);
    const lastDay = new Date(year, month, 0).getDate();
    const end = endDate || `${periodKey}-${String(lastDay).padStart(2, '0')}`;

    const updateData: AccountingPeriod = {
      period_key: periodKey,
      start_date: start,
      end_date: end,
      is_locked: lock,
      locked_at: lock ? new Date().toISOString() : null,
      locked_by_name: lock ? userName : null,
      lock_reason: lock ? reason || 'Monthly Accounts Finalized & Audited' : null,
    };

    const { error } = await supabase
      .from('accounting_periods')
      .upsert([updateData], { onConflict: 'period_key' });
    if (error) {
      throw new Error(`Failed to update accounting period lock in database: ${error.message}`);
    }

    // Update local cache immediately
    try {
      const current = await this.getAccountingPeriods();
      const updated = current.map((p) => (p.period_key === periodKey ? { ...p, ...updateData } : p));
      if (!updated.some((p) => p.period_key === periodKey)) {
        updated.unshift(updateData);
      }
      localStorage.setItem('asopalav_accounting_periods', JSON.stringify(updated));
    } catch {
      // ignore
    }

    await logSecurityEvent({
      userName,
      userRole: 'Store_Manager',
      actionType: 'Lock_Period',
      targetEntity: 'accounting_periods',
      targetIdentifier: periodKey,
      eventDescription: `${lock ? 'Locked' : 'Unlocked'} accounting period ${periodKey}`,
      justification: reason || (lock ? 'Month end account freeze' : 'Auditor adjustment clearance'),
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:period-lock-updated', { detail: updateData }));
    }
  }

  async checkIsPeriodLocked(dateString: string): Promise<boolean> {
    if (useOverrideStore.getState().isLockedPeriodEntryAllowed()) {
      return false;
    }
    const periodKey = dateString.slice(0, 7); // e.g. '2026-09'
    const periods = await this.getAccountingPeriods();
    const match = periods.find((p) => p.period_key === periodKey);
    return match ? match.is_locked : false;
  }

  async getSecurityAuditLogs(limit: number = 500): Promise<SecurityAuditLog[]> {
    try {
      const { data, error } = await supabase
        .from('security_audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!error && Array.isArray(data) && data.length > 0) {
        return data as SecurityAuditLog[];
      }
      return getLocalAuditLogs();
    } catch {
      return getLocalAuditLogs();
    }
  }

  // --------------------------------------------------------------------------
  // 2. WALLET BALANCES & DOUBLE-ENTRY LEDGER
  // --------------------------------------------------------------------------
  async getBranchWallet(branchId: string = 'Aellp-ASI'): Promise<BranchWallet> {
    const canonicalId = branchId === 'ALL' ? 'ALL' : normalizeBranchId(branchId);
    const code = normalizeBranchCode(branchId);

    // Fast memory return from Zustand branch store if already loaded
    try {
      const storeWallets = useBranchStore.getState().wallets;
      if (storeWallets && (storeWallets[canonicalId] || storeWallets[code])) {
        return storeWallets[canonicalId] || storeWallets[code];
      }
    } catch {}

    try {
      if (canonicalId === 'ALL') {
        const { data } = await supabase.from('branch_wallets').select('*');
        if (data && data.length > 0) {
          const totalCash = data.reduce((sum, w) => sum + (Number(w.cash_balance) || 0), 0);
          const totalUpi = data.reduce((sum, w) => sum + (Number(w.upi_balance) || 0), 0);
          const allWallet = {
            branch_id: 'ALL',
            cash_balance: totalCash,
            upi_balance: totalUpi,
          };
          localStorage.setItem('asopalav_wallet_ALL', JSON.stringify(allWallet));
          return allWallet;
        }
      } else {
        const { data } = await supabase
          .from('branch_wallets')
          .select('*')
          .or(`branch_id.eq.${canonicalId},branch_id.eq.${code}`)
          .maybeSingle();
        if (data) {
          localStorage.setItem(`asopalav_wallet_${canonicalId}`, JSON.stringify(data));
          localStorage.setItem(`asopalav_wallet_${code}`, JSON.stringify(data));
          return data;
        }
      }
    } catch (e) {
      console.warn('Branch wallet fetched from memory/cache', e);
    }

    const local = localStorage.getItem(`asopalav_wallet_${canonicalId}`) || localStorage.getItem(`asopalav_wallet_${branchId}`) || localStorage.getItem(`asopalav_wallet_${code}`);
    if (local) {
      try {
        const parsed = JSON.parse(local);
        if (parsed) return parsed;
      } catch {}
    }

    if (canonicalId === 'ALL') {
      return {
        branch_id: 'ALL',
        cash_balance: 100000,
        upi_balance: 208569,
      };
    }

    if (canonicalId === 'Aellp-ASI' || code === 'ASI') {
      return {
        branch_id: 'Aellp-ASI',
        cash_balance: 100000,
        upi_balance: 208569,
      };
    }

    const defaultWallet: BranchWallet = {
      branch_id: canonicalId,
      cash_balance: 0,
      upi_balance: 0,
    };

    localStorage.setItem(`asopalav_wallet_${canonicalId}`, JSON.stringify(defaultWallet));
    return defaultWallet;
  }

  async updateBranchWallet(wallet: BranchWallet) {
    localStorage.setItem(`asopalav_wallet_${wallet.branch_id}`, JSON.stringify(wallet));
    const updatedAt = new Date().toISOString();
    try {
      // Use upsert with updated_at for basic concurrency detection
      const { error } = await supabase.from('branch_wallets').upsert([
        {
          branch_id: wallet.branch_id,
          cash_balance: wallet.cash_balance,
          upi_balance: wallet.upi_balance,
          updated_at: updatedAt,
        },
      ]);
      if (error) throw error;
    } catch (e) {
      console.warn('Wallet upsert fallback to offline queue:', e);
      useOfflineQueue.getState().enqueueMutation({
        type: 'wallet_upsert',
        table: 'branch_wallets',
        action: 'upsert',
        payload: {
          branch_id: wallet.branch_id,
          cash_balance: wallet.cash_balance,
          upi_balance: wallet.upi_balance,
          updated_at: updatedAt,
        },
        description: `Wallet update ${wallet.branch_id}`,
      });
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:wallet-updated', { detail: wallet }));
    }
  }

  async recalculateBranchWalletFromLedger(branchId: string = 'Aellp-ASI'): Promise<BranchWallet> {
    const canonicalId = branchId === 'ALL' ? 'ALL' : normalizeBranchId(branchId);
    const code = normalizeBranchCode(branchId);

    // Fetch all current ledger rows
    const ledger = await this.getWalletLedger(branchId, true);

    let netCash = 0;
    let netUpi = 0;

    ledger.forEach((entry) => {
      const credit = Number(entry.credit_amount) || 0;
      const debit = Number(entry.debit_amount) || 0;
      const isUpi = entry.wallet_type === 'UPI';

      if (isUpi) {
        netUpi += credit - debit;
      } else {
        netCash += credit - debit;
      }
    });

    const updatedWallet: BranchWallet = {
      branch_id: canonicalId,
      cash_balance: Math.max(0, netCash),
      upi_balance: Math.max(0, netUpi),
    };

    await this.updateBranchWallet(updatedWallet);

    // Synchronize local storage caches
    localStorage.setItem(`asopalav_wallet_${canonicalId}`, JSON.stringify(updatedWallet));
    localStorage.setItem(`asopalav_wallet_${code}`, JSON.stringify(updatedWallet));
    localStorage.setItem(`asopalav_ledger_${canonicalId}`, JSON.stringify(ledger.slice(0, 200)));
    localStorage.setItem(`asopalav_ledger_${code}`, JSON.stringify(ledger.slice(0, 200)));

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:wallet-updated', { detail: updatedWallet }));
      window.dispatchEvent(new Event('asopalav:ledger-updated'));
    }

    return updatedWallet;
  }

  async getWalletLedger(branchId: string = 'Aellp-ASI', force = false): Promise<WalletLedger[]> {
    const code = normalizeBranchCode(branchId);
    const isAll = !branchId || branchId === 'ALL' || code === 'ALL';
    const canonicalId = isAll ? 'ALL' : normalizeBranchId(branchId);

    // Memory cache and in-flight deduplication to save Supabase egress and query units
    const now = Date.now();
    const cached = ledgerMemoryCache[canonicalId];
    if (!force && cached && now - cached.timestamp < 3 * 60 * 1000 && cached.entries.length > 0) {
      return cached.entries;
    }

    if (!force && ledgerInFlight[canonicalId]) {
      return ledgerInFlight[canonicalId]!;
    }

    const sanitizeAndDeduplicateLedger = (entries: WalletLedger[]): WalletLedger[] => {
      const seen = new Set<string>();
      return entries.filter((item) => {
        if (!item) return false;
        if (item.reference_number && (item.transaction_type === 'Expense_Voucher' || item.transaction_type === 'Float_Topup' || item.transaction_type === 'Safe_Drop')) {
          const key = `${item.transaction_type}-${item.reference_number}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }
        const key = item.id || `${item.created_at}-${item.credit_amount}-${item.debit_amount}-${item.remarks}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    ledgerInFlight[canonicalId] = (async () => {
      try {
        let query = supabase
          .from('wallet_ledger')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(10000);

        if (!isAll) {
          query = query.or(`branch_id.eq.${canonicalId},branch_id.eq.${code},branch_code.eq.${code}`);
        }

        const { data, error } = await query;
        if (!error && data !== null) {
          const clean = sanitizeAndDeduplicateLedger(data);
          localStorage.setItem(`asopalav_ledger_${canonicalId}`, JSON.stringify(clean.slice(0, 2000)));
          ledgerMemoryCache[canonicalId] = { entries: clean, timestamp: Date.now() };
          return clean;
        }
      } catch (e) {
        console.warn('Wallet ledger fallback to local cache:', e);
      } finally {
        ledgerInFlight[canonicalId] = null;
      }

      const keysToCheck = isAll
        ? ['asopalav_ledger_ALL', 'asopalav_ledger_Aellp-ASI', 'asopalav_ledger_ASI', 'asopalav_ledger_CG', 'asopalav_ledger_NAV', 'asopalav_ledger_SUR']
        : [`asopalav_ledger_${canonicalId}`, `asopalav_ledger_${code}`, `asopalav_ledger_${branchId}`, 'asopalav_ledger_ALL', 'asopalav_ledger_Aellp-ASI'];

      for (const key of keysToCheck) {
        const local = localStorage.getItem(key);
        if (local) {
          try {
            const parsed = JSON.parse(local);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const clean = isAll ? sanitizeAndDeduplicateLedger(parsed) : sanitizeAndDeduplicateLedger(parsed.filter((l: any) => l.branch_id === canonicalId || normalizeBranchCode(l.branch_id) === code));
              ledgerMemoryCache[canonicalId] = { entries: clean, timestamp: Date.now() };
              return clean;
            }
          } catch {}
        }
      }

      return [];
    })();

    return ledgerInFlight[canonicalId]!;
  }

  async appendLedgerEntry(entry: Omit<WalletLedger, 'id' | 'ledger_sequence' | 'created_at'> & { created_at?: string }) {
    const fullEntry: WalletLedger = {
      ...entry,
      id: crypto.randomUUID(),
      ledger_sequence: Date.now(),
      created_at: entry.created_at || new Date().toISOString(),
    };

    const existing = await this.getWalletLedger(entry.branch_id);
    const existingIndex = existing.findIndex(
      (e) =>
        entry.reference_number &&
        e.reference_number === entry.reference_number &&
        e.transaction_type === entry.transaction_type
    );
    if (existingIndex !== -1) {
      const existingEntry = existing[existingIndex];
      const isAmountSame =
        Number(existingEntry.debit_amount || 0) === Number(entry.debit_amount || 0) &&
        Number(existingEntry.credit_amount || 0) === Number(entry.credit_amount || 0) &&
        existingEntry.wallet_type === entry.wallet_type;

      if (isAmountSame) {
        console.warn(`[appendLedgerEntry] Skipped duplicate ledger entry for ${entry.reference_number}`);
        return existingEntry;
      }

      // Amounts or wallet type differ -> Update existing ledger entry so it reflects actual voucher amount
      console.log(`[appendLedgerEntry] Updating ledger entry for ${entry.reference_number}: debit ${existingEntry.debit_amount} -> ${entry.debit_amount}`);
      const updatedEntry: WalletLedger = {
        ...existingEntry,
        debit_amount: entry.debit_amount,
        credit_amount: entry.credit_amount,
        wallet_type: entry.wallet_type,
        remarks: entry.remarks || existingEntry.remarks,
        cashier_name: entry.cashier_name || existingEntry.cashier_name,
      };

      existing[existingIndex] = updatedEntry;
      localStorage.setItem(`asopalav_ledger_${entry.branch_id}`, JSON.stringify(existing.slice(0, 200)));

      try {
        const { error } = await supabase
          .from('wallet_ledger')
          .update({
            debit_amount: entry.debit_amount,
            credit_amount: entry.credit_amount,
            wallet_type: entry.wallet_type,
            remarks: updatedEntry.remarks,
            cashier_name: updatedEntry.cashier_name,
          })
          .eq('id', existingEntry.id);
        if (error) throw error;
      } catch (e) {
        console.warn('Ledger update queued offline:', e);
      }
      return updatedEntry;
    }

    const updated = [fullEntry, ...existing];
    localStorage.setItem(`asopalav_ledger_${entry.branch_id}`, JSON.stringify(updated.slice(0, 200)));

    try {
      const { error } = await supabase.from('wallet_ledger').insert([fullEntry]);
      if (error) throw error;
    } catch (e) {
      console.warn('Ledger insert queued offline:', e);
      useOfflineQueue.getState().enqueueMutation({
        type: 'wallet_ledger',
        table: 'wallet_ledger',
        action: 'insert',
        payload: fullEntry,
        description: `Ledger entry ${fullEntry.reference_number}`,
      });
    }

    delete ledgerMemoryCache[entry.branch_id];
    delete ledgerMemoryCache[normalizeBranchCode(entry.branch_id)];
    delete ledgerMemoryCache['ALL'];
    return fullEntry;
  }
  async deleteLedgerEntry(params: {
    entryId: string;
    branchId: string;
    userName: string;
    userRole: string;
    reason?: string;
    adjustWalletBalance?: boolean;
  }): Promise<void> {
    const { entryId, branchId, userName, userRole, reason, adjustWalletBalance = false } = params;
    delete ledgerMemoryCache[branchId];
    delete ledgerMemoryCache[normalizeBranchCode(branchId)];
    delete ledgerMemoryCache['ALL'];
    
    // Get existing ledger for the branch
    const existing = await this.getWalletLedger(branchId);
    const target = existing.find((e) => e.id === entryId || e.reference_number === entryId);

    if (target && adjustWalletBalance) {
      const wallet = await this.getBranchWallet(branchId);
      const isUpi = target.wallet_type === 'UPI';
      const credit = Number(target.credit_amount) || 0;
      const debit = Number(target.debit_amount) || 0;

      // Revert ledger effect on wallet
      if (isUpi) {
        wallet.upi_balance = Math.max(0, wallet.upi_balance - credit + debit);
      } else {
        wallet.cash_balance = Math.max(0, wallet.cash_balance - credit + debit);
      }
      await this.updateBranchWallet(wallet);

      // Reversal Entry: Append offsetting reversal entry instead of hard-deleting
      const refCode = target.reference_number || (target.id ? String(target.id).slice(0, 8).toUpperCase() : 'TRZ');
      await this.appendLedgerEntry({
        branch_id: target.branch_id || branchId,
        branch_code: target.branch_code || normalizeBranchCode(branchId),
        wallet_type: target.wallet_type || 'Cash',
        transaction_type: 'Adjustment',
        reference_number: `REV-${refCode}`,
        debit_amount: credit,
        credit_amount: debit,
        running_balance: isUpi ? wallet.upi_balance : wallet.cash_balance,
        remarks: `REVERSAL of ${refCode}: ${reason || 'Entry reversed by ' + userName}`,
        cashier_name: userName,
        authorized_by_name: userName,
      });

      // Mark the original row as reversed in remarks
      try {
        await supabase
          .from('wallet_ledger')
          .update({
            remarks: `[REVERSED] ${target.remarks || ''}`.trim(),
          })
          .eq('id', target.id);
      } catch (e) {
        console.warn('Mark reversed fallback:', e);
      }
    }

    // Audit Log
    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Update_Voucher' as any,
      targetEntity: 'wallet_ledger',
      targetIdentifier: target?.reference_number || entryId,
      eventDescription: `Reversed ledger entry ${target?.reference_number || entryId}: ${reason || 'Audited correction'} (Reversal entry created, original retained)`,
      justification: reason || 'Audit reversal workflow',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:ledger-updated'));
      window.dispatchEvent(new Event('asopalav:wallet-updated'));
    }
  }

  async cleanDuplicateLedgerEntries(branchId: string, userName: string, userRole: string): Promise<{ removedCount: number }> {
    const rawLedger = await this.getWalletLedger(branchId);
    const seen = new Set<string>();
    const cleanList: WalletLedger[] = [];
    const duplicates: WalletLedger[] = [];

    for (const item of rawLedger) {
      const key = item.reference_number
        ? `${item.transaction_type}-${item.reference_number}`
        : item.id || `${item.created_at}-${item.credit_amount}-${item.debit_amount}`;

      if (seen.has(key)) {
        duplicates.push(item);
      } else {
        seen.add(key);
        cleanList.push(item);
      }
    }

    if (duplicates.length === 0) {
      return { removedCount: 0 };
    }

    // Save cleaned list locally
    localStorage.setItem(`asopalav_ledger_${branchId}`, JSON.stringify(cleanList.slice(0, 200)));

    // Remove duplicates from database
    try {
      const dupIds = duplicates.map((d) => d.id).filter(Boolean);
      if (dupIds.length > 0) {
        await supabase.from('wallet_ledger').delete().in('id', dupIds);
      }
    } catch (e) {
      console.warn('Duplicate purge DB fallback:', e);
    }

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Delete_Voucher' as any,
      targetEntity: 'wallet_ledger',
      targetIdentifier: `${branchId}-${duplicates.length}-dups`,
      eventDescription: `Cleaned ${duplicates.length} duplicate ledger records for branch ${branchId}`,
      justification: 'Automated ledger integrity audit',
    });

    // Automatically recalculate branch wallet balance from the cleaned ledger
    await this.recalculateBranchWalletFromLedger(branchId);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:ledger-updated'));
    }

    return { removedCount: duplicates.length };
  }

  /**
   * Scans all historical vouchers that have multi-staff split allocations
   * and synchronizes the parent voucher's category_name and department_name
   * with the true category and department chosen in the split records.
   */
  async reconcileHistoricalSplitVouchers(userName: string = 'System Admin', userRole: string = 'Super_Admin'): Promise<{ updatedCount: number; updatedVouchers: string[] }> {
    const updatedVouchers: string[] = [];
    try {
      // 1. Fetch all voucher splits
      const { data: allSplits, error: splitsError } = await supabase
        .from('voucher_splits')
        .select('*');

      if (splitsError || !allSplits || allSplits.length === 0) {
        return { updatedCount: 0, updatedVouchers: [] };
      }

      // Group splits by voucher_number
      const splitsByVoucher: Record<string, any[]> = {};
      allSplits.forEach((s) => {
        if (!s.voucher_number) return;
        if (!splitsByVoucher[s.voucher_number]) {
          splitsByVoucher[s.voucher_number] = [];
        }
        splitsByVoucher[s.voucher_number].push(s);
      });

      // 2. Fetch corresponding vouchers
      const voucherNumbers = Object.keys(splitsByVoucher);
      const { data: vouchers, error: vouchersError } = await supabase
        .from('expense_vouchers')
        .select('*')
        .in('voucher_number', voucherNumbers);

      if (vouchersError || !vouchers) {
        return { updatedCount: 0, updatedVouchers: [] };
      }

      for (const v of vouchers) {
        const vSplits = splitsByVoucher[v.voucher_number] || [];
        if (vSplits.length === 0) continue;

        const uniqueCategories = Array.from(
          new Set(vSplits.map((s: any) => s.category_name?.trim()).filter(Boolean))
        );
        const uniqueDepartments = Array.from(
          new Set(vSplits.map((s: any) => s.department_name?.trim()).filter(Boolean))
        );

        const targetCategory =
          uniqueCategories.length === 1
            ? uniqueCategories[0]
            : uniqueCategories.length > 1
            ? uniqueCategories.join(', ')
            : v.category_name;

        const targetDepartment =
          uniqueDepartments.length === 1
            ? uniqueDepartments[0]
            : uniqueDepartments.length > 1
            ? uniqueDepartments.join(', ')
            : v.department_name;

        if (
          (targetCategory && v.category_name !== targetCategory) ||
          (targetDepartment && v.department_name !== targetDepartment)
        ) {
          // Update in database
          const { error: updateError } = await supabase
            .from('expense_vouchers')
            .update({
              category_name: targetCategory || v.category_name,
              department_name: targetDepartment || v.department_name,
            })
            .eq('voucher_number', v.voucher_number);

          if (!updateError) {
            updatedVouchers.push(v.voucher_number);
            // Update local store
            useVoucherStore.getState().updateVoucherLocally({
              ...v,
              category_name: targetCategory || v.category_name,
              department_name: targetDepartment || v.department_name,
            });
          }
        }
      }

      if (updatedVouchers.length > 0) {
        await logSecurityEvent({
          userName,
          userRole: userRole as any,
          actionType: 'Update_Voucher' as any,
          targetEntity: 'expense_vouchers',
          targetIdentifier: `${updatedVouchers.length}-vouchers`,
          eventDescription: `Reconciled ${updatedVouchers.length} historical staff vouchers with true split categories/departments: ${updatedVouchers.join(', ')}`,
          justification: 'Automated historical data integrity fix',
        });

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('asopalav:vouchers-updated'));
        }
      }
    } catch (e) {
      console.warn('Error reconciling historical split vouchers:', e);
    }

    return { updatedCount: updatedVouchers.length, updatedVouchers };
  }

  /**
   * Permanently purges specific erroneous historical test records across all tables (float_allocations, wallet_ledger, localStorage)
   * and synchronizes branch_wallets to exact mathematical truth from 1 Oct onwards.
   */
  async purgeErroneousHistoricalRecords(branchId: string = 'Aellp-ASI'): Promise<{ purged: boolean; message: string }> {
    const canonicalId = normalizeBranchId(branchId);
    const code = normalizeBranchCode(branchId);
    const targetRefNumbers = ['FLT-856048', 'FLT-984105'];
    const targetIds = ['66adb6d4-930a-486f-95fd-717850cda0c4', 'ef3d74c6-2779-4870-848c-eeadb7421405'];

    // 1. Purge from float_allocations in database
    try {
      await supabase
        .from('float_allocations')
        .delete()
        .or(`allocation_number.in.(${targetRefNumbers.join(',')}),id.in.(${targetIds.join(',')})`);
    } catch (e) {
      console.warn('Float allocations purge fallback:', e);
    }

    // 2. Purge from wallet_ledger in database
    try {
      await supabase
        .from('wallet_ledger')
        .delete()
        .or(`reference_number.in.(${targetRefNumbers.join(',')}),id.in.(${targetIds.join(',')})`);
    } catch (e) {
      console.warn('Wallet ledger purge fallback:', e);
    }

    // 3. Purge from localStorage across all keys
    const keysToCheck = [
      `asopalav_ledger_${canonicalId}`,
      `asopalav_ledger_${code}`,
      `asopalav_ledger_${branchId}`,
      'asopalav_ledger_ALL',
      'asopalav_ledger_Aellp-ASI',
      'asopalav_ledger_ASI',
    ];

    keysToCheck.forEach((key) => {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            const cleaned = list.filter(
              (item: any) =>
                !targetRefNumbers.includes(item?.reference_number) &&
                !targetIds.includes(item?.id)
            );
            localStorage.setItem(key, JSON.stringify(cleaned.slice(0, 200)));
          }
        } catch {
          // ignore
        }
      }
    });

    // 4. Purge from offlineQueue if any pending mutation mentions these references
    try {
      const offlineQueue = useOfflineQueue.getState();
      const remaining = offlineQueue.mutations.filter((m) => {
        const payloadStr = JSON.stringify(m.payload || {});
        return !targetRefNumbers.some((ref) => payloadStr.includes(ref)) && !targetIds.some((id) => payloadStr.includes(id));
      });
      useOfflineQueue.setState({ mutations: remaining });
      localStorage.setItem('asopalav_offline_mutations', JSON.stringify(remaining));
    } catch {
      // ignore
    }

    // 5. Recalculate branch wallet balance from clean ledger
    await this.recalculateBranchWalletFromLedger(branchId);

    // 6. Security Audit Log
    await logSecurityEvent({
      userName: 'Super Admin',
      userRole: 'Super_Admin',
      actionType: 'Delete_Voucher' as any,
      targetEntity: 'branch_wallets',
      targetIdentifier: 'HISTORICAL-CLEANUP-SEPT-TOPUPS',
      eventDescription: `Permanently purged 2 erroneous September float records (FLT-856048 ₹50,532 & FLT-984105 ₹30,636) across float_allocations, wallet_ledger, and offline queue, and reconciled till wallet balance.`,
      justification: 'Super Admin manual balance correction for clean 1-Oct ledger books',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:ledger-updated'));
      window.dispatchEvent(new Event('asopalav:wallet-updated'));
    }

    return {
      purged: true,
      message: 'Successfully purged September test float records and reconciled wallet balance.',
    };
  }

  // --------------------------------------------------------------------------
  // 3. EXPENSE VOUCHER TRANSACTION (ATOMIC LEDGER & SPLITS)
  // --------------------------------------------------------------------------
  validateSection40A3(
    paymentMethod: string,
    amount: number,
    paymentType: string
  ): { isCompliant: boolean; limit: number; exceeded: boolean; reason?: string } {
    if (paymentMethod !== 'Physical_Cash' || useOverrideStore.getState().is40A3ExceededAllowed()) {
      return { isCompliant: true, limit: Infinity, exceeded: false };
    }
    // ₹10,000 cash limit rule. Courier exemption: ₹35,000.
    const limit = paymentType === 'Courier' ? 35000 : 10000;
    const exceeded = amount > limit;
    return {
      isCompliant: !exceeded,
      limit,
      exceeded,
      reason: exceeded
        ? `Cash Limit Notice: Payments above ₹${limit.toLocaleString('en-IN')} in cash require Manager Approval or should be paid via UPI / Bank Transfer.`
        : undefined,
    };
  }

  async getDailyVendorCashTotal(
    branchId: string,
    recipientName: string,
    date: string
  ): Promise<{ totalCash: number; voucherCount: number }> {
    if (!recipientName || !recipientName.trim()) return { totalCash: 0, voucherCount: 0 };
    const cleanRecipient = recipientName.trim().toLowerCase();

    try {
      let query = supabase
        .from('expense_vouchers')
        .select('*')
        .eq('payment_date', date)
        .eq('payment_method', 'Physical_Cash')
        .neq('status', 'Voided');

      if (branchId && branchId !== 'ALL') {
        query = query.eq('branch_id', branchId);
      }

      const { data } = await query;
      if (data && data.length > 0) {
        const matches = data.filter(
          (v) => v.recipient_name?.trim().toLowerCase() === cleanRecipient
        );
        const totalCash = matches.reduce((sum, v) => sum + (Number(v.total_amount) || 0), 0);
        return { totalCash, voucherCount: matches.length };
      }
    } catch (e) {
      console.warn('Daily vendor cash fallback:', e);
    }
    return { totalCash: 0, voucherCount: 0 };
  }

  async getStaffPendingAdvance(
    staffCode: string,
    branchId?: string
  ): Promise<{ hasPending: boolean; totalUnsettled: number; advances: StaffAdvance[] }> {
    if (!staffCode) return { hasPending: false, totalUnsettled: 0, advances: [] };

    try {
      const allAdvances = await this.getStaffAdvances(branchId);
      const staffAdvances = allAdvances.filter(
        (a) =>
          a.staff_code === staffCode &&
          a.unsettled_balance > 0 &&
          (a.status === 'Active_Unsettled' || a.status === 'Flagged_Salary_Deduction')
      );

      const totalUnsettled = staffAdvances.reduce((sum, a) => sum + (Number(a.unsettled_balance) || 0), 0);
      return {
        hasPending: staffAdvances.length > 0,
        totalUnsettled,
        advances: staffAdvances,
      };
    } catch (e) {
      console.warn('Staff pending advance check fallback:', e);
      return { hasPending: false, totalUnsettled: 0, advances: [] };
    }
  }

  /**
   * Generates a Comprehensive Master Spreadsheet CSV covering A to Z voucher data (28+ fields)
   */
  /**
   * Helper to retrieve cached staff directory synchronously for CSV generation
   */
  getStaffMembersSync(): StaffMember[] {
    try {
      const storeStaff = useVoucherStore.getState()?.masterData?.staff;
      if (Array.isArray(storeStaff) && storeStaff.length > 0) return storeStaff;
    } catch {}
    try {
      const raw = typeof window !== 'undefined'
        ? (localStorage.getItem('asopalav_master_staff') || localStorage.getItem('asopalav_staff_members'))
        : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  }

  /**
   * Extracts ONLY real saved splits (staff splits from DB or vendor splits JSON).
   * Never guesses names, divides amounts, or fabricates categories/departments from recipient strings.
   */
  extractAllSplitsFromVoucher(
    voucher: ExpenseVoucher,
    customSplitsMap?: Record<string, any[]>
  ): Array<{
    staffName: string;
    staffCode: string;
    departmentName: string;
    categoryName: string;
    amount: number;
    billNumber: string;
    description: string;
    isStaff: boolean;
  }> {
    if (!voucher) return [];

    // 1. Direct splitsMap from voucher_splits database table
    const mapped = customSplitsMap?.[voucher.voucher_number];
    if (Array.isArray(mapped) && mapped.length > 0) {
      return mapped.map((s: any) => ({
        staffName: s.staff_name || s.staffName || s.vendor_name || s.vendorName || '',
        staffCode: s.staff_code || s.staffCode || '',
        departmentName: s.department_name || s.departmentName || voucher.department_name || '',
        categoryName: s.category_name || s.categoryName || voucher.category_name || '',
        amount: Number(s.amount) || 0,
        billNumber: s.bill_number || s.billNumber || voucher.bill_number || '',
        description: s.description || s.remarks || voucher.remarks || '',
        isStaff: Boolean(s.staff_code || s.staffCode || s.staff_name || s.staffName),
      }));
    }

    // 2. voucher.staff_splits (if explicitly stored as JSON array)
    const staffSplits = (voucher as any).staff_splits;
    if (Array.isArray(staffSplits) && staffSplits.length > 0) {
      return staffSplits.map((s: any) => ({
        staffName: s.staffName || s.staff_name || '',
        staffCode: s.staffCode || s.staff_code || '',
        departmentName: s.departmentName || s.department_name || voucher.department_name || '',
        categoryName: s.categoryName || s.category_name || voucher.category_name || '',
        amount: Number(s.amount) || 0,
        billNumber: s.billNumber || s.bill_number || voucher.bill_number || '',
        description: s.description || voucher.remarks || '',
        isStaff: true,
      }));
    }

    // 3. voucher.vendor_splits (explicitly stored multi-vendor array on Shop_Vendor vouchers)
    if (
      voucher.payment_type !== 'Staff_Split' &&
      Array.isArray(voucher.vendor_splits) &&
      voucher.vendor_splits.length > 0
    ) {
      return voucher.vendor_splits.map((s: any) => ({
        staffName: s.vendor_name || s.vendorName || s.staff_name || '',
        staffCode: s.staff_code || s.staffCode || '',
        departmentName: s.department_name || s.departmentName || voucher.department_name || '',
        categoryName: s.category_name || s.categoryName || voucher.category_name || '',
        amount: Number(s.amount) || 0,
        billNumber: s.bill_number || s.billNumber || voucher.bill_number || '',
        description: s.description || s.remarks || voucher.remarks || '',
        isStaff: Boolean(s.staff_code || s.staffCode),
      }));
    }

    return [];
  }

  /**
   * Generates a Comprehensive Master Spreadsheet CSV covering A to Z voucher data with 100% split visibility
   */
  generateComprehensiveVoucherCSV(vouchers: ExpenseVoucher[], splitsMap?: Record<string, any[]>): string {
    const sanitize = (str: any) => {
      const sanitized = String(str ?? '').replace(/"/g, '""');
      if (/^[=+\-@|\t\r]/.test(sanitized)) {
        return `'${sanitized}`;
      }
      return sanitized;
    };

    const formatDisplayDate = (dateStr?: string) => {
      if (!dateStr) return '';
      try {
        const parts = dateStr.slice(0, 10).split('-');
        if (parts.length === 3 && parts[0].length === 4) {
          return `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
        return dateStr;
      } catch {
        return dateStr;
      }
    };

    const headers = [
      'Voucher Number',
      'Payment Date (YYYY-MM-DD)',
      'Payment Date (DD-MM-YYYY)',
      'Branch Code',
      'Branch ID',
      'Payment Mode',
      'Payment Type',
      'Total Amount (INR)',
      'Paid To (Beneficiary / Vendor)',
      'Expense Category',
      'Department Name',
      'Department Code',
      'Bill / Invoice Number',
      'Courier Partner',
      'Courier Tracking Number',
      'Requested By Staff Name',
      'Requested By Staff Code',
      'Recorded By (Cashier)',
      'Voucher Status',
      'Approved By Name',
      'Approved At',
      'Is High Value (>10k)',
      'Section 40A(3) Compliant',
      'Attached Bill Photo Count',
      'Attached Bill Photo URLs',
      'Itemized Split Breakdown (Staff / Dept / Amount)',
      'Particulars / Remarks',
      'Created At Timestamp',
    ];

    const rows = vouchers.map((v) => {
      const splits = this.extractAllSplitsFromVoucher(v, splitsMap);
      const splitSummary = splits.length > 0
        ? splits.map((s, i) => `${i + 1}. ${s.staffName}${s.staffCode ? ` (${s.staffCode})` : ''} [Dept: ${s.departmentName}]: INR ${s.amount}`).join(' | ')
        : 'Single Payee';

      const photoUrls = Array.isArray(v.bill_photo_urls) ? v.bill_photo_urls.filter(Boolean) : [];
      const is40A3Ok = v.payment_method !== 'Physical_Cash' || (Number(v.total_amount) || 0) <= (v.payment_type === 'Courier' ? 35000 : 10000);

      return [
        `"${sanitize(formatVoucherNumber(v.voucher_number))}"`,
        `"${sanitize(v.payment_date ? v.payment_date.slice(0, 10) : '')}"`,
        `"${sanitize(formatDisplayDate(v.payment_date))}"`,
        `"${sanitize(v.branch_code || 'ASI')}"`,
        `"${sanitize(v.branch_id || 'Aellp-ASI')}"`,
        `"${sanitize(v.payment_method === 'Physical_Cash' ? 'Physical Cash' : 'Online UPI')}"`,
        `"${sanitize(v.payment_type || 'Direct')}"`,
        Number(v.total_amount) || 0,
        `"${sanitize(v.recipient_name)}"`,
        `"${sanitize(v.category_name)}"`,
        `"${sanitize(v.department_name || '')}"`,
        `"${sanitize(v.department_code || '')}"`,
        `"${sanitize(v.bill_number || '')}"`,
        `"${sanitize(v.courier_partner_name || (v as any).courier_company || '')}"`,
        `"${sanitize((v as any).tracking_number || '')}"`,
        `"${sanitize(v.requested_by_staff_name || '')}"`,
        `"${sanitize(v.requested_by_staff_code || '')}"`,
        `"${sanitize(v.created_by_name || 'Cashier')}"`,
        `"${sanitize(v.status || 'Approved')}"`,
        `"${sanitize(v.approved_by_name || '')}"`,
        `"${sanitize(v.approved_at || '')}"`,
        (Number(v.total_amount) || 0) > 10000 ? 'Yes' : 'No',
        is40A3Ok ? 'Yes (Under Limit)' : 'Notice (>Limit)',
        photoUrls.length,
        `"${sanitize(photoUrls.join(' ; '))}"`,
        `"${sanitize(splitSummary)}"`,
        `"${sanitize((v.remarks || '').replace(/\n/g, ' '))}"`,
        `"${sanitize(v.created_at || '')}"`,
      ].join(',');
    });

    return 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows].join('\n');
  }

  /**
   * Generates a 100% Itemized Line-Level Split Schedule CSV for CA Audit & HR Payroll
   * - Each staff member and department gets their own distinct row with exact amounts
   */
  generateItemizedSplitCSV(vouchers: ExpenseVoucher[], splitsMap?: Record<string, any[]>): string {
    const sanitize = (str: any) => {
      const sanitized = String(str ?? '').replace(/"/g, '""');
      if (/^[=+\-@|\t\r]/.test(sanitized)) {
        return `'${sanitized}`;
      }
      return sanitized;
    };

    const formatDisplayDate = (dateStr?: string) => {
      if (!dateStr) return '';
      try {
        const parts = dateStr.slice(0, 10).split('-');
        if (parts.length === 3 && parts[0].length === 4) {
          return `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
        return dateStr;
      } catch {
        return dateStr;
      }
    };

    const headers = [
      'Voucher Number',
      'Line #',
      'Date (DD-MM-YYYY)',
      'Branch Code',
      'Payment Mode',
      'Beneficiary / Staff Member',
      'Staff Code',
      'Department',
      'Expense Category',
      'Individual Amount (INR)',
      'Voucher Total (INR)',
      'Bill / Ref No',
      'Payment Type',
      'Recorded By',
      'Status',
      'Line Description / Narration',
    ];

    const allRows: string[] = [];

    vouchers.forEach((v) => {
      const splits = this.extractAllSplitsFromVoucher(v, splitsMap);

      if (splits.length > 0) {
        splits.forEach((s, idx: number) => {
          allRows.push([
            `"${sanitize(formatVoucherNumber(v.voucher_number))}"`,
            idx + 1,
            `"${sanitize(formatDisplayDate(v.payment_date))}"`,
            `"${sanitize(v.branch_code || 'ASI')}"`,
            `"${sanitize(v.payment_method === 'Physical_Cash' ? 'Physical Cash' : 'Online UPI')}"`,
            `"${sanitize(s.staffName)}"`,
            `"${sanitize(s.staffCode)}"`,
            `"${sanitize(s.departmentName)}"`,
            `"${sanitize(s.categoryName)}"`,
            Number(s.amount) || 0,
            Number(v.total_amount) || 0,
            `"${sanitize(s.billNumber || v.bill_number || '')}"`,
            `"${sanitize(v.payment_type || 'Split')}"`,
            `"${sanitize(v.created_by_name || 'Cashier')}"`,
            `"${sanitize(v.status || 'Approved')}"`,
            `"${sanitize(s.description || v.remarks || `Staff split ${idx + 1} of ${splits.length}`)}"`,
          ].join(','));
        });
      } else {
        // Single line item
        allRows.push([
          `"${sanitize(formatVoucherNumber(v.voucher_number))}"`,
          1,
          `"${sanitize(formatDisplayDate(v.payment_date))}"`,
          `"${sanitize(v.branch_code || 'ASI')}"`,
          `"${sanitize(v.payment_method === 'Physical_Cash' ? 'Physical Cash' : 'Online UPI')}"`,
          `"${sanitize(v.recipient_name)}"`,
          `"${sanitize(v.requested_by_staff_code || '')}"`,
          `"${sanitize(v.department_name || '')}"`,
          `"${sanitize(v.category_name)}"`,
          Number(v.total_amount) || 0,
          Number(v.total_amount) || 0,
          `"${sanitize(v.bill_number || '')}"`,
          `"${sanitize(v.payment_type || 'Direct')}"`,
          `"${sanitize(v.created_by_name || 'Cashier')}"`,
          `"${sanitize(v.status || 'Approved')}"`,
          `"${sanitize(v.remarks || '')}"`,
        ].join(','));
      }
    });

    return 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...allRows].join('\n');
  }

  /**
   * Generates a Master CSV (Backwards compatible alias for generateItemizedSplitCSV)
   */
  generateMasterCSV(vouchers: ExpenseVoucher[], _categories?: any[], _departments?: any[]): string {
    return this.generateItemizedSplitCSV(vouchers);
  }

  /**
   * Generates a Tally Prime CSV with Compound / Multi-Debit Ledger Entries & Exact Department Tracking
   */
  generateTallyExportCSV(vouchers: ExpenseVoucher[], splitsMap?: Record<string, any[]>): string {
    const headers = [
      'Voucher Date (DD-MM-YYYY)',
      'Voucher Type',
      'Voucher Number',
      'Debit Ledger (Expense Head)',
      'Debit Amount (INR)',
      'Credit Ledger (Payment Source)',
      'Credit Amount (INR)',
      'Cost Centre (Showroom Branch)',
      'Department',
      'Paid To (Beneficiary)',
      'Staff Code',
      'Bill Reference No',
      'Payment Mode',
      'Narration / Audit Remarks',
    ];

    const mapCategoryToDebitLedger = (category: string) => {
      const cat = (category || '').trim().toLowerCase();
      if (cat.includes('advance') || cat.includes('imprest')) return 'Staff Imprest & Advance A/c';
      if (cat.includes('incentive') || cat.includes('commission') || cat.includes('target')) return 'Sales Incentive & Commission A/c';
      if (cat.includes('stationery') || cat.includes('printing') || cat.includes('paper')) return 'Printing & Stationery A/c';
      if (cat.includes('food') || cat.includes('welfare') || cat.includes('tea') || cat.includes('refreshment') || cat.includes('snacks')) return 'Staff Welfare & Refreshment A/c';
      if (cat.includes('repair') || cat.includes('maintenance') || cat.includes('hardware')) return 'Repairs & Maintenance A/c';
      if (cat.includes('courier') || cat.includes('postage') || cat.includes('dispatch') || cat.includes('parcel')) return 'Postage & Courier Expenses A/c';
      if (cat.includes('electricity') || cat.includes('power') || cat.includes('utility') || cat.includes('water')) return 'Electricity & Utility Expenses A/c';
      if (cat.includes('travel') || cat.includes('conveyance') || cat.includes('fuel') || cat.includes('petrol') || cat.includes('auto')) return 'Conveyance & Travel Expenses A/c';
      if (cat.includes('housekeeping') || cat.includes('cleaning') || cat.includes('pantry') || cat.includes('sanitation')) return 'Housekeeping & Cleaning A/c';
      if (cat.includes('marketing') || cat.includes('advertisement') || /\bad\b/.test(cat) || cat.includes('branding') || cat.includes('promotion')) return 'Advertisement & Publicity A/c';
      return `${category || 'Expense'} A/c`;
    };

    const mapPaymentToCreditLedger = (method: string, branchCode: string) => {
      if (method === 'Physical_Cash') {
        return `Cash on Hand - ${branchCode || 'ASI'} A/c`;
      }
      return `UPI Current A/c - ${branchCode || 'ASI'}`;
    };

    const formatTallyDate = (dateStr?: string) => {
      if (!dateStr) return '';
      try {
        const parts = dateStr.slice(0, 10).split('-');
        if (parts.length === 3 && parts[0].length === 4) {
          return `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
        return dateStr;
      } catch {
        return dateStr;
      }
    };

    // Exclude Advance_Settlement vouchers from Tally export
    const validVouchers = vouchers.filter((v) =>
      (v.status === 'Approved' || v.status === undefined) &&
      v.payment_type !== 'Advance_Settlement'
    );

    const sanitizeCsvCell = (str: any) => {
      const sanitized = String(str ?? '').replace(/"/g, '""');
      if (/^[=+\-@|\t\r]/.test(sanitized)) {
        return `'${sanitized}`;
      }
      return sanitized;
    };

    const rows: string[] = [];

    validVouchers.forEach((v) => {
      const formattedDate = formatTallyDate(v.payment_date);
      const creditLedger = mapPaymentToCreditLedger(v.payment_method, v.branch_code);
      const costCentre = `Showroom ${v.branch_code || 'ASI'}`;
      const paymentModeStr = v.payment_method === 'Physical_Cash' ? 'Physical Cash' : 'Online UPI';
      const splits = this.extractAllSplitsFromVoucher(v, splitsMap);

      if (splits.length > 0) {
        // Multi-Debit Compound Entry
        splits.forEach((s, idx: number) => {
          const splitCategory = s.categoryName || v.category_name;
          const splitDebitLedger = mapCategoryToDebitLedger(splitCategory);
          const splitPayee = s.staffName || v.recipient_name;
          const splitCode = s.staffCode || '';
          const splitDept = s.departmentName || v.department_name || '';
          const splitBillRef = s.billNumber || v.bill_number || '';
          const splitAmt = Number(s.amount) || 0;
          const splitNarration = sanitizeCsvCell(
            `Being payment of INR ${splitAmt} to ${splitPayee}${splitCode ? ` (${splitCode})` : ''} - Dept: ${splitDept} for ${splitCategory} (Voucher #${formatVoucherNumber(v.voucher_number)})`
          );

          rows.push([
            `"${formattedDate}"`,
            `"Payment"`,
            `"${formatVoucherNumber(v.voucher_number)}"`,
            `"${splitDebitLedger}"`,
            splitAmt,
            idx === 0 ? `"${creditLedger}"` : `""`,
            idx === 0 ? Number(v.total_amount) || 0 : `""`,
            `"${costCentre}"`,
            `"${sanitizeCsvCell(splitDept)}"`,
            `"${sanitizeCsvCell(splitPayee)}"`,
            `"${sanitizeCsvCell(splitCode)}"`,
            `"${sanitizeCsvCell(splitBillRef)}"`,
            `"${paymentModeStr}"`,
            `"${splitNarration}"`,
          ].join(','));
        });
      } else {
        // Standard single debit line
        const debitLedger = mapCategoryToDebitLedger(v.category_name);
        const payee = sanitizeCsvCell(v.recipient_name || '');
        const staffCode = sanitizeCsvCell(v.requested_by_staff_code || '');
        const deptName = sanitizeCsvCell(v.department_name || '');
        const billRef = sanitizeCsvCell(v.bill_number || '');
        const rawRemarks = v.remarks ? ` - ${v.remarks}` : '';
        const billInfo = v.bill_number ? ` (Bill Ref: ${v.bill_number})` : '';
        const formattedNarration = sanitizeCsvCell(
          `Being payment of INR ${v.total_amount} made to ${v.recipient_name} for ${v.category_name}${billInfo}${rawRemarks}`
        );

        rows.push([
          `"${formattedDate}"`,
          `"Payment"`,
          `"${formatVoucherNumber(v.voucher_number)}"`,
          `"${debitLedger}"`,
          Number(v.total_amount) || 0,
          `"${creditLedger}"`,
          Number(v.total_amount) || 0,
          `"${costCentre}"`,
          `"${deptName}"`,
          `"${payee}"`,
          `"${staffCode}"`,
          `"${billRef}"`,
          `"${paymentModeStr}"`,
          `"${formattedNarration}"`,
        ].join(','));
      }
    });

    return 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows].join('\n');
  }

  async checkDuplicateBill(
    branchId: string,
    recipientName: string,
    billNumber: string,
    excludeVoucherNumber?: string
  ): Promise<ExpenseVoucher | null> {
    if (!billNumber || !billNumber.trim() || !recipientName || !recipientName.trim()) return null;
    const cleanBill = billNumber.trim().toLowerCase();
    const cleanRecipient = recipientName.trim().toLowerCase();

    try {
      let query = supabase
        .from('expense_vouchers')
        .select('*')
        .neq('status', 'Voided');

      if (branchId && branchId !== 'ALL') {
        query = query.eq('branch_id', branchId);
      }

      const { data } = await query;
      if (data && data.length > 0) {
        const match = data.find(
          (v) =>
            v.voucher_number !== excludeVoucherNumber &&
            v.bill_number?.trim().toLowerCase() === cleanBill &&
            v.recipient_name?.trim().toLowerCase() === cleanRecipient
        );
        if (match) return match;
      }
    } catch (e) {
      console.warn('Duplicate check local fallback', e);
    }
    return null;
  }

  async generateNextVoucherNumber(branchCodeOrId?: string | null): Promise<string> {
    const code = normalizeBranchCode(branchCodeOrId || 'ASI');
    let maxNum = 0;

    const processVoucherNumber = (vNum?: string | null) => {
      if (!vNum) return;
      const clean = vNum.trim();
      const codePrefixRegex = new RegExp(`^(?:VOC-)?${code}[-_]?(?:\\d{4}[-_])?`, 'i');
      if (codePrefixRegex.test(clean) || clean.toUpperCase().includes(code)) {
        const match = clean.match(/(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    };

    try {
      // 1. Query Supabase
      const { data } = await supabase
        .from('expense_vouchers')
        .select('voucher_number, branch_code, branch_id')
        .or(`branch_code.eq.${code},branch_id.eq.Aellp-${code},branch_id.eq.${code}`);

      if (data && data.length > 0) {
        data.forEach((v) => processVoucherNumber(v.voucher_number));
      }
    } catch {
      // Supabase offline / fallback
    }

    // 2. Query cached store vouchers
    try {
      const storeVouchers = useVoucherStore.getState().vouchers;
      const relevantKeys = [code, `Aellp-${code}`, 'ALL'];
      relevantKeys.forEach((k) => {
        const list = storeVouchers[k];
        if (Array.isArray(list)) {
          list.forEach((v) => {
            if (
              normalizeBranchCode(v.branch_code) === code ||
              normalizeBranchCode(v.branch_id) === code
            ) {
              processVoucherNumber(v.voucher_number);
            }
          });
        }
      });
    } catch {
      // Ignore
    }

    // 3. Query localStorage
    try {
      const localKeys = [`asopalav_vouchers_${code}`, `asopalav_vouchers_Aellp-${code}`, 'asopalav_vouchers_ALL'];
      localKeys.forEach((key) => {
        const raw = localStorage.getItem(key);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            list.forEach((v: any) => {
              if (
                normalizeBranchCode(v.branch_code) === code ||
                normalizeBranchCode(v.branch_id) === code
              ) {
                processVoucherNumber(v.voucher_number);
              }
            });
          }
        }
      });
    } catch {
      // Ignore
    }

    const nextNum = maxNum > 0 ? maxNum + 1 : 1;
    return String(nextNum).padStart(5, '0');
  }

  async generateNextAdvanceReceiptNumber(branchCodeOrId?: string | null): Promise<string> {
    const code = normalizeBranchCode(branchCodeOrId || 'ASI');
    let maxNum = 0;

    const processReceiptNumber = (rNum?: string | null) => {
      if (!rNum) return;
      const clean = rNum.trim();
      if (clean.toUpperCase().includes(code)) {
        const match = clean.match(/(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    };

    try {
      const { data } = await supabase
        .from('staff_advances')
        .select('receipt_number, branch_code, branch_id')
        .or(`branch_code.eq.${code},branch_id.eq.Aellp-${code},branch_id.eq.${code}`);

      if (data && data.length > 0) {
        data.forEach((a) => processReceiptNumber(a.receipt_number));
      }
    } catch {
      // Fallback
    }

    try {
      const localKeys = [`asopalav_advances_${code}`, `asopalav_advances_Aellp-${code}`, 'asopalav_advances_ALL'];
      localKeys.forEach((key) => {
        const raw = localStorage.getItem(key);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            list.forEach((a: any) => {
              if (
                normalizeBranchCode(a.branch_code) === code ||
                normalizeBranchCode(a.branch_id) === code
              ) {
                processReceiptNumber(a.receipt_number);
              }
            });
          }
        }
      });
    } catch {
      // Ignore
    }

    const nextNum = maxNum > 0 ? maxNum + 1 : 1;
    return `${code}-ADV-${String(nextNum).padStart(4, '0')}`;
  }

  /**
   * Resiliently insert an expense voucher into database.
   * If the Supabase schema lacks newly introduced extended columns, it auto-retries with core columns.
   */
  private async insertExpenseVoucherRecord(record: Record<string, any>): Promise<void> {
    const payload = { ...record };
    const { error } = await supabase.from('expense_vouchers').insert([payload]);
    if (!error) return;

    // Check if error is due to an unmigrated column in database schema cache
    if (error.message && error.message.includes('column of') && error.message.includes('expense_vouchers')) {
      console.warn('[Supabase Schema Adaptor] Retrying voucher insert with sanitized core fields:', error.message);
      const corePayload: Record<string, any> = {
        id: record.id,
        voucher_number: record.voucher_number,
        branch_id: record.branch_id,
        branch_code: record.branch_code,
        payment_date: record.payment_date,
        payment_type: record.payment_type,
        payment_method: record.payment_method,
        bank_utr_number: record.bank_utr_number || null,
        total_amount: record.total_amount,
        recipient_name: record.recipient_name,
        category_name: record.category_name,
        department_name: record.department_name || null,
        department_code: record.department_code || null,
        courier_partner_name: record.courier_partner_name || null,
        bill_number: record.bill_number || null,
        bill_photo_urls: record.bill_photo_urls || [],
        remarks: record.remarks,
        created_by_name: record.created_by_name,
        status: record.status || 'Approved',
        created_at: record.created_at || new Date().toISOString(),
      };
      const { error: retryError } = await supabase.from('expense_vouchers').insert([corePayload]);
      if (retryError) {
        if (retryError.code === '23505' || retryError.message?.includes('duplicate key') || retryError.message?.includes('voucher_number')) {
          throw new Error(`Duplicate Voucher Number: Voucher #${record.voucher_number} already exists in the system. Please enter the next sequential number from your physical bill book.`);
        }
        console.error('Sanitized voucher insert error:', retryError);
        throw new Error(retryError.message);
      }
      return;
    }

    if (error.code === '23505' || error.message?.includes('duplicate key') || error.message?.includes('voucher_number')) {
      throw new Error(`Duplicate Voucher Number: Voucher #${record.voucher_number} already exists in the system. Please enter the next sequential number from your physical bill book.`);
    }

    console.error('Voucher insert error:', error);
    throw new Error(error.message);
  }

  async createVoucherWithLedger(params: CreateVoucherParams): Promise<ExpenseVoucher> {
    const { voucher, splits, userName, userRole } = params;

    // Guard: Reject zero or negative amounts
    if (!voucher.total_amount || voucher.total_amount <= 0) {
      throw new Error('Voucher amount must be a positive number greater than zero.');
    }
    // Guard: Validate splits if present
    if (splits && splits.length > 0) {
      const splitTotal = splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
      if (Math.abs(splitTotal - voucher.total_amount) > 0.01) {
        throw new Error(`Sum of staff splits (₹${splitTotal.toFixed(2)}) does not match voucher total amount (₹${voucher.total_amount.toFixed(2)}).`);
      }
      if (splits.some((s) => Number(s.amount) <= 0)) {
        throw new Error('All staff split amounts must be greater than zero.');
      }
    }

    // 1. Period Lock Guard (Super Admin / Admin can bypass)
    const isLocked = await this.checkIsPeriodLocked(voucher.payment_date);
    if (isLocked && !isPrivilegedAdminRole(userRole)) {
      throw new Error(`Cannot record voucher: Accounting Period for date ${voucher.payment_date} is LOCKED.`);
    }

    const isHighValue = voucher.total_amount > 10000;
    const requiresSuperAdminApproval = voucher.total_amount > 50000;

    // 1B. Same-Month Duplicate Voucher Guard
    // Rule: Same voucher number can repeat across different months, but is strictly unique within the same month.
    let finalVoucherNumber = voucher.voucher_number;
    try {
      const vDate = voucher.payment_date || new Date().toISOString().slice(0, 10);
      const startOfMonthStr = `${vDate.slice(0, 7)}-01`;
      const endOfMonthStr = `${vDate.slice(0, 7)}-31`;

      const parts = (voucher.voucher_number || '').split('-');
      const numPrefix = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : voucher.voucher_number;

      const { data: existingMonthDups } = await supabase
        .from('expense_vouchers')
        .select('id, voucher_number, total_amount')
        .eq('branch_id', voucher.branch_id)
        .neq('status', 'Voided')
        .gte('payment_date', startOfMonthStr)
        .lte('payment_date', endOfMonthStr)
        .ilike('voucher_number', `${numPrefix}%`)
        .limit(1);

      if (existingMonthDups && existingMonthDups.length > 0) {
        throw new Error(`Bill #${numPrefix} already exists in this month. Same voucher number cannot be reused in the same month.`);
      }

      // 1C. Cross-Month Token Check:
      // If this number already exists in a PREVIOUS/DIFFERENT month, ensure a collision token is appended
      // to guarantee uniqueness across months in PostgreSQL while permitting monthly book rollover.
      const { data: otherMonthDups } = await supabase
        .from('expense_vouchers')
        .select('id, voucher_number')
        .eq('branch_id', voucher.branch_id)
        .neq('status', 'Voided')
        .or(`payment_date.lt.${startOfMonthStr},payment_date.gt.${endOfMonthStr}`)
        .ilike('voucher_number', `${numPrefix}%`)
        .limit(1);

      if (otherMonthDups && otherMonthDups.length > 0) {
        if (finalVoucherNumber === numPrefix) {
          finalVoucherNumber = `${numPrefix}-${generateVoucherCollisionToken()}`;
        }
      }
    } catch (dupErr: any) {
      if (dupErr.message?.includes('already exists in this month')) {
        throw dupErr;
      }
      console.warn('Same-month duplicate pre-check skipped on error:', dupErr);
    }

    // 2. Prepare Database Voucher Record
    const voucherDbRecord = {
      id: crypto.randomUUID(),
      voucher_number: finalVoucherNumber,
      branch_id: voucher.branch_id,
      branch_code: voucher.branch_code,
      payment_date: voucher.payment_date,
      payment_type: voucher.payment_type,
      payment_method: voucher.payment_method,
      bank_utr_number: voucher.bank_utr_number || null,
      total_amount: voucher.total_amount,
      recipient_name: voucher.recipient_name,
      category_name: voucher.category_name,
      department_name: voucher.department_name || null,
      department_code: voucher.department_code || null,
      courier_partner_name: (voucher as any).courier_company || (voucher as any).courier_partner_name || null,
      requested_by_staff_code: voucher.requested_by_staff_code || null,
      requested_by_staff_name: voucher.requested_by_staff_name || null,
      vendor_splits: voucher.vendor_splits || null,
      bill_number: voucher.bill_number || null,
      remarks: voucher.remarks,
      bill_photo_urls: voucher.bill_photo_urls || [],
      created_by_name: voucher.created_by_name || userName,
      status: (requiresSuperAdminApproval ? 'Pending_Approval' : 'Approved') as ExpenseVoucher['status'],
      created_at: new Date().toISOString(),
    };

    const fullVoucher: ExpenseVoucher = {
      ...voucherDbRecord,
      is_high_value: isHighValue,
    };

    // 2A. Primary Database Atomic RPC (Zero Race Conditions, Single Round-Trip)
    try {
      const allowNegative = useOverrideStore.getState().isNegativeWalletAllowed();
      const { data: atomicData, error: rpcError } = await supabase.rpc('create_expense_voucher_atomic', {
        p_voucher: voucherDbRecord,
        p_splits: splits && splits.length > 0 ? splits : [],
        p_user_name: userName,
        p_user_role: userRole,
        p_allow_negative: allowNegative,
      });

      if (!rpcError && atomicData) {
        const atomicVoucher: ExpenseVoucher = {
          ...(atomicData as ExpenseVoucher),
          is_high_value: isHighValue,
        };

        useVoucherStore.getState().addVoucherLocally(atomicVoucher);
        useVoucherStore.getState().invalidateVouchers(voucher.branch_id);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('asopalav:vouchers-updated', { detail: { action: 'INSERT', voucher: atomicVoucher } }));
          window.dispatchEvent(new Event('asopalav:wallet-updated'));
        }
        return atomicVoucher;
      }

      if (rpcError) {
        const msg = rpcError.message || '';
        if (
          msg.includes('Insufficient') ||
          msg.includes('duplicate key') ||
          msg.includes('already exists') ||
          msg.includes('LOCKED') ||
          msg.includes('positive number')
        ) {
          throw new Error(msg);
        }
        console.warn('[Supabase Atomic RPC Fallback] RPC failed with non-blocking schema error, proceeding with standard insertion:', msg);
      }
    } catch (rpcEx: any) {
      const msg = rpcEx?.message || '';
      if (
        msg.includes('Insufficient') ||
        msg.includes('duplicate key') ||
        msg.includes('already exists') ||
        msg.includes('LOCKED') ||
        msg.includes('positive number')
      ) {
        throw rpcEx;
      }
      console.warn('[Supabase Atomic RPC Fallback] RPC exception, proceeding with standard insertion:', msg);
    }

    // 3. If Amount > 50,000: Mark Pending Approval (No immediate wallet deduction until approved)
    if (requiresSuperAdminApproval) {
      await this.insertExpenseVoucherRecord(voucherDbRecord);

      if (splits && splits.length > 0) {
        const splitRecords = splits.map((s) => ({
          id: crypto.randomUUID(),
          voucher_number: voucher.voucher_number,
          branch_id: voucher.branch_id,
          branch_code: voucher.branch_code,
          staff_code: s.staffCode,
          staff_name: s.staffName,
          department_name: s.departmentName,
          category_name: s.categoryName,
          amount: s.amount,
          created_at: new Date().toISOString(),
        }));

        const { error: splitError } = await supabase.from('voucher_splits').insert(splitRecords);
        if (splitError) {
          console.error('Splits insert error:', splitError);
          throw new Error(splitError.message);
        }
      }

      // Broadcast approval request notification to Super Admin
      useNotificationStore.getState().addNotification({
        title: 'Voucher Requires Super Admin Approval',
        message: `High-value voucher ${voucher.voucher_number} of ₹${voucher.total_amount.toLocaleString('en-IN')} to ${voucher.recipient_name} requires Super Admin / Owner approval before payout.`,
        type: 'approval_request',
        target_roles: ['Super_Admin'],
        branch_id: voucher.branch_id,
        reference_id: voucher.voucher_number,
        amount: voucher.total_amount,
      });

      await logSecurityEvent({
        userName,
        userRole,
        actionType: 'Create_Voucher',
        targetEntity: 'expense_vouchers',
        targetIdentifier: voucher.voucher_number,
        eventDescription: `Created voucher ${voucher.voucher_number} (₹${voucher.total_amount}) - Queued for Super Admin approval (> ₹50,000 threshold)`,
        justification: voucher.remarks,
      });

      useVoucherStore.getState().addVoucherLocally(fullVoucher);
      useVoucherStore.getState().invalidateVouchers(voucher.branch_id);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('asopalav:vouchers-updated', { detail: { action: 'INSERT', voucher: fullVoucher } }));
        window.dispatchEvent(new Event('asopalav:wallet-updated'));
      }

      return fullVoucher;
    }

    // 4. Auto-Approved Case (₹0 - ₹50,000): Verify Liquidity First
    const currentWallet = await this.getBranchWallet(voucher.branch_id);
    const allowNegative = useOverrideStore.getState().isNegativeWalletAllowed();

    if (voucher.payment_method === 'Physical_Cash') {
      if (currentWallet.cash_balance < voucher.total_amount && !allowNegative) {
        throw new Error(
          `Insufficient Cash Drawer Balance: Available till balance is ₹${currentWallet.cash_balance.toLocaleString('en-IN')}, but voucher requires ₹${voucher.total_amount.toLocaleString('en-IN')}. In real-world retail accounting, payments cannot proceed without cash in till. Please top up cash float from showroom safe before disbursing.`
        );
      }
    } else {
      if (currentWallet.upi_balance < voucher.total_amount && !allowNegative) {
        throw new Error(
          `Insufficient Online/UPI Wallet Balance: Available UPI balance is ₹${currentWallet.upi_balance.toLocaleString('en-IN')}, but voucher requires ₹${voucher.total_amount.toLocaleString('en-IN')}. Please top up account balance before disbursing.`
        );
      }
    }

    // 5. Insert Voucher into Database FIRST (Guarantees zero double-deductions if voucher creation fails)
    await this.insertExpenseVoucherRecord(voucherDbRecord);

    // 6. Deduct from Branch Wallet
    let newRunningBalance = 0;
    if (voucher.payment_method === 'Physical_Cash') {
      currentWallet.cash_balance = currentWallet.cash_balance - voucher.total_amount;
      newRunningBalance = currentWallet.cash_balance;
    } else {
      currentWallet.upi_balance = currentWallet.upi_balance - voucher.total_amount;
      newRunningBalance = currentWallet.upi_balance;
    }
    await this.updateBranchWallet(currentWallet);

    const ledgerRemarks = allowNegative && ((voucher.payment_method === 'Physical_Cash' && newRunningBalance < 0) || (voucher.payment_method !== 'Physical_Cash' && newRunningBalance < 0))
      ? `${voucher.remarks ? `${voucher.remarks} • ` : ''}[SuperAdmin Override: Emergency Till Overdraft]`
      : voucher.remarks;

    // 7. Record Immutable Wallet Ledger
    await this.appendLedgerEntry({
      branch_id: voucher.branch_id,
      branch_code: voucher.branch_code,
      wallet_type: voucher.payment_method === 'Physical_Cash' ? 'Cash' : 'UPI',
      transaction_type: 'Expense_Voucher',
      reference_number: voucher.voucher_number,
      debit_amount: voucher.total_amount,
      credit_amount: 0,
      running_balance: newRunningBalance,
      remarks: ledgerRemarks,
      cashier_name: userName,
    });

    // 8. Insert Multi-Staff Splits if applicable
    if (splits && splits.length > 0) {
      const splitRecords = splits.map((s) => ({
        id: crypto.randomUUID(),
        voucher_number: voucher.voucher_number,
        branch_id: voucher.branch_id,
        branch_code: voucher.branch_code,
        staff_code: s.staffCode,
        staff_name: s.staffName,
        department_name: s.departmentName,
        category_name: s.categoryName,
        amount: s.amount,
        created_at: new Date().toISOString(),
      }));

      const { error: splitError } = await supabase.from('voucher_splits').insert(splitRecords);
      if (splitError) {
        console.error('Splits insert error:', splitError);
        throw new Error(splitError.message);
      }
    }

    // 8. If ₹10,001 to ₹50,000: Broadcast notification to Manager, Admin, Super Admin, Accountant
    if (voucher.total_amount > 10000 && voucher.total_amount <= 50000) {
      useNotificationStore.getState().addNotification({
        title: 'High-Value Voucher Created',
        message: `Voucher ${voucher.voucher_number} of ₹${voucher.total_amount.toLocaleString('en-IN')} (${voucher.payment_method.replace('_', ' ')}) paid to ${voucher.recipient_name} for ${voucher.category_name}.`,
        type: 'high_value_voucher',
        target_roles: ['Store_Manager', 'Super_Admin', 'Cashier', 'Auditor'],
        branch_id: voucher.branch_id,
        reference_id: voucher.voucher_number,
        amount: voucher.total_amount,
      });
    }

    // 9. Security Audit Log
    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Create_Voucher',
      targetEntity: 'expense_vouchers',
      targetIdentifier: voucher.voucher_number,
      eventDescription: `Paid ${voucher.payment_method.replace('_', ' ')} expense of ₹${voucher.total_amount} to ${voucher.recipient_name} for ${voucher.category_name}${isHighValue ? ' [HIGH VALUE]' : ''}`,
      justification: voucher.remarks,
    });

    useVoucherStore.getState().addVoucherLocally(fullVoucher);
    useVoucherStore.getState().invalidateVouchers(voucher.branch_id);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:vouchers-updated', { detail: { action: 'INSERT', voucher: fullVoucher } }));
      window.dispatchEvent(new Event('asopalav:wallet-updated'));
    }

    return fullVoucher;
  }

  private voucherSplitsCache: Map<string, { splits: VoucherSplit[]; fetchedAt: number }> = new Map();

  async getVoucherSplits(voucherNumber: string, forceRefresh: boolean = false): Promise<VoucherSplit[]> {
    if (!forceRefresh) {
      const cached = this.voucherSplitsCache.get(voucherNumber);
      if (cached && Date.now() - cached.fetchedAt < 300000) { // 5 minutes cache
        return cached.splits;
      }
    }
    try {
      const { data, error } = await supabase
        .from('voucher_splits')
        .select('*')
        .eq('voucher_number', voucherNumber)
        .order('created_at', { ascending: true });
      if (!error && data) {
        const splits = data as VoucherSplit[];
        this.voucherSplitsCache.set(voucherNumber, { splits, fetchedAt: Date.now() });
        return splits;
      }
    } catch (e) {
      console.warn('Voucher splits fetch error:', e);
    }
    return this.voucherSplitsCache.get(voucherNumber)?.splits || [];
  }

  invalidateVoucherSplits(voucherNumber?: string) {
    if (voucherNumber) {
      this.voucherSplitsCache.delete(voucherNumber);
    } else {
      this.voucherSplitsCache.clear();
    }
  }

  async approveVoucher(
    voucher: ExpenseVoucher,
    approverName: string,
    approverRole: string
  ): Promise<ExpenseVoucher> {
    // H-8 Security: Re-fetch the approver's TRUE role from database DB.
    // The client-passed approverRole cannot be trusted — localStorage role_code is spoofable.
    // We also re-fetch the voucher's live status so we don't approve an already-voided voucher.
    let verifiedApproverRole = approverRole;
    try {
      // Look up the approver's live role from the DB using their username (stored in approverName or from authStore)
      const { useAuthStore } = await import('@/store/authStore');
      const authUser = useAuthStore.getState().user;
      if (authUser?.id) {
        const { data: dbUser } = await supabase
          .from('app_users')
          .select('role_code, is_active')
          .eq('id', authUser.id)
          .maybeSingle();
        if (dbUser?.role_code) {
          verifiedApproverRole = dbUser.role_code;
          if (!dbUser.is_active) {
            throw new Error('Your account has been deactivated. Cannot approve voucher.');
          }
        }
      }
    } catch (e: any) {
      if (e?.message?.includes('deactivated')) throw e;
      console.warn('[approveVoucher] Could not verify approver role from DB, using session role:', e);
    }

    if (!isPrivilegedAdminRole(verifiedApproverRole) && verifiedApproverRole !== 'Store_Manager') {
      throw new Error('Only Super Admin, Admin, or Store Manager can approve high-value vouchers.');
    }

    // 1. Deduct from Branch Wallet
    const currentWallet = await this.getBranchWallet(voucher.branch_id);
    let newRunningBalance = 0;
    if (voucher.payment_method === 'Physical_Cash') {
      if (currentWallet.cash_balance < voucher.total_amount) {
        throw new Error(`Insufficient Cash Drawer Balance: ₹${currentWallet.cash_balance.toLocaleString('en-IN')} available.`);
      }
      currentWallet.cash_balance -= voucher.total_amount;
      newRunningBalance = currentWallet.cash_balance;
    } else {
      if (currentWallet.upi_balance < voucher.total_amount) {
        throw new Error(`Insufficient UPI Balance: ₹${currentWallet.upi_balance.toLocaleString('en-IN')} available.`);
      }
      currentWallet.upi_balance -= voucher.total_amount;
      newRunningBalance = currentWallet.upi_balance;
    }
    await this.updateBranchWallet(currentWallet);

    // 2. Append Ledger Entry
    await this.appendLedgerEntry({
      branch_id: voucher.branch_id,
      branch_code: voucher.branch_code,
      wallet_type: voucher.payment_method === 'Physical_Cash' ? 'Cash' : 'UPI',
      transaction_type: 'Expense_Voucher',
      reference_number: voucher.voucher_number,
      debit_amount: voucher.total_amount,
      credit_amount: 0,
      running_balance: newRunningBalance,
      remarks: `APPROVED (>₹50,000): ${voucher.remarks}`,
      cashier_name: approverName,
    });

    // 3. Update Voucher Status
    const updatedVoucher: ExpenseVoucher = {
      ...voucher,
      status: 'Approved',
      approved_by_name: approverName,
      approved_at: new Date().toISOString(),
    };

    try {
      const { error } = await supabase
        .from('expense_vouchers')
        .update({
          status: 'Approved',
          approved_by_name: approverName,
          approved_at: updatedVoucher.approved_at,
        })
        .eq('voucher_number', voucher.voucher_number);
      if (error) throw error;
    } catch (e) {
      console.warn('Approve voucher fallback to offline queue:', e);
      useOfflineQueue.getState().enqueueMutation({
        type: 'update_voucher',
        table: 'expense_vouchers',
        action: 'update',
        payload: {
          status: 'Approved',
          approved_by_name: approverName,
          approved_at: updatedVoucher.approved_at,
        },
        matchField: 'voucher_number',
        matchValue: voucher.voucher_number,
        description: `Approve voucher ${voucher.voucher_number}`,
      });
    }

    // 4. Log audit
    await logSecurityEvent({
      userName: approverName,
      userRole: approverRole,
      actionType: 'Approve_Voucher',
      targetEntity: 'expense_vouchers',
      targetIdentifier: voucher.voucher_number,
      eventDescription: `${approverRole} approved high-value voucher ${voucher.voucher_number} of ₹${voucher.total_amount}`,
      justification: 'High-value threshold authorization (> ₹50,000)',
    });

    useVoucherStore.getState().updateVoucherLocally(updatedVoucher);
    useVoucherStore.getState().invalidateVouchers(voucher.branch_id);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:vouchers-updated', { detail: { action: 'UPDATE', voucher: updatedVoucher } }));
      window.dispatchEvent(new Event('asopalav:wallet-updated'));
    }

    return updatedVoucher;
  }

  /**
   * Fast Multi-Bill Batch Voucher Creation (Festival / EOM Rush Mode)
   * Creates multiple individual expense vouchers in a single counter transaction with atomic drawer deduction
   */
  async createBatchVouchersWithLedger(params: {
    branch_id: string;
    branch_code: string;
    payment_date: string;
    payment_method: 'Physical_Cash' | 'Online_UPI';
    items: {
      voucher_number: string;
      recipient_name: string;
      category_name: string;
      department_name?: string | null;
      department_code?: string | null;
      bill_number?: string | null;
      amount: number;
      remarks: string;
    }[];
    userName: string;
    userRole: string;
  }): Promise<{ createdVouchers: ExpenseVoucher[]; totalBatchAmount: number; newCashBalance: number }> {
    const { branch_id, branch_code, payment_date, payment_method, items, userName, userRole } = params;

    if (!items || items.length === 0) {
      throw new Error('Batch must contain at least one voucher entry.');
    }

    // 1. Validate All Entries in Batch
    let totalBatchAmount = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.amount || item.amount <= 0) {
        throw new Error(`Row #${i + 1} amount must be greater than zero.`);
      }
      if (!item.voucher_number || !item.voucher_number.trim()) {
        throw new Error(`Row #${i + 1} voucher number is required.`);
      }
      if (!item.recipient_name || !item.recipient_name.trim()) {
        throw new Error(`Row #${i + 1} payee/vendor name is required.`);
      }
      if (!item.category_name || !item.category_name.trim()) {
        throw new Error(`Row #${i + 1} category is required.`);
      }
      totalBatchAmount += item.amount;
    }

    // 2. Period Lock Check
    const isLocked = await this.checkIsPeriodLocked(payment_date);
    if (isLocked && !isPrivilegedAdminRole(userRole)) {
      throw new Error(`Cannot record batch: Accounting period for date ${payment_date} is LOCKED.`);
    }

    // 3. Check Wallet Liquidity & Deduct Consolidated Batch Amount
    // M-10 Security: Apply ₹50,000 approval gate to batch mode.
    // Individual items and batch total are both checked.
    const hasHighValueItem = items.some((i) => i.amount > 50000);
    const batchTotalExceedsGate = totalBatchAmount > 50000;
    if ((hasHighValueItem || batchTotalExceedsGate) && !isPrivilegedAdminRole(userRole)) {
      const reason = hasHighValueItem
        ? `One or more batch items exceed ₹50,000. High-value batch payments require Super Admin or Admin approval.`
        : `Batch total (₹${totalBatchAmount.toLocaleString('en-IN')}) exceeds ₹50,000. Batch requires Super Admin or Admin approval.`;
      throw new Error(reason);
    }

    const currentWallet = await this.getBranchWallet(branch_id);
    const allowNegative = useOverrideStore.getState().isNegativeWalletAllowed();
    let newRunningBalance = 0;

    if (payment_method === 'Physical_Cash') {
      if (currentWallet.cash_balance < totalBatchAmount && !allowNegative) {
        throw new Error(
          `Insufficient Cash Drawer Balance for Batch: Available ₹${currentWallet.cash_balance.toLocaleString('en-IN')}, required batch total ₹${totalBatchAmount.toLocaleString('en-IN')}. Please top up cash float.`
        );
      }
      currentWallet.cash_balance -= totalBatchAmount;
      newRunningBalance = currentWallet.cash_balance;
    } else {
      if (currentWallet.upi_balance < totalBatchAmount && !allowNegative) {
        throw new Error(
          `Insufficient UPI Balance for Batch: Available ₹${currentWallet.upi_balance.toLocaleString('en-IN')}, required batch total ₹${totalBatchAmount.toLocaleString('en-IN')}.`
        );
      }
      currentWallet.upi_balance -= totalBatchAmount;
      newRunningBalance = currentWallet.upi_balance;
    }
    await this.updateBranchWallet(currentWallet);

    // 4. Append Single Consolidated Ledger Entry
    const voucherNumsList = items.map((i) => i.voucher_number).join(', ');
    await this.appendLedgerEntry({
      branch_id,
      branch_code,
      wallet_type: payment_method === 'Physical_Cash' ? 'Cash' : 'UPI',
      transaction_type: 'Expense_Voucher',
      reference_number: `BATCH-${items[0].voucher_number}-${items[items.length - 1].voucher_number}`,
      debit_amount: totalBatchAmount,
      credit_amount: 0,
      running_balance: newRunningBalance,
      remarks: `Rush Mode Batch (${items.length} bills: ${voucherNumsList})`,
      cashier_name: userName,
    });

    // 5. Insert All Individual Voucher Records
    const createdVouchers: ExpenseVoucher[] = [];
    for (const item of items) {
      const vRecord: ExpenseVoucher = {
        id: crypto.randomUUID(),
        voucher_number: item.voucher_number,
        branch_id,
        branch_code,
        payment_date,
        payment_type: 'Shop_Vendor',
        payment_method,
        bank_utr_number: null,
        total_amount: item.amount,
        recipient_name: item.recipient_name,
        category_name: item.category_name,
        department_name: item.department_name || null,
        department_code: item.department_code || null,
        courier_partner_name: null,
        requested_by_staff_code: null,
        requested_by_staff_name: null,
        vendor_splits: null,
        remarks: item.remarks || '',
        bill_number: item.bill_number || null,
        bill_photo_urls: [],
        created_by_name: userName,
        is_high_value: item.amount > 10000,
        status: 'Approved',
        created_at: new Date().toISOString(),
      };

      await this.insertExpenseVoucherRecord(vRecord);
      useVoucherStore.getState().addVoucherLocally(vRecord);
      createdVouchers.push(vRecord);
    }

    // 6. Log Security Event
    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Create_Voucher',
      targetEntity: 'expense_vouchers',
      targetIdentifier: `BATCH-${items.length}-BILLS`,
      eventDescription: `Created ${items.length} batch vouchers totaling ₹${totalBatchAmount} in Rush Mode`,
      justification: 'High-speed counter multi-bill entry',
    });

    useVoucherStore.getState().invalidateVouchers(branch_id);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:vouchers-updated', { detail: { action: 'BATCH_INSERT', count: items.length } }));
      window.dispatchEvent(new Event('asopalav:wallet-updated'));
    }

    return { createdVouchers, totalBatchAmount, newCashBalance: newRunningBalance };
  }

  async voidVoucher(voucher: ExpenseVoucher, reason: string, userName: string, userRole: string, cashReturnedToDrawer: boolean = false) {
    const isPrivileged = isPrivilegedAdminRole(userRole);

    // 1. Auditor is strictly read-only
    if (userRole === 'Auditor') {
      throw new Error('Auditors have read-only access. Voiding vouchers is not permitted.');
    }

    // 2. Cashiers cannot void vouchers
    if (userRole === 'Cashier' && !isPrivileged) {
      throw new Error('Cashiers cannot void vouchers. Please contact your Store Manager or Administrator.');
    }

    // 3. Store Managers can ONLY void TODAY'S vouchers (no past dates)
    const todayStr = new Date().toISOString().slice(0, 10);
    const vDate = (voucher.payment_date || voucher.created_at || '').slice(0, 10);
    const isTodayVoucher = vDate === todayStr;
    if (!isPrivileged && !isTodayVoucher) {
      throw new Error('Past-day vouchers are locked. Store Managers can only void vouchers created during today\'s shift.');
    }
    // H-4 Security: Re-fetch the voucher's TRUE status from DB before refunding wallet.
    // The client-passed voucher.status cannot be trusted — a buggy/malicious client could set it to 'Approved'
    // for a Pending_Approval voucher to trigger an unearned wallet credit.
    let verifiedStatus: ExpenseVoucher['status'] = voucher.status;
    try {
      const { data: liveVoucher } = await supabase
        .from('expense_vouchers')
        .select('status, payment_method, total_amount, branch_id')
        .eq('voucher_number', voucher.voucher_number)
        .maybeSingle();
      if (liveVoucher?.status) {
        verifiedStatus = liveVoucher.status as ExpenseVoucher['status'];
      }
    } catch (e) {
      console.warn('[voidVoucher] Could not re-fetch voucher status from DB, using client-provided status:', e);
    }

    // 1. Update status
    try {
      const { error } = await supabase
        .from('expense_vouchers')
        .update({
          status: 'Voided',
          void_reason: reason,
          voided_by_name: userName,
        })
        .eq('voucher_number', voucher.voucher_number);
      if (error) throw error;
    } catch (e) {
      console.warn('Void status fallback to offline queue:', e);
      useOfflineQueue.getState().enqueueMutation({
        type: 'void_voucher',
        table: 'expense_vouchers',
        action: 'update',
        payload: {
          status: 'Voided',
          void_reason: reason,
          voided_by_name: userName,
        },
        matchField: 'voucher_number',
        matchValue: voucher.voucher_number,
        description: `Void voucher ${voucher.voucher_number}`,
      });
    }

    // 2. ZERO-PHANTOM-CASH RULE: Only refund if created TODAY or physical cash explicitly collected back
    const shouldRefundWallet = verifiedStatus === 'Approved' && (isTodayVoucher || cashReturnedToDrawer);
    if (shouldRefundWallet) {
      const currentWallet = await this.getBranchWallet(voucher.branch_id);
      let newBalance = 0;
      if (voucher.payment_method === 'Physical_Cash') {
        currentWallet.cash_balance += voucher.total_amount;
        newBalance = currentWallet.cash_balance;
      } else {
        currentWallet.upi_balance += voucher.total_amount;
        newBalance = currentWallet.upi_balance;
      }
      await this.updateBranchWallet(currentWallet);

      // 3. Ledger Adjustment
      await this.appendLedgerEntry({
        branch_id: voucher.branch_id,
        branch_code: voucher.branch_code,
        wallet_type: voucher.payment_method === 'Physical_Cash' ? 'Cash' : 'UPI',
        transaction_type: 'Adjustment',
        reference_number: `VOID-${voucher.voucher_number}`,
        debit_amount: 0,
        credit_amount: voucher.total_amount,
        running_balance: newBalance,
        remarks: isTodayVoucher ? `VOID REVERSAL: ${reason}` : `PAST-DAY VOID REFUND (PHYSICAL CASH RETURNED): ${reason}`,
        cashier_name: userName,
      });
    }

    // 4. Audit Log
    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Void_Voucher',
      targetEntity: 'expense_vouchers',
      targetIdentifier: voucher.voucher_number,
      eventDescription: shouldRefundWallet ? `Voided voucher ${voucher.voucher_number} (₹${voucher.total_amount}). Funds refunded to ${voucher.payment_method} wallet.` : `Voided past-day voucher ${voucher.voucher_number} dated ${vDate} (₹${voucher.total_amount}). Accounting cancellation only — today's drawer float was NOT altered to prevent phantom cash discrepancy.`,
      justification: reason,
    });

    const voidedVoucher: ExpenseVoucher = {
      ...voucher,
      status: 'Voided',
      void_reason: reason,
      voided_by_name: userName,
    };
    useVoucherStore.getState().updateVoucherLocally(voidedVoucher);
    useVoucherStore.getState().invalidateVouchers(voucher.branch_id);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:vouchers-updated', { detail: { action: 'UPDATE', voucher: voidedVoucher } }));
      window.dispatchEvent(new Event('asopalav:wallet-updated'));
    }
  }

  async updateVoucher(
    voucherNumber: string,
    updates: Partial<ExpenseVoucher>,
    userName: string,
    userRole: string,
    reason: string,

    splits?: { staffCode: string; staffName: string; departmentName?: string; categoryName?: string; amount: number }[]
  ) {
    this.invalidateVoucherSplits(voucherNumber);
    const isPrivileged = isPrivilegedAdminRole(userRole);

    // 1. Auditor is strictly read-only: zero modifications allowed
    if (userRole === 'Auditor') {
      throw new Error('Auditors have read-only access. Voucher modifications are not permitted.');
    }

    // 2. Pre-fetch original voucher to verify shift date
    let existingVoucher: ExpenseVoucher | null = null;
    try {
      const { data } = await supabase
        .from('expense_vouchers')
        .select('*')
        .eq('voucher_number', voucherNumber)
        .maybeSingle();
      if (data) existingVoucher = data as ExpenseVoucher;
    } catch {
      // fallback
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const voucherDate = (existingVoucher?.payment_date || existingVoucher?.created_at || '').slice(0, 10);
    const isTodayVoucher = voucherDate === todayStr;

    // 3. Date check: Store Managers & Cashiers can ONLY edit TODAY'S vouchers
    if (!isPrivileged && !isTodayVoucher) {
      throw new Error('Past-day vouchers are locked. Store Managers and Cashiers can only edit vouchers created during today\'s shift.');
    }

    const ALLOWED_UPDATE_FIELDS: (keyof ExpenseVoucher)[] = [
      'payment_type',
      'payment_method',
      'bank_utr_number',
      'recipient_name',
      'category_name',
      'department_name',
      'department_code',
      'courier_partner_name',
      'requested_by_staff_code',
      'requested_by_staff_name',
      'bill_number',
      'bill_photo_urls',
      'remarks',
      'vendor_splits',
    ];

    // Only Super Admin / Developer can alter payment_date
    if (isPrivileged) {
      ALLOWED_UPDATE_FIELDS.push('payment_date');
    }

    const isCashier = userRole === 'Cashier' || userRole?.toLowerCase() === 'cashier' || userRole === 'Showroom_Cashier';
    const isManagerOrAdmin = isPrivileged || userRole === 'Store_Manager' || userRole?.toLowerCase() === 'store_manager';

    // Solution 2: Prevent Cashier Amount Tampering
    if (isCashier && updates.total_amount !== undefined && existingVoucher) {
      const oldAmt = Number(existingVoucher.total_amount) || 0;
      const newAmt = Number(updates.total_amount) || 0;
      if (Math.abs(oldAmt - newAmt) > 0.001) {
        throw new Error('Cashiers cannot modify voucher amounts. Adjusting payout amounts requires Store Manager or Administrator authorization.');
      }
    }

    // Only Store Manager and Super Admin can adjust total_amount (prevents cashier amount tampering)
    if (isManagerOrAdmin && (isPrivileged || isTodayVoucher)) {
      ALLOWED_UPDATE_FIELDS.push('total_amount');
    }

    const sanitizedUpdates: Record<string, any> = {};
    const blockedFields: string[] = [];

    for (const key of Object.keys(updates) as (keyof ExpenseVoucher)[]) {
      if (ALLOWED_UPDATE_FIELDS.includes(key)) {
        sanitizedUpdates[key] = updates[key];
      } else {
        blockedFields.push(key);
      }
    }

    if (blockedFields.length > 0) {
      console.warn(`[updateVoucher] Blocked attempt to update restricted fields: ${blockedFields.join(', ')}.`);
    }

    // Fallback if not fetched in pre-check
    if (!existingVoucher) {
      try {
        const { data } = await supabase
          .from('expense_vouchers')
          .select('*')
          .eq('voucher_number', voucherNumber)
          .maybeSingle();
        if (data) {
          existingVoucher = data;
        }
      } catch (e) {
        console.warn('Failed to query existing voucher from DB:', e);
      }
    }

    if (!existingVoucher) {
      const storeVouchers = useVoucherStore.getState().vouchers;
      for (const list of Object.values(storeVouchers)) {
        const found = list.find((v) => v.voucher_number === voucherNumber);
        if (found) {
          existingVoucher = found;
          break;
        }
      }
    }

    // 1B. Handle Multi-Staff Splits Update
    if (splits && splits.length > 0) {
      const uniqueCategories = Array.from(new Set(splits.map((s) => s.categoryName?.trim()).filter(Boolean)));
      const uniqueDepartments = Array.from(new Set(splits.map((s) => s.departmentName?.trim()).filter(Boolean)));
      const splitTotal = splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

      sanitizedUpdates.total_amount = splitTotal;
      sanitizedUpdates.category_name =
        uniqueCategories.length === 1
          ? uniqueCategories[0]
          : uniqueCategories.length > 1
          ? uniqueCategories.join(', ')
          : (sanitizedUpdates.category_name || existingVoucher?.category_name || '');
      sanitizedUpdates.department_name =
        uniqueDepartments.length === 1
          ? uniqueDepartments[0]
          : uniqueDepartments.length > 1
          ? uniqueDepartments.join(', ')
          : (sanitizedUpdates.department_name || existingVoucher?.department_name || '');
      sanitizedUpdates.recipient_name =
        splits.length === 1
          ? splits[0].staffName
          : `${splits.length} Staff (${splits.map((s) => s.staffName.split(' ')[0]).join(', ')})`;

      const { error: delSplitErr } = await supabase.from('voucher_splits').delete().eq('voucher_number', voucherNumber);
      if (delSplitErr) {
        throw new Error(`Failed to update voucher splits in database: ${delSplitErr.message}`);
      }
      const splitRecords = splits.map((s) => ({
        id: crypto.randomUUID(),
        voucher_number: voucherNumber,
        branch_id: existingVoucher?.branch_id || 'Aellp-ASI',
        branch_code: existingVoucher?.branch_code || 'ASI',
        staff_code: s.staffCode,
        staff_name: s.staffName,
        department_name: s.departmentName?.trim() || null,
        category_name: s.categoryName?.trim() || null,
        amount: s.amount,
        created_at: new Date().toISOString(),
      }));
      const { error: insSplitErr } = await supabase.from('voucher_splits').insert(splitRecords);
      if (insSplitErr) {
        throw new Error(`Failed to save updated voucher splits in database: ${insSplitErr.message}`);
      }
    } else if (Array.isArray(splits) && splits.length === 0) {
      const { error: clrSplitErr } = await supabase.from('voucher_splits').delete().eq('voucher_number', voucherNumber);
      if (clrSplitErr) {
        throw new Error(`Failed to clear voucher splits in database: ${clrSplitErr.message}`);
      }
    }

    // 1C. Handle Multi-Vendor Splits Update (only for non-Staff_Split vouchers)
    const effectivePaymentType = sanitizedUpdates.payment_type || existingVoucher?.payment_type;
    if (effectivePaymentType === 'Staff_Split') {
      sanitizedUpdates.vendor_splits = null;
    } else if (sanitizedUpdates.vendor_splits && Array.isArray(sanitizedUpdates.vendor_splits) && sanitizedUpdates.vendor_splits.length > 0) {
      const vSplits = sanitizedUpdates.vendor_splits;
      const uniqueCategories = Array.from(new Set(vSplits.map((v: any) => v.category_name?.trim()).filter(Boolean)));
      const uniqueDepartments = Array.from(new Set(vSplits.map((v: any) => v.department_name?.trim()).filter(Boolean)));
      const vendorTotal = vSplits.reduce((sum: number, v: any) => sum + (Number(v.amount) || 0), 0);

      sanitizedUpdates.total_amount = vendorTotal;
      sanitizedUpdates.category_name =
        uniqueCategories.length === 1
          ? uniqueCategories[0]
          : uniqueCategories.length > 1
          ? uniqueCategories.join(', ')
          : (sanitizedUpdates.category_name || existingVoucher?.category_name || '');
      sanitizedUpdates.department_name =
        uniqueDepartments.length === 1
          ? uniqueDepartments[0]
          : uniqueDepartments.length > 1
          ? uniqueDepartments.join(', ')
          : (sanitizedUpdates.department_name || existingVoucher?.department_name || '');
      sanitizedUpdates.recipient_name =
        vSplits.length === 1
          ? vSplits[0].vendor_name
          : `${vSplits.length} Vendors (${vSplits.map((v: any) => v.vendor_name.split(' ')[0]).join(', ')})`;
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      throw new Error('No valid fields to update.');
    }

    // 2. Update Voucher in Database
    const { error: voucherUpdateErr } = await supabase
      .from('expense_vouchers')
      .update(sanitizedUpdates)
      .eq('voucher_number', voucherNumber);
    if (voucherUpdateErr) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        useOfflineQueue.getState().enqueueMutation({
          type: 'update_voucher',
          table: 'expense_vouchers',
          action: 'update',
          payload: sanitizedUpdates,
          matchField: 'voucher_number',
          matchValue: voucherNumber,
          description: `Update voucher ${voucherNumber}`,
        });
      } else {
        throw new Error(`Failed to update voucher in database: ${voucherUpdateErr.message}`);
      }
    }

    // 3. Double-Entry Ledger & Wallet Balance Reconciliation (only for Approved, wallet-impacting vouchers)
    if (
      existingVoucher &&
      (existingVoucher.status === 'Approved' || !existingVoucher.status) &&
      existingVoucher.payment_type !== 'Advance_Settlement'
    ) {
      const oldPaymentMethod = existingVoucher.payment_method || 'Physical_Cash';
      const newPaymentMethod = (sanitizedUpdates.payment_method || oldPaymentMethod) as 'Physical_Cash' | 'Online_UPI';
      const oldWalletType: 'Cash' | 'UPI' = oldPaymentMethod === 'Physical_Cash' ? 'Cash' : 'UPI';
      const newWalletType: 'Cash' | 'UPI' = newPaymentMethod === 'Physical_Cash' ? 'Cash' : 'UPI';
      const oldAmount = Number(existingVoucher.total_amount) || 0;
      const newAmount = sanitizedUpdates.total_amount !== undefined ? Number(sanitizedUpdates.total_amount) : oldAmount;
      const branchId = existingVoucher.branch_id || 'Aellp-ASI';
      const categoryName = sanitizedUpdates.category_name || existingVoucher.category_name;
      const recipientName = sanitizedUpdates.recipient_name || existingVoucher.recipient_name;
      const remarks = sanitizedUpdates.remarks !== undefined ? sanitizedUpdates.remarks : existingVoucher.remarks;
      const formattedRemarks = remarks ? `Expense: ${categoryName} - ${recipientName} (${remarks})` : `Expense: ${categoryName} - ${recipientName}`;

      const isPaymentMethodChanged = oldWalletType !== newWalletType;
      const isAmountChanged = oldAmount !== newAmount;

      if (isPaymentMethodChanged || isAmountChanged || sanitizedUpdates.category_name || sanitizedUpdates.recipient_name || sanitizedUpdates.remarks !== undefined) {
        // A. Update Supabase wallet_ledger record
        const { error: ledgerUpdateError } = await supabase
          .from('wallet_ledger')
          .update({
            wallet_type: newWalletType,
            debit_amount: newAmount,
            remarks: formattedRemarks,
          })
          .eq('reference_number', voucherNumber);
        if (ledgerUpdateError) {
          console.warn('Supabase ledger update warning:', ledgerUpdateError);
        }

        // B. Update localStorage ledger caches
        const canonicalId = normalizeBranchId(branchId);
        const code = normalizeBranchCode(branchId);
        const keysToCheck = [
          `asopalav_ledger_${canonicalId}`,
          `asopalav_ledger_${code}`,
          `asopalav_ledger_${branchId}`,
          'asopalav_ledger_ALL',
          'asopalav_ledger_Aellp-ASI',
          'asopalav_ledger_ASI',
        ];

        keysToCheck.forEach((key) => {
          const raw = localStorage.getItem(key);
          if (raw) {
            try {
              const list = JSON.parse(raw);
              if (Array.isArray(list)) {
                const updatedList = list.map((item: any) => {
                  if (item.reference_number === voucherNumber) {
                    return {
                      ...item,
                      wallet_type: newWalletType,
                      debit_amount: newAmount,
                      remarks: formattedRemarks,
                    };
                  }
                  return item;
                });
                localStorage.setItem(key, JSON.stringify(updatedList.slice(0, 200)));
              }
            } catch {
              // ignore
            }
          }
        });

        // C. Recalculate branch wallet balances with zero-rupee tolerance
        await this.recalculateBranchWalletFromLedger(branchId);
        useBranchStore.getState().fetchBranchesAndWallets(true);
      }
    }

    // 4. Update Voucher Store Locally & Dispatch Events
    const updatedVoucher = {
      ...(existingVoucher || {}),
      ...sanitizedUpdates,
      voucher_number: voucherNumber,
    } as ExpenseVoucher;

    useVoucherStore.getState().updateVoucherLocally(updatedVoucher);
    useVoucherStore.getState().invalidateVouchers(existingVoucher?.branch_id);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Approve_Voucher',
      targetEntity: 'expense_vouchers',
      targetIdentifier: voucherNumber,
      eventDescription: (existingVoucher && sanitizedUpdates.total_amount !== undefined && Number(existingVoucher.total_amount) !== Number(sanitizedUpdates.total_amount)) ? `AMOUNT CHANGED on voucher ${voucherNumber}: ₹${existingVoucher?.total_amount} -> ₹${sanitizedUpdates.total_amount} by ${userRole} ${userName}. Updated: ${Object.keys(sanitizedUpdates).join(', ')}` : `Modified voucher ${voucherNumber}: ${Object.keys(sanitizedUpdates).join(', ')}${blockedFields.length > 0 ? ` [BLOCKED: ${blockedFields.join(', ')}]` : ''}`,
      justification: reason || 'Admin voucher correction',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('asopalav:vouchers-updated', {
          detail: { action: 'UPDATE', voucherNumber, updates: sanitizedUpdates, voucher: updatedVoucher },
        })
      );
      window.dispatchEvent(new Event('asopalav:wallet-updated'));
      window.dispatchEvent(new Event('asopalav:ledger-updated'));
    }
  }

  async deleteVoucher(
    voucher: ExpenseVoucher,
    userName: string,
    userRole: string,
    reason: string,
    cashReturnedToDrawer: boolean = false
  ) {
    this.invalidateVoucherSplits(voucher.voucher_number);
    const todayStr = new Date().toISOString().slice(0, 10);
    const vDate = (voucher.payment_date || voucher.created_at || '').slice(0, 10);
    const isTodayVoucher = vDate === todayStr;
    const shouldRefundWallet = voucher.status === 'Approved' && (isTodayVoucher || cashReturnedToDrawer);
    // 1. ZERO-PHANTOM-CASH RULE: Refund wallet only if today or cash was returned to drawer
    if (shouldRefundWallet) {
      const currentWallet = await this.getBranchWallet(voucher.branch_id);
      let newBalance = 0;
      if (voucher.payment_method === 'Physical_Cash') {
        currentWallet.cash_balance += voucher.total_amount;
        newBalance = currentWallet.cash_balance;
      } else {
        currentWallet.upi_balance += voucher.total_amount;
        newBalance = currentWallet.upi_balance;
      }
      await this.updateBranchWallet(currentWallet);

      await this.appendLedgerEntry({
        branch_id: voucher.branch_id,
        branch_code: voucher.branch_code,
        wallet_type: voucher.payment_method === 'Physical_Cash' ? 'Cash' : 'UPI',
        transaction_type: 'Adjustment',
        reference_number: `PURGE-${voucher.voucher_number}`,
        debit_amount: 0,
        credit_amount: voucher.total_amount,
        running_balance: newBalance,
        remarks: isTodayVoucher ? `SUPERADMIN PURGE: ${reason}` : `PAST-DAY PURGE REFUND (PHYSICAL CASH RETURNED): ${reason}`,
        cashier_name: userName,
      });
    }

    // 2. Audit Rule: Instead of hard-deleting, mark as Voided/Reversed to preserve permanent audit proof
    try {
      const { error } = await supabase
        .from('expense_vouchers')
        .update({
          status: 'Voided',
          void_reason: `REVERSED: ${reason}`,
          voided_by_name: userName,
        })
        .eq('voucher_number', voucher.voucher_number);
      if (error) throw error;
    } catch (e) {
      console.warn('Voucher void fallback to offline queue:', e);
      useOfflineQueue.getState().enqueueMutation({
        type: 'void_voucher',
        table: 'expense_vouchers',
        action: 'update',
        payload: {
          status: 'Voided',
          void_reason: `REVERSED: ${reason}`,
          voided_by_name: userName,
        },
        matchField: 'voucher_number',
        matchValue: voucher.voucher_number,
        description: `Reverse voucher ${voucher.voucher_number}`,
      });
    }

    // 3. Security Audit Log
    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Delete_Voucher',
      targetEntity: 'expense_vouchers',
      targetIdentifier: voucher.voucher_number,
      eventDescription: shouldRefundWallet ? `Permanently deleted voucher ${voucher.voucher_number} (₹${voucher.total_amount}). Funds refunded to ${voucher.payment_method} wallet.` : `Permanently deleted past-day voucher ${voucher.voucher_number} (₹${voucher.total_amount}). [ZERO-PHANTOM-CASH: Drawer float unchanged, accounting cancellation only].`,
      justification: reason || 'Super Admin record purge',
    });

    useVoucherStore.getState().removeVoucherLocally(voucher.voucher_number, voucher.branch_id);
    useVoucherStore.getState().invalidateVouchers(voucher.branch_id);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:vouchers-updated', { detail: { action: 'DELETE', voucher } }));
      window.dispatchEvent(new Event('asopalav:wallet-updated'));
    }
  }

  // --------------------------------------------------------------------------
  // 4. FLOAT ALLOCATIONS (HEAD OFFICE CASH INJECTIONS)
  // --------------------------------------------------------------------------
  async createFloatTopup(params: FloatTopupParams): Promise<FloatAllocation> {
    if (!params.amount || params.amount <= 0) {
      throw new Error('Float top-up amount must be a positive number greater than zero.');
    }
    const allocNumber = `FLT-${Date.now().toString().slice(-6)}`;
    const recordTimestamp = params.createdAt ? new Date(params.createdAt).toISOString() : new Date().toISOString();
    const fullAllocation: FloatAllocation = {
      id: crypto.randomUUID(),
      allocation_number: allocNumber,
      branch_id: params.branchId,
      branch_code: params.branchCode,
      wallet_type: params.walletType,
      amount: params.amount,
      reference_notes: params.referenceNotes || 'Head Office Imprest Inflow',
      authorized_by_name: params.authorizedByName,
      received_by_name: params.receivedByName,
      status: 'Verified',
      created_at: recordTimestamp,
    };

    // 1. Credit Branch Wallet
    const currentWallet = await this.getBranchWallet(params.branchId);
    let newBalance = 0;
    if (params.walletType === 'Cash') {
      currentWallet.cash_balance += params.amount;
      newBalance = currentWallet.cash_balance;
    } else {
      currentWallet.upi_balance += params.amount;
      newBalance = currentWallet.upi_balance;
    }
    await this.updateBranchWallet(currentWallet);

    // 2. Record Ledger
    await this.appendLedgerEntry({
      branch_id: params.branchId,
      branch_code: params.branchCode,
      wallet_type: params.walletType,
      transaction_type: 'Float_Topup',
      reference_number: allocNumber,
      debit_amount: 0,
      credit_amount: params.amount,
      running_balance: newBalance,
      remarks: params.referenceNotes || 'Head office cash drawer injection',
      cashier_name: params.receivedByName,
      created_at: recordTimestamp,
    });

    // 3. Insert Float Record
    try {
      const { error } = await supabase.from('float_allocations').insert([fullAllocation]);
      if (error) throw error;
    } catch (e) {
      console.warn('Float allocation insert fallback to offline queue:', e);
      useOfflineQueue.getState().enqueueMutation({
        type: 'float_topup',
        table: 'float_allocations',
        action: 'insert',
        payload: fullAllocation,
        description: `Float injection ${allocNumber}`,
      });
    }

    // 4. Audit Log
    await logSecurityEvent({
      userName: params.receivedByName,
      userRole: 'Cashier',
      actionType: 'Float_Topup',
      targetEntity: 'float_allocations',
      targetIdentifier: allocNumber,
      eventDescription: `Injected ₹${params.amount} ${params.walletType} Float into Showroom ${params.branchCode}`,
      justification: params.referenceNotes || 'Daily till float replenishment',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:ledger-updated'));
      window.dispatchEvent(new Event('asopalav:wallet-updated'));
    }

    return fullAllocation;
  }

  /**
   * Update an existing Cash or UPI Float Top-up (Store Manager can only edit TODAY'S entries).
   * Automatically reconciles the ledger, updates wallet cash balance, and logs immutable audit.
   */
  async updateFloatTopup(params: {
    allocationNumber: string;
    newAmount: number;
    referenceNotes?: string;
    reason: string;
    userName: string;
    userRole: string;
    branchId: string;
  }): Promise<void> {
    const isPrivileged = isPrivilegedAdminRole(params.userRole);
    if (params.userRole === 'Auditor') {
      throw new Error('Auditors have read-only access. Modifying cash entries is not permitted.');
    }

    if (!params.newAmount || params.newAmount <= 0) {
      throw new Error('Amount must be a positive number greater than zero.');
    }

    if (!params.reason || params.reason.trim().length < 3) {
      throw new Error('Modification reason is mandatory (minimum 3 characters).');
    }

    // 1. Fetch current float allocation record
    const { data: floatRec, error: fErr } = await supabase
      .from('float_allocations')
      .select('*')
      .eq('allocation_number', params.allocationNumber)
      .maybeSingle();

    if (fErr || !floatRec) {
      throw new Error(`Float top-up #${params.allocationNumber} not found.`);
    }

    // Check date: Store Managers can ONLY edit TODAY'S entries
    const todayStr = new Date().toISOString().slice(0, 10);
    const floatDate = (floatRec.created_at || '').slice(0, 10);
    if (!isPrivileged && floatDate !== todayStr) {
      throw new Error('Past-day cash entries are locked. Store Managers can only edit cash entries recorded during today\'s shift.');
    }

    const oldAmount = Number(floatRec.amount) || 0;
    const diff = params.newAmount - oldAmount;
    const notes = params.referenceNotes !== undefined ? params.referenceNotes.trim() : floatRec.reference_notes;

    // 2. Update float_allocations table
    const { error: fUpdateErr } = await supabase
      .from('float_allocations')
      .update({
        amount: params.newAmount,
        reference_notes: notes,
      })
      .eq('allocation_number', params.allocationNumber);

    if (fUpdateErr) {
      throw new Error(`Failed to update cash allocation: ${fUpdateErr.message}`);
    }

    // 3. Update wallet_ledger table
    const { error: lUpdateErr } = await supabase
      .from('wallet_ledger')
      .update({
        credit_amount: params.newAmount,
        remarks: notes,
      })
      .eq('reference_number', params.allocationNumber);

    if (lUpdateErr) {
      console.warn('Ledger float update notice:', lUpdateErr);
    }

    // 4. Update branch_wallets cash balance
    const wallet = await this.getBranchWallet(params.branchId);
    if (floatRec.wallet_type === 'Cash') {
      wallet.cash_balance += diff;
    } else {
      wallet.upi_balance += diff;
    }
    await this.updateBranchWallet(wallet);

    // 5. Audit Log
    await logSecurityEvent({
      userName: params.userName,
      userRole: params.userRole,
      actionType: 'Float_Topup',
      targetEntity: 'float_allocations',
      targetIdentifier: params.allocationNumber,
      eventDescription: `Updated Float Top-up ${params.allocationNumber}: ${floatRec.wallet_type} amount changed from ₹${oldAmount} to ₹${params.newAmount}`,
      justification: params.reason,
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:ledger-updated'));
      window.dispatchEvent(new Event('asopalav:wallet-updated'));
    }
  }

  async recordSafeDrop(params: SafeDropParams): Promise<{ dropNumber: string; newCashBalance: number }> {
    if (!params.amount || params.amount <= 0) {
      throw new Error('Safe drop amount must be a positive number greater than zero.');
    }

    // 1. Try atomic PostgreSQL RPC
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('create_safe_drop_atomic', {
        p_branch_id: params.branchId,
        p_branch_code: params.branchCode,
        p_amount: params.amount,
        p_dropped_by: params.transferredByName,
        p_witnessed_by: params.verifiedByName || null,
        p_remarks: params.reason || null,
      });

      if (!rpcError && rpcData) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('asopalav:ledger-updated'));
          window.dispatchEvent(new Event('asopalav:wallet-updated'));
        }
        return {
          dropNumber: rpcData.drop_number,
          newCashBalance: Number(rpcData.new_cash_balance) || 0,
        };
      }
    } catch (rpcEx) {
      console.warn('Atomic safe drop RPC fallback to client workflow:', rpcEx);
    }

    // 2. Resilient Client Fallback
    const currentWallet = await this.getBranchWallet(params.branchId);
    if (currentWallet.cash_balance < params.amount) {
      throw new Error(
        `Insufficient cash in drawer (₹${currentWallet.cash_balance.toLocaleString('en-IN')}) for a safe drop of ₹${params.amount.toLocaleString('en-IN')}.`
      );
    }

    currentWallet.cash_balance -= params.amount;
    await this.updateBranchWallet(currentWallet);

    const dropNumber = `SD-${Date.now().toString().slice(-6)}`;

    await this.appendLedgerEntry({
      branch_id: params.branchId,
      branch_code: params.branchCode,
      wallet_type: 'Cash',
      transaction_type: 'Safe_Drop',
      reference_number: dropNumber,
      debit_amount: params.amount,
      credit_amount: 0,
      running_balance: currentWallet.cash_balance,
      remarks: params.reason || 'Safe Drop: Transferred excess cash from till to showroom vault',
      cashier_name: params.transferredByName,
      authorized_by_name: params.verifiedByName,
    });

    await logSecurityEvent({
      userName: params.transferredByName,
      userRole: 'Cashier',
      actionType: 'Safe_Drop',
      targetEntity: 'branch_wallets',
      targetIdentifier: dropNumber,
      eventDescription: `Transferred ₹${params.amount} excess cash from till to showroom safe. New till balance: ₹${currentWallet.cash_balance}.`,
      justification: params.reason || 'Excess cash safe drop above threshold',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:ledger-updated'));
      window.dispatchEvent(new Event('asopalav:wallet-updated'));
    }

    return { dropNumber, newCashBalance: currentWallet.cash_balance };
  }

  // --------------------------------------------------------------------------
  // 5. STAFF ADVANCES & TOUCH SIGNATURES
  // --------------------------------------------------------------------------
  async getStaffAdvances(branchId?: string): Promise<StaffAdvance[]> {
    const code = normalizeBranchCode(branchId);
    const isAll = !branchId || branchId === 'ALL' || code === 'ALL';
    const canonicalId = isAll ? 'ALL' : normalizeBranchId(branchId);

    // 1. Fetch from direct staff_advances table
    let directAdvances: StaffAdvance[] = [];
    try {
      let query = supabase
        .from('staff_advances')
        .select('*')
        .order('created_at', { ascending: false });

      if (!isAll) {
        query = query.or(`branch_id.eq.${canonicalId},branch_id.eq.${code},branch_code.eq.${code}`);
      }

      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        directAdvances = data;
      }
    } catch (e) {
      console.warn('Direct advances fetch warning:', e);
    }

    // 2. Fetch bridged salary advances from expense_vouchers (Cashier / Manager F2 Advance Salary workflow)
    let bridgedAdvances: StaffAdvance[] = [];
    try {
      let vQuery = supabase
        .from('expense_vouchers')
        .select('*')
        .in('category_name', ['Advance Salary', 'Staff Adv for Exps'])
        .neq('status', 'Voided')
        .order('created_at', { ascending: false });

      if (!isAll) {
        vQuery = vQuery.or(`branch_id.eq.${canonicalId},branch_code.eq.${code}`);
      }

      const { data: vData, error: vError } = await vQuery;
      if (!vError && Array.isArray(vData)) {
        bridgedAdvances = vData.map((v: any) => {
          const staffName = v.paid_to || v.recipient_name || 'Staff Member';
          const staffCode = `EMP-${staffName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)}`;
          const amt = Number(v.amount) || Number(v.total_amount) || 0;
          const advanceDate = v.payment_date || (v.created_at ? v.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10));

          let monthStr = 'Current Month';
          try {
            monthStr = format(new Date(advanceDate), 'MMMM yyyy');
          } catch {}

          return {
            id: `v-adv-${v.id || v.voucher_number}`,
            receipt_number: v.voucher_number,
            advance_date: advanceDate,
            branch_id: v.branch_id || normalizeBranchId(v.branch_code) || 'Aellp-ASI',
            branch_code: normalizeBranchCode(v.branch_code) || 'ASI',
            staff_code: staffCode,
            staff_name: staffName,
            department_name: v.department_name || 'General Operations',
            designation: 'Staff',
            payment_method: (v.payment_mode === 'UPI' || v.payment_method === 'Online_UPI') ? 'Online_UPI' : 'Physical_Cash',
            bank_utr_number: v.bank_ref_number || null,
            advance_amount: amt,
            purpose: v.description || v.remarks || `Advance Salary (Recorded via F2 Add Expense)`,
            signature_image_url: '',
            bills_submitted_amount: 0,
            cash_returned_amount: 0,
            unsettled_balance: amt,
            settlement_proofs: [],
            disbursed_by_name: v.created_by_name || 'Store Cashier',
            status: 'Active_Unsettled' as const,
            salary_deduction_month: monthStr,
            created_at: v.created_at || `${advanceDate}T12:00:00Z`,
            is_direct_voucher_advance: true,
            source_category: v.category_name,
          };
        });
      }
    } catch (err) {
      console.warn('Bridged salary advances fetch warning:', err);
    }

    // 3. Merge: prefer direct staff_advances if receipt_number already exists, otherwise add bridged advance
    const directReceipts = new Set(directAdvances.map((a) => a.receipt_number));
    const mergedList: StaffAdvance[] = [...directAdvances];

    // Load any local override status for bridged advances
    let localOverrides: Record<string, Partial<StaffAdvance>> = {};
    try {
      const stored = localStorage.getItem('asopalav_advance_status_overrides');
      if (stored) localOverrides = JSON.parse(stored);
    } catch {}

    bridgedAdvances.forEach((bridged) => {
      if (!directReceipts.has(bridged.receipt_number)) {
        const override = localOverrides[bridged.receipt_number];
        if (override) {
          mergedList.push({ ...bridged, ...override });
        } else {
          mergedList.push(bridged);
        }
      }
    });

    if (mergedList.length > 0) {
      mergedList.sort((a, b) => b.advance_date.localeCompare(a.advance_date));
      try {
        localStorage.setItem(`asopalav_advances_${canonicalId}`, JSON.stringify(mergedList.slice(0, 200)));
      } catch {}
      return mergedList;
    }

    // 4. Local storage fallback if offline
    const keysToCheck = isAll
      ? ['asopalav_advances_ALL', 'asopalav_advances_Aellp-ASI', 'asopalav_advances_ASI', 'asopalav_advances_CG', 'asopalav_advances_NAV', 'asopalav_advances_SUR']
      : [`asopalav_advances_${canonicalId}`, `asopalav_advances_${code}`, `asopalav_advances_${branchId}`, 'asopalav_advances_ALL', 'asopalav_advances_Aellp-ASI'];

    for (const key of keysToCheck) {
      const local = localStorage.getItem(key);
      if (local) {
        try {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed) && parsed.length > 0) {
            if (isAll) return parsed;
            const filtered = parsed.filter(
              (a: any) =>
                normalizeBranchCode(a.branch_code) === code ||
                normalizeBranchCode(a.branch_id) === code ||
                normalizeBranchId(a.branch_id) === canonicalId
            );
            if (filtered.length > 0) return filtered;
          }
        } catch {}
      }
    }

    return [];
  }

  async disburseStaffAdvance(params: DisburseAdvanceParams): Promise<StaffAdvance> {
    const { advance, userName, userRole } = params;
    if (!advance.advance_amount || advance.advance_amount <= 0) {
      throw new Error('Advance amount must be a positive number greater than zero.');
    }
    if (advance.advance_amount > 10000000) {
      throw new Error('Advance amount exceeds maximum allowed limit of ₹1,00,00,000.');
    }

    const fullAdvance: StaffAdvance = {
      ...params.advance,
      id: crypto.randomUUID(),
      bills_submitted_amount: 0,
      cash_returned_amount: 0,
      unsettled_balance: params.advance.advance_amount,
      settlement_proofs: [],
      status: 'Active_Unsettled',
      created_at: new Date().toISOString(),
    };

    // 0. Primary Database Atomic RPC (Zero Race Conditions, Single Round-Trip)
    try {
      const allowNegative = useOverrideStore.getState().isNegativeWalletAllowed();
      const { data: atomicData, error: rpcError } = await supabase.rpc('disburse_staff_advance_atomic', {
        p_advance: fullAdvance,
        p_user_name: userName,
        p_user_role: userRole,
        p_allow_negative: allowNegative,
      });

      if (!rpcError && atomicData) {
        const atomicAdvance = atomicData as StaffAdvance;
        const existing = await this.getStaffAdvances(params.advance.branch_id);
        localStorage.setItem(
          `asopalav_advances_${params.advance.branch_id}`,
          JSON.stringify([atomicAdvance, ...existing])
        );

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('asopalav:advances-updated'));
          window.dispatchEvent(new Event('asopalav:wallet-updated'));
        }
        return atomicAdvance;
      }

      if (rpcError) {
        if (rpcError.message && !rpcError.message.includes('function') && !rpcError.message.includes('not exist') && !rpcError.message.includes('PGRST202')) {
          throw new Error(rpcError.message);
        }
      }
    } catch (rpcEx: any) {
      if (rpcEx?.message && !rpcEx.message.includes('function') && !rpcEx.message.includes('not exist') && !rpcEx.message.includes('PGRST202')) {
        throw rpcEx;
      }
    }

    // 1. Deduct from Branch Wallet with Liquidity Guard (or SuperAdmin Overdraft Override)
    const currentWallet = await this.getBranchWallet(params.advance.branch_id);
    const allowNegative = useOverrideStore.getState().isNegativeWalletAllowed();
    let newBalance = 0;
    if (params.advance.payment_method === 'Physical_Cash') {
      if (currentWallet.cash_balance < params.advance.advance_amount && !allowNegative) {
        throw new Error(
          `Insufficient Cash Drawer Balance: Available till balance is ₹${currentWallet.cash_balance.toLocaleString('en-IN')}, but advance requires ₹${params.advance.advance_amount.toLocaleString('en-IN')}. Please top up cash float before issuing advance.`
        );
      }
      currentWallet.cash_balance = currentWallet.cash_balance - params.advance.advance_amount;
      newBalance = currentWallet.cash_balance;
    } else {
      if (currentWallet.upi_balance < params.advance.advance_amount && !allowNegative) {
        throw new Error(
          `Insufficient Online/UPI Wallet Balance: Available UPI balance is ₹${currentWallet.upi_balance.toLocaleString('en-IN')}, but advance requires ₹${params.advance.advance_amount.toLocaleString('en-IN')}. Please top up account balance before issuing advance.`
        );
      }
      currentWallet.upi_balance = currentWallet.upi_balance - params.advance.advance_amount;
      newBalance = currentWallet.upi_balance;
    }
    await this.updateBranchWallet(currentWallet);

    const advanceRemarks = `Staff Advance to ${params.advance.staff_name} for ${params.advance.purpose}`;

    // 2. Record Ledger
    await this.appendLedgerEntry({
      branch_id: params.advance.branch_id,
      branch_code: params.advance.branch_code,
      wallet_type: params.advance.payment_method === 'Physical_Cash' ? 'Cash' : 'UPI',
      transaction_type: 'Advance_Out',
      reference_number: params.advance.receipt_number,
      debit_amount: params.advance.advance_amount,
      credit_amount: 0,
      running_balance: newBalance,
      remarks: advanceRemarks,
      cashier_name: params.userName,
    });

    // 3. Save to storage & DB
    const existing = await this.getStaffAdvances(params.advance.branch_id);
    localStorage.setItem(
      `asopalav_advances_${params.advance.branch_id}`,
      JSON.stringify([fullAdvance, ...existing])
    );

    const { error: advInsertError } = await supabase.from('staff_advances').insert([fullAdvance]);
    if (advInsertError) {
      console.error('Advance insert error:', advInsertError);
      throw new Error(advInsertError.message || 'Failed to save staff advance in database.');
    }

    // 4. Audit Log
    await logSecurityEvent({
      userName: params.userName,
      userRole: params.userRole,
      actionType: 'Disburse_Advance',
      targetEntity: 'staff_advances',
      targetIdentifier: params.advance.receipt_number,
      eventDescription: `Given advance ₹${params.advance.advance_amount} to ${params.advance.staff_name} (${params.advance.staff_code}) with signature`,
      justification: params.advance.purpose,
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:advances-updated'));
      window.dispatchEvent(new Event('asopalav:wallet-updated'));
    }

    return fullAdvance;
  }

  async settleStaffAdvance(params: SettleAdvanceParams) {
    const advances = await this.getStaffAdvances(params.branchId);
    const target = advances.find((a) => a.id === params.advanceId || a.receipt_number === params.receiptNumber);

    if (!target) throw new Error('Advance record not found.');

    if (params.billsSubmittedAmount < 0 || params.cashReturnedAmount < 0) {
      throw new Error('Settlement amounts cannot be negative.');
    }

    const totalSettlingNow = params.billsSubmittedAmount + params.cashReturnedAmount;
    if (totalSettlingNow <= 0) {
      throw new Error('Total settlement amount must be greater than ₹0.');
    }

    if (totalSettlingNow > target.unsettled_balance) {
      throw new Error(
        `Total settlement amount (₹${totalSettlingNow.toLocaleString('en-IN')}) cannot exceed remaining unsettled balance of ₹${target.unsettled_balance.toLocaleString('en-IN')}.`
      );
    }

    const newBillsAmount = target.bills_submitted_amount + params.billsSubmittedAmount;
    const newCashReturnAmount = target.cash_returned_amount + params.cashReturnedAmount;
    const newUnsettled = Math.max(0, target.advance_amount - (newBillsAmount + newCashReturnAmount));

    let newStatus: StaffAdvance['status'] = 'Active_Unsettled';
    if (newUnsettled === 0) {
      newStatus = newBillsAmount > 0 ? 'Settled_Bills' : 'Settled_Cash';
    }

    const updatedProofs = [...target.settlement_proofs, ...params.settlementProofs];

    // 1. If cash was returned, credit Cash Wallet
    if (params.cashReturnedAmount > 0) {
      // M-6 Security: Check if accounting period is locked before crediting wallet
      const settlementDate = format(new Date(), 'yyyy-MM-dd');
      const isPeriodLocked = await this.checkIsPeriodLocked(settlementDate);
      if (isPeriodLocked && !isPrivilegedAdminRole(params.userRole)) {
        throw new Error(`Cannot record settlement: Accounting period for ${settlementDate} is LOCKED. Contact Super Admin or Admin to unlock.`);
      }

      const currentWallet = await this.getBranchWallet(params.branchId);
      currentWallet.cash_balance += params.cashReturnedAmount;
      await this.updateBranchWallet(currentWallet);

      await this.appendLedgerEntry({
        branch_id: params.branchId,
        branch_code: params.branchCode,
        wallet_type: 'Cash',
        transaction_type: 'Advance_Return_In',
        reference_number: `RET-${params.receiptNumber}`,
        debit_amount: 0,
        credit_amount: params.cashReturnedAmount,
        running_balance: currentWallet.cash_balance,
        remarks: `Cash return settlement for advance ${params.receiptNumber}`,
        cashier_name: params.userName,
      });
    }

    // 2. If bills were submitted, auto-generate Expense Voucher for accounting & Tally sync
    if (params.billsSubmittedAmount > 0) {
      try {
        await supabase.from('expense_categories').upsert([
          { category_name: 'Staff Advance Settlement Bill', color_theme: 'Vanilla', is_active: true }
        ]);
      } catch (e) {
        console.warn('Category ensure fallback:', e);
      }

      const settlementVoucher = {
        id: crypto.randomUUID(),
        voucher_number: `BILL-${params.receiptNumber}`,
        branch_id: params.branchId,
        branch_code: params.branchCode,
        payment_date: format(new Date(), 'yyyy-MM-dd'),
        // H-3 Fix: Use 'Advance_Settlement' payment_type so Tally export excludes this from
        // cash flow totals. Funds were already debited at advance disbursement time.
        // Double-counting in Tally export is prevented by filtering payment_type !== 'Advance_Settlement'.
        payment_type: 'Advance_Settlement',
        payment_method: 'Physical_Cash',
        total_amount: params.billsSubmittedAmount,
        recipient_name: target.staff_name,
        category_name: 'Staff Advance Settlement Bill',
        department_name: target.department_name || null,
        remarks: `[ADV-SETTLEMENT] Bill for Advance #${params.receiptNumber} (${target.purpose}) — excluded from Tally cash flow. Original debit was at advance disbursement.`,
        bill_photo_urls: params.settlementProofs || [],
        created_by_name: params.userName,
        status: 'Approved',
        created_at: new Date().toISOString(),
      };

      await this.insertExpenseVoucherRecord(settlementVoucher);

      await logSecurityEvent({
        userName: params.userName,
        userRole: params.userRole,
        actionType: 'Create_Voucher',
        targetEntity: 'expense_vouchers',
        targetIdentifier: settlementVoucher.voucher_number,
        eventDescription: `Auto-generated expense voucher ₹${params.billsSubmittedAmount} for advance settlement #${params.receiptNumber}`,
        justification: `Settlement of advance by ${target.staff_name}`,
      });
    }

    // 3. Update DB & Local Cache
    const updatedAdvance: StaffAdvance = {
      ...target,
      bills_submitted_amount: newBillsAmount,
      cash_returned_amount: newCashReturnAmount,
      unsettled_balance: newUnsettled,
      settlement_proofs: updatedProofs,
      status: newStatus,
    };

    const newAdvancesList = advances.map((a) => (a.id === updatedAdvance.id ? updatedAdvance : a));
    localStorage.setItem(`asopalav_advances_${params.branchId}`, JSON.stringify(newAdvancesList));

    const { error: advUpErr } = await supabase
      .from('staff_advances')
      .update({
        bills_submitted_amount: newBillsAmount,
        cash_returned_amount: newCashReturnAmount,
        unsettled_balance: newUnsettled,
        settlement_proofs: updatedProofs,
        status: newStatus,
      })
      .eq('receipt_number', params.receiptNumber);

    if (advUpErr) {
      console.error('Advance settlement update error:', advUpErr);
      throw new Error(advUpErr.message);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:advances-updated'));
      window.dispatchEvent(new Event('asopalav:wallet-updated'));
      if (params.billsSubmittedAmount > 0) {
        window.dispatchEvent(new Event('asopalav:vouchers-updated'));
      }
    }

    return updatedAdvance;
  }

  async flagForSalaryDeduction(receiptNumber: string, month: string, userName: string, branchId: string = 'Aellp-ASI') {
    const advances = await this.getStaffAdvances(branchId);
    const deductedAt = new Date().toISOString();
    const updated = advances.map((a) => {
      if (a.receipt_number === receiptNumber) {
        return {
          ...a,
          status: 'Flagged_Salary_Deduction' as const,
          salary_deduction_month: month,
          salary_deducted_at: deductedAt,
          salary_deducted_by_name: userName,
        };
      }
      return a;
    });
    localStorage.setItem(`asopalav_advances_${branchId}`, JSON.stringify(updated));

    // Persist in local overrides for bridged salary advances
    try {
      const stored = localStorage.getItem('asopalav_advance_status_overrides') || '{}';
      const parsed = JSON.parse(stored);
      parsed[receiptNumber] = {
        status: 'Flagged_Salary_Deduction',
        salary_deduction_month: month,
        salary_deducted_at: deductedAt,
        salary_deducted_by_name: userName,
      };
      localStorage.setItem('asopalav_advance_status_overrides', JSON.stringify(parsed));
    } catch {}

    const { error } = await supabase
      .from('staff_advances')
      .update({
        status: 'Flagged_Salary_Deduction',
        salary_deduction_month: month,
        salary_deducted_at: deductedAt,
        salary_deducted_by_name: userName,
      })
      .eq('receipt_number', receiptNumber);
    if (error) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        useOfflineQueue.getState().enqueueMutation({
          type: 'flag_salary_deduction',
          table: 'staff_advances',
          action: 'update',
          payload: {
            status: 'Flagged_Salary_Deduction',
            salary_deduction_month: month,
            salary_deducted_at: deductedAt,
            salary_deducted_by_name: userName,
          },
          matchField: 'receipt_number',
          matchValue: receiptNumber,
          description: `Flag salary deduction ${receiptNumber} (${month})`,
        });
      } else {
        throw new Error(`Failed to flag advance for salary deduction in database: ${error.message}`);
      }
    }

    await logSecurityEvent({
      userName,
      userRole: 'Store_Manager',
      actionType: 'Salary_Deduction_Tag',
      targetEntity: 'staff_advances',
      targetIdentifier: receiptNumber,
      eventDescription: `Flagged unsettled advance ${receiptNumber} for payroll deduction in month ${month}`,
      justification: 'Unsettled imprest at month-end closing',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:advances-updated'));
    }
  }

  async waiveStaffAdvance(
    receiptNumber: string,
    userName: string,
    userRole: string,
    reason: string,

    branchId: string = 'Aellp-ASI'
  ) {
    const advances = await this.getStaffAdvances(branchId);
    const target = advances.find((a) => a.receipt_number === receiptNumber);
    if (!target) throw new Error('Advance not found');

    const waivedAmount = target.unsettled_balance;
    const updated = advances.map((a) => {
      if (a.receipt_number === receiptNumber) {
        return {
          ...a,
          unsettled_balance: 0,
          status: 'Settled_Bills' as const,
        };
      }
      return a;
    });
    localStorage.setItem(`asopalav_advances_${branchId}`, JSON.stringify(updated));

    const { error } = await supabase
      .from('staff_advances')
      .update({
        unsettled_balance: 0,
        status: 'Settled_Bills',
      })
      .eq('receipt_number', receiptNumber);
    if (error) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        useOfflineQueue.getState().enqueueMutation({
          type: 'waive_advance',
          table: 'staff_advances',
          action: 'update',
          payload: {
            unsettled_balance: 0,
            status: 'Settled_Bills',
          },
          matchField: 'receipt_number',
          matchValue: receiptNumber,
          description: `Waive advance ${receiptNumber}`,
        });
      } else {
        throw new Error(`Failed to waive advance in database: ${error.message}`);
      }
    }

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Waive_Advance',
      targetEntity: 'staff_advances',
      targetIdentifier: receiptNumber,
      eventDescription: `Super Admin waived/forgave remaining advance balance of ₹${waivedAmount} for ${target.staff_name}`,
      justification: reason || 'Executive waiver by Super Admin',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:advances-updated'));
    }
  }

  async deleteStaffAdvance(
    receiptNumber: string,
    userName: string,
    userRole: string,
    reason: string,

    branchId: string = 'Aellp-ASI'
  ) {
    const advances = await this.getStaffAdvances(branchId);
    const target = advances.find((a) => a.receipt_number === receiptNumber);
    if (!target) throw new Error('Advance not found');

    // Refund wallet if active unsettled
    if (target.unsettled_balance > 0) {
      const currentWallet = await this.getBranchWallet(target.branch_id);
      currentWallet.cash_balance += target.unsettled_balance;
      await this.updateBranchWallet(currentWallet);

      await this.appendLedgerEntry({
        branch_id: target.branch_id,
        branch_code: target.branch_code,
        wallet_type: 'Cash',
        transaction_type: 'Adjustment',
        reference_number: `ADV-PURGE-${receiptNumber}`,
        debit_amount: 0,
        credit_amount: target.unsettled_balance,
        running_balance: currentWallet.cash_balance,
        remarks: `SUPERADMIN ADVANCE PURGE: ${reason}`,
        cashier_name: userName,
      });
    }

    const filtered = advances.filter((a) => a.receipt_number !== receiptNumber);
    localStorage.setItem(`asopalav_advances_${branchId}`, JSON.stringify(filtered));

    const { error } = await supabase.from('staff_advances').delete().eq('receipt_number', receiptNumber);
    if (error) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        useOfflineQueue.getState().enqueueMutation({
          type: 'delete_advance',
          table: 'staff_advances',
          action: 'delete',
          payload: {},
          matchField: 'receipt_number',
          matchValue: receiptNumber,
          description: `Delete advance ${receiptNumber}`,
        });
      } else {
        throw new Error(`Failed to delete advance in database: ${error.message}`);
      }
    }

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Delete_Advance',
      targetEntity: 'staff_advances',
      targetIdentifier: receiptNumber,
      eventDescription: `Permanently deleted advance record ${receiptNumber} (₹${target.advance_amount}) for ${target.staff_name}`,
      justification: reason || 'Super Admin advance deletion',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:advances-updated'));
      window.dispatchEvent(new Event('asopalav:wallet-updated'));
    }
  }

  /**
   * Batch flags multiple overdue advances for payroll deduction
   */
  async batchFlagOverdueForSalaryDeduction(
    advanceIdsOrReceipts: string[],
    month: string,
    userName: string,
    branchId: string = 'ALL'
  ): Promise<{ count: number; totalAmount: number }> {
    if (!advanceIdsOrReceipts || advanceIdsOrReceipts.length === 0) {
      return { count: 0, totalAmount: 0 };
    }

    const advances = await this.getStaffAdvances(branchId);
    const targetSet = new Set(advanceIdsOrReceipts);
    let totalAmount = 0;
    let count = 0;

    const now = new Date().toISOString();
    const updated = advances.map((a) => {
      if (targetSet.has(a.id) || targetSet.has(a.receipt_number)) {
        totalAmount += Number(a.unsettled_balance) || 0;
        count++;
        return {
          ...a,
          status: 'Flagged_Salary_Deduction' as const,
          salary_deduction_month: month,
          salary_deducted_at: now,
          salary_deducted_by_name: userName,
        };
      }
      return a;
    });

    if (branchId !== 'ALL') {
      localStorage.setItem(`asopalav_advances_${branchId}`, JSON.stringify(updated));
    }

    // Update by IDs or receipt numbers
    const isUUID = advanceIdsOrReceipts[0] && advanceIdsOrReceipts[0].includes('-');
    const field = isUUID ? 'id' : 'receipt_number';

    const { error } = await supabase
      .from('staff_advances')
      .update({
        status: 'Flagged_Salary_Deduction',
        salary_deduction_month: month,
        salary_deducted_at: now,
        salary_deducted_by_name: userName,
      })
      .in(field, advanceIdsOrReceipts);

    if (error) {
      throw new Error(`Failed to batch flag salary deductions in database: ${error.message}`);
    }

    await logSecurityEvent({
      userName,
      userRole: 'Store_Manager',
      actionType: 'Salary_Deduction_Tag',
      targetEntity: 'staff_advances',
      targetIdentifier: `BATCH-${count}-ADVANCES`,
      eventDescription: `Batch flagged ${count} overdue advances (₹${totalAmount.toLocaleString('en-IN')}) for HR salary deduction in month ${month}`,
      justification: 'Automated 30-day overdue payroll recovery sync',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:advances-updated'));
    }
    return { count, totalAmount };
  }

  /**
   * Batch marks flagged salary deductions as cleared / recovered from employee pay
   */
  async batchClearSalaryDeductions(
    advanceIdsOrReceipts: string[],
    userName: string,
    userRole: string = 'Super_Admin',
    reason: string,

    branchId: string = 'ALL'
  ): Promise<{ count: number; totalAmount: number }> {
    if (!advanceIdsOrReceipts || advanceIdsOrReceipts.length === 0) {
      return { count: 0, totalAmount: 0 };
    }

    const advances = await this.getStaffAdvances(branchId);
    const targetSet = new Set(advanceIdsOrReceipts);
    let totalAmount = 0;
    let count = 0;

    const updated = advances.map((a) => {
      if (targetSet.has(a.id) || targetSet.has(a.receipt_number)) {
        totalAmount += Number(a.unsettled_balance) || Number(a.advance_amount) || 0;
        count++;
        return {
          ...a,
          status: 'Cleared_Salary_Deduction' as const,
          unsettled_balance: 0,
        };
      }
      return a;
    });

    if (branchId !== 'ALL') {
      localStorage.setItem(`asopalav_advances_${branchId}`, JSON.stringify(updated));
    }

    const isUUID = advanceIdsOrReceipts[0] && advanceIdsOrReceipts[0].includes('-');
    const field = isUUID ? 'id' : 'receipt_number';

    const { error } = await supabase
      .from('staff_advances')
      .update({
        status: 'Cleared_Salary_Deduction',
        unsettled_balance: 0,
      })
      .in(field, advanceIdsOrReceipts);

    if (error) {
      throw new Error(`Failed to batch clear salary deductions in database: ${error.message}`);
    }

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Settle_Advance',
      targetEntity: 'staff_advances',
      targetIdentifier: `BATCH-${count}-PAYROLL-CLEARED`,
      eventDescription: `Confirmed recovery of ${count} advances (₹${totalAmount.toLocaleString('en-IN')}) via HR Payroll deduction: ${reason}`,
      justification: reason || 'Payroll payout clearance confirmed',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:advances-updated'));
    }
    return { count, totalAmount };
  }

  /**
   * Generates a formal HR Payroll Deduction Schedule CSV for Tally Payroll & Excel
   */
  generateHRPayrollDeductionCSV(advances: StaffAdvance[], targetMonth?: string): string {
    const sanitizeCsv = (str: any) => {
      const sanitized = String(str || '').replace(/"/g, '""');
      if (/^[=+\-@|\t\r]/.test(sanitized)) {
        return `'${sanitized}`;
      }
      return sanitized;
    };

    const headers = [
      'Staff Code',
      'Staff Employee Name',
      'Department',
      'Showroom Branch',
      'Advance Receipt Number',
      'Advance Disbursal Date',
      'Original Advance Amount (INR)',
      'Bills Submitted Amount (INR)',
      'Cash Returned Amount (INR)',
      'Unsettled Amount to Deduct (INR)',
      'Payroll Recovery Month',
      'Deduction Status',
      'Authorized By',
      'Flagged At Timestamp',
    ];

    const targetList = targetMonth && targetMonth !== 'ALL'
      ? advances.filter((a) => a.salary_deduction_month === targetMonth || a.status === 'Flagged_Salary_Deduction')
      : advances.filter((a) => a.status === 'Flagged_Salary_Deduction' || a.status === 'Cleared_Salary_Deduction' || a.unsettled_balance > 0);

    const rows = targetList.map((a) => {
      return [
        `"${sanitizeCsv(a.staff_code)}"`,
        `"${sanitizeCsv(a.staff_name)}"`,
        `"${sanitizeCsv(a.department_name || 'General')}"`,
        `"${sanitizeCsv(a.branch_code || 'ASI')}"`,
        `"${sanitizeCsv(a.receipt_number)}"`,
        `"${sanitizeCsv(a.advance_date)}"`,
        a.advance_amount,
        a.bills_submitted_amount || 0,
        a.cash_returned_amount || 0,
        a.unsettled_balance,
        `"${sanitizeCsv(a.salary_deduction_month || targetMonth || 'Current Month')}"`,
        `"${sanitizeCsv(a.status === 'Cleared_Salary_Deduction' ? 'Deducted & Cleared' : a.status === 'Flagged_Salary_Deduction' ? 'Flagged for Payroll' : 'Pending Imprest')}"`,
        `"${sanitizeCsv(a.salary_deducted_by_name || a.disbursed_by_name || 'Store Manager')}"`,
        `"${sanitizeCsv(a.salary_deducted_at || a.created_at)}"`,
      ].join(',');
    });

    return 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
  }

  // --------------------------------------------------------------------------
  // 6. DAILY CASH CLOSING & DENOMINATION AUDIT (F9)
  // --------------------------------------------------------------------------
  async getCurrencyDenominations(): Promise<CurrencyDenomination[]> {
    try {
      const { data } = await supabase.from('currency_denominations').select('*').order('sort_order', { ascending: true });
      if (data && data.length > 0) return data;
    } catch (e) {
      console.warn('Using default RBI currency denominations', e);
    }
    return [
      { denomination_value: 500, display_label: '₹500 Note', is_coin: false, sort_order: 1, is_active: true },
      { denomination_value: 200, display_label: '₹200 Note', is_coin: false, sort_order: 2, is_active: true },
      { denomination_value: 100, display_label: '₹100 Note', is_coin: false, sort_order: 3, is_active: true },
      { denomination_value: 50, display_label: '₹50 Note', is_coin: false, sort_order: 4, is_active: true },
      { denomination_value: 20, display_label: '₹20 Note', is_coin: false, sort_order: 5, is_active: true },
      { denomination_value: 10, display_label: '₹10 Note', is_coin: false, sort_order: 6, is_active: true },
      { denomination_value: 5, display_label: '₹5 Coin', is_coin: true, sort_order: 7, is_active: true },
      { denomination_value: 2, display_label: '₹2 Coin', is_coin: true, sort_order: 8, is_active: true },
      { denomination_value: 1, display_label: '₹1 Coin', is_coin: true, sort_order: 9, is_active: true },
    ];
  }

  async getCashClosing(branchId: string, closingDate: string): Promise<CashClosing | null> {
    try {
      const { data, error } = await supabase
        .from('cash_closings')
        .select('*')
        .eq('branch_id', branchId)
        .eq('closing_date', closingDate)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (data) return data;
    } catch (e) {
      console.warn('Error fetching cash closing from DB:', e);
    }

    try {
      const offlineQueue = useOfflineQueue.getState().mutations;
      const match = offlineQueue.find(
        (m) =>
          m.table === 'cash_closings' &&
          m.payload?.branch_id === branchId &&
          m.payload?.closing_date === closingDate
      );
      if (match) return match.payload;
    } catch {
      // ignore
    }
    return null;
  }

  async saveCashClosing(params: SaveCashClosingParams): Promise<CashClosing> {
    const fullClosing: CashClosing = {
      id: crypto.randomUUID(),
      closing_date: params.closingDate,
      branch_id: params.branchId,
      branch_code: params.branchCode,
      opening_cash: params.openingCash,
      cash_inflow: params.cashInflow,
      cash_outflow: params.cashOutflow,
      expected_cash: params.expectedCash,
      actual_cash: params.actualCash,
      variance: params.variance,
      variance_disposition: params.varianceDisposition || (params.variance === 0 ? null : 'Unresolved'),
      charge_staff_code: params.chargeStaffCode || null,
      charge_staff_name: params.chargeStaffName || null,
      denominations_detail: params.denominationsDetail,
      denominations_breakdown: params.denominationsBreakdown,
      closing_notes: params.closingNotes,
      cashier_name: params.cashierName,
      verified_by_name: params.verifiedByName,
      created_at: new Date().toISOString(),
    };

    try {
      const { error } = await supabase.from('cash_closings').upsert([fullClosing]);
      if (error) throw error;
    } catch (e) {
      console.warn('Cash closing fallback to offline queue:', e);
      useOfflineQueue.getState().enqueueMutation({
        type: 'cash_closing',
        table: 'cash_closings',
        action: 'upsert',
        payload: fullClosing,
        description: `Cash closing ${params.branchCode} ${params.closingDate}`,
      });
    }

    // 1. Reconcile Branch Wallet Cash Balance to verified physically counted cash
    try {
      const currentWallet = await this.getBranchWallet(params.branchId);
      currentWallet.cash_balance = params.actualCash;
      await this.updateBranchWallet(currentWallet);

      if (params.variance !== 0) {
        const dispText = params.varianceDisposition ? ` [Disposition: ${params.varianceDisposition.replace('_', ' ')}]` : '';
        await this.appendLedgerEntry({
          branch_id: params.branchId,
          branch_code: params.branchCode,
          wallet_type: 'Cash',
          transaction_type: 'Adjustment',
          reference_number: `F9-REC-${params.branchCode}-${params.closingDate.replace(/-/g, '')}`,
          debit_amount: params.variance < 0 ? Math.abs(params.variance) : 0,
          credit_amount: params.variance > 0 ? params.variance : 0,
          running_balance: params.actualCash,
          remarks: `F9 Daily Cash Closing Reconciliation (${params.variance >= 0 ? '+' : ''}₹${params.variance})${dispText}`,
          cashier_name: params.verifiedByName,
        });

        // Trigger notification for variance
        useNotificationStore.getState().addNotification({
          title: `Daily Closing Cash ${params.variance < 0 ? 'Shortage' : 'Excess'} Detected`,
          message: `${params.branchCode} closing on ${params.closingDate} has a variance of ${params.variance >= 0 ? '+' : ''}₹${params.variance}. Disposition: ${params.varianceDisposition || 'Unresolved'}.`,
          type: 'closing_variance',
          target_roles: ['Store_Manager', 'Super_Admin', 'Auditor'],
          branch_id: params.branchId,
          amount: Math.abs(params.variance),
        });
      }
    } catch (err) {
      console.warn('Wallet closing reconciliation fallback:', err);
    }

    // Audit Log
    await logSecurityEvent({
      userName: params.verifiedByName,
      userRole: 'Store_Manager',
      actionType: 'Daily_F9_Lock',
      targetEntity: 'cash_closings',
      targetIdentifier: `${params.branchCode}-${params.closingDate}`,
      eventDescription: `Completed F9 Daily Cash Closing. Actual: ₹${params.actualCash}, Expected: ₹${params.expectedCash}, Variance: ₹${params.variance}`,
      justification: params.closingNotes || 'Evening cash drawer lock & tally sign-off',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:ledger-updated'));
      window.dispatchEvent(new Event('asopalav:wallet-updated'));
    }

    return fullClosing;
  }

  async reopenCashClosing(
    closingDate: string,
    branchId: string,
    branchCode: string,
    userName: string,
    userRole: string,
    reason: string,
    cashReturnedToDrawer: boolean = false
  ) {
    const { error } = await supabase
      .from('cash_closings')
      .delete()
      .eq('branch_id', branchId)
      .eq('closing_date', closingDate);

    if (error) {
      throw new Error(`Failed to reopen cash closing in database: ${error.message}`);
    }

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Daily_F9_Unlock',
      targetEntity: 'cash_closings',
      targetIdentifier: `${branchCode}-${closingDate}`,
      eventDescription: `Super Admin reopened closed drawer session for branch ${branchCode} on ${closingDate}`,
      justification: reason || 'Audit recount and adjustments',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:ledger-updated'));
      window.dispatchEvent(new Event('asopalav:wallet-updated'));
    }
  }

  async updateCashClosing(
    closingDate: string,
    branchCode: string,
    updates: Partial<CashClosing>,
    userName: string,
    userRole: string,
    reason: string,
    cashReturnedToDrawer: boolean = false
  ) {
    const { error } = await supabase
      .from('cash_closings')
      .update(updates)
      .eq('closing_date', closingDate)
      .eq('branch_code', branchCode);

    if (error) {
      throw new Error(`Failed to update cash closing in database: ${error.message}`);
    }

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Update_Cash_Closing',
      targetEntity: 'cash_closings',
      targetIdentifier: `${branchCode}-${closingDate}`,
      eventDescription: `Super Admin updated cash closing details for ${branchCode} on ${closingDate}`,
      justification: reason || 'Closing record correction',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:ledger-updated'));
    }
  }

  // --------------------------------------------------------------------------
  // MASTER DATA FULL CRUD (BRANCHES, CATEGORIES, DEPTS, COURIERS, USERS)
  // --------------------------------------------------------------------------
  async createBranch(branch: any, userName: string, userRole: string) {
    const branchId = branch.branch_id || `Aellp-${(branch.branch_code || 'BR').toUpperCase()}`;
    const payload = { ...branch, branch_id: branchId };
    const { error } = await supabase.from('branches').insert([payload]);
    if (error) throw new Error(error.message);

    // Ensure wallet row exists
    await supabase.from('branch_wallets').upsert([
      { branch_id: branchId, cash_balance: 0, upi_balance: 0, updated_at: new Date().toISOString() }
    ]);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Create_Branch',
      targetEntity: 'branches',
      targetIdentifier: payload.branch_code,
      eventDescription: `Created showroom branch: ${payload.branch_name} (${payload.branch_code})`,
      justification: 'Showroom network expansion',
    });

    useBranchStore.getState().fetchBranchesAndWallets(true);
    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'branches' } }));
    }
  }

  async updateBranch(branchId: string, updates: any, userName: string, userRole: string) {
    const { error } = await supabase.from('branches').update(updates).eq('branch_id', branchId);
    if (error) throw new Error(error.message);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Update_Branch',
      targetEntity: 'branches',
      targetIdentifier: branchId,
      eventDescription: `Updated branch settings for ${branchId}: ${Object.keys(updates).join(', ')}`,
      justification: 'Branch parameter update by Super Admin',
    });

    useBranchStore.getState().fetchBranchesAndWallets(true);
    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'branches' } }));
    }
  }

  async deleteBranch(branchId: string, userName: string, userRole: string, reason?: string) {
    const { error } = await supabase.from('branches').update({ is_active: false, updated_at: new Date().toISOString() }).eq('branch_id', branchId);
    if (error) throw new Error(error.message);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Delete_Branch',
      targetEntity: 'branches',
      targetIdentifier: branchId,
      eventDescription: `Decommissioned / removed branch ${branchId}`,
      justification: reason || 'Showroom closure / decommission',
    });

    useBranchStore.getState().fetchBranchesAndWallets(true);
    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'branches' } }));
    }
  }

  async createCategory(cat: any, userName: string, userRole: string) {
    const { error } = await supabase.from('expense_categories').insert([cat]);
    if (error) throw new Error(error.message);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Create_Category',
      targetEntity: 'expense_categories',
      targetIdentifier: cat.category_name,
      eventDescription: `Added new expense category: ${cat.category_name}`,
      justification: 'Master data configuration',
    });

    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'expense_categories' } }));
    }
  }

  async updateCategory(categoryName: string, updates: any, userName: string, userRole: string) {
    const { error } = await supabase.from('expense_categories').update(updates).eq('category_name', categoryName);
    if (error) throw new Error(error.message);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Update_Category',
      targetEntity: 'expense_categories',
      targetIdentifier: categoryName,
      eventDescription: `Updated expense category ${categoryName}`,
      justification: 'Category modification by Super Admin',
    });

    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'expense_categories' } }));
    }
  }

  async deleteCategory(categoryName: string, userName: string, userRole: string, reason?: string) {
    const { error } = await supabase.from('expense_categories').update({ is_active: false }).eq('category_name', categoryName);
    if (error) throw new Error(error.message);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Delete_Category',
      targetEntity: 'expense_categories',
      targetIdentifier: categoryName,
      eventDescription: `Deleted expense category ${categoryName}`,
      justification: reason || 'Master category cleanup',
    });

    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'expense_categories' } }));
    }
  }

  /**
   * Universal Master Entity Rename with Optional Historical Cascade & Strong Audit Logging
   */
  async renameMasterEntity(params: {
    entityType: 'category' | 'department' | 'courier' | 'staff' | 'branch';
    oldIdOrName: string;
    newIdOrName: string;
    updateHistoricalData: boolean;
    additionalUpdates?: Record<string, any>;
    userName: string;
    userRole: string;
  }): Promise<{ updatedRecordsCount: number }> {
    const { entityType, oldIdOrName, newIdOrName, updateHistoricalData, additionalUpdates = {}, userName, userRole } = params;
    let updatedRecordsCount = 0;

    if (entityType === 'category') {
      const cleanOld = oldIdOrName.trim();
      const cleanNew = newIdOrName.trim();

      if (cleanOld !== cleanNew) {
        // 1. Upsert new category in expense_categories first
        const { error: insErr } = await supabase.from('expense_categories').upsert([
          {
            category_name: cleanNew,
            color_theme: additionalUpdates.color_theme || 'Vanilla',
            is_active: additionalUpdates.is_active ?? true,
          }
        ]);
        if (insErr) throw new Error(insErr.message);

        // 2. Cascade to historical records BEFORE removing old category so FK constraints are satisfied
        if (updateHistoricalData) {
          const { data: vData, error: vErr } = await supabase
            .from('expense_vouchers')
            .update({ category_name: cleanNew })
            .eq('category_name', cleanOld)
            .select('voucher_number');
          if (vErr) throw new Error(vErr.message);
          if (vData) updatedRecordsCount += vData.length;

          const { data: sData, error: sErr } = await supabase
            .from('voucher_splits')
            .update({ category_name: cleanNew })
            .eq('category_name', cleanOld)
            .select('id');
          if (sErr) throw new Error(sErr.message);
          if (sData) updatedRecordsCount += sData.length;
        }

        // 3. Delete old category entry (or deactivate if historical records still reference it)
        const { error: delErr } = await supabase.from('expense_categories').delete().eq('category_name', cleanOld);
        if (delErr) {
          const { error: deactErr } = await supabase
            .from('expense_categories')
            .update({ is_active: false })
            .eq('category_name', cleanOld);
          if (deactErr) throw new Error(deactErr.message);
        }
      } else {
        const { error: updErr } = await supabase
          .from('expense_categories')
          .update({
            color_theme: additionalUpdates.color_theme || 'Vanilla',
            is_active: additionalUpdates.is_active ?? true,
          })
          .eq('category_name', cleanOld);
        if (updErr) throw new Error(updErr.message);
      }
    } else if (entityType === 'department') {
      const cleanOld = oldIdOrName.trim();
      const cleanNew = newIdOrName.trim();
      const deptCode = additionalUpdates.department_code || cleanOld;
      const deptPayload = {
        department_name: cleanNew,
        is_active: additionalUpdates.is_active ?? true,
      };

      const { data: dData, error: dErr } = await supabase
        .from('departments')
        .update(deptPayload)
        .eq('department_code', deptCode)
        .select('department_code');
      if (dErr) throw new Error(dErr.message);

      if (!dData || dData.length === 0) {
        const { error: fallbackErr } = await supabase
          .from('departments')
          .update(deptPayload)
          .eq('department_name', cleanOld);
        if (fallbackErr) throw new Error(fallbackErr.message);
      }

      if (updateHistoricalData && cleanOld !== cleanNew) {
        const { data: vData, error: vErr } = await supabase
          .from('expense_vouchers')
          .update({ department_name: cleanNew })
          .eq('department_name', cleanOld)
          .select('voucher_number');
        if (vErr) throw new Error(vErr.message);
        if (vData) updatedRecordsCount += vData.length;

        const { data: sData, error: sErr } = await supabase
          .from('voucher_splits')
          .update({ department_name: cleanNew })
          .eq('department_name', cleanOld)
          .select('id');
        if (sErr) throw new Error(sErr.message);
        if (sData) updatedRecordsCount += sData.length;

        const { data: staffData, error: stErr } = await supabase
          .from('staff_members')
          .update({ department_name: cleanNew })
          .eq('department_name', cleanOld)
          .select('staff_code');
        if (stErr) throw new Error(stErr.message);
        if (staffData) updatedRecordsCount += staffData.length;

        const { data: advData, error: advErr } = await supabase
          .from('staff_advances')
          .update({ department_name: cleanNew })
          .eq('department_name', cleanOld)
          .select('id');
        if (advErr) throw new Error(advErr.message);
        if (advData) updatedRecordsCount += advData.length;
      }
    } else if (entityType === 'courier') {
      const cleanOld = oldIdOrName.trim();
      const cleanNew = newIdOrName.trim();
      const partnerCode = additionalUpdates.partner_code || cleanOld;
      const courierPayload: Record<string, any> = {
        partner_name: cleanNew,
        is_active: additionalUpdates.is_active ?? true,
      };
      if (additionalUpdates.contact_phone !== undefined) {
        courierPayload.contact_phone = additionalUpdates.contact_phone || null;
      }
      if (additionalUpdates.tracking_url_template !== undefined) {
        courierPayload.tracking_url_template = additionalUpdates.tracking_url_template || null;
      }

      const { error: cErr } = await supabase
        .from('courier_partners')
        .update(courierPayload)
        .eq('partner_code', partnerCode);
      if (cErr) throw new Error(cErr.message);

      if (updateHistoricalData && cleanOld !== cleanNew) {
        const { data: vData, error: vErr } = await supabase
          .from('expense_vouchers')
          .update({ courier_partner_name: cleanNew, recipient_name: cleanNew })
          .eq('courier_partner_name', cleanOld)
          .select('voucher_number');
        if (vErr) throw new Error(vErr.message);
        if (vData) updatedRecordsCount += vData.length;
      }
    } else if (entityType === 'staff') {
      const cleanOld = oldIdOrName.trim();
      const cleanNew = newIdOrName.trim();
      const staffCode = additionalUpdates.staff_code || cleanOld;
      const staffPayload: Record<string, any> = {
        first_name: (additionalUpdates.first_name || cleanNew).trim(),
        middle_name: additionalUpdates.middle_name ? String(additionalUpdates.middle_name).trim() : null,
        last_name: additionalUpdates.last_name ? String(additionalUpdates.last_name).trim() : null,
        mobile_number: additionalUpdates.mobile_number ? String(additionalUpdates.mobile_number).trim() : null,
        branch_id: additionalUpdates.branch_id || 'Aellp-ASI',
        branch_code: additionalUpdates.branch_code || 'ASI',
        department_code: additionalUpdates.department_code || null,
        department_name: additionalUpdates.department_name ? String(additionalUpdates.department_name).trim() : null,
        designation: additionalUpdates.designation ? String(additionalUpdates.designation).trim() : null,
        is_active: additionalUpdates.is_active ?? true,
        updated_at: new Date().toISOString(),
      };

      const { error: stErr } = await supabase
        .from('staff_members')
        .update(staffPayload)
        .eq('staff_code', staffCode);
      if (stErr) throw new Error(stErr.message);

      if (updateHistoricalData && cleanOld !== cleanNew) {
        const { data: vData, error: vErr } = await supabase
          .from('expense_vouchers')
          .update({ requested_by_staff_name: cleanNew })
          .eq('requested_by_staff_code', staffCode)
          .select('voucher_number');
        if (vErr) throw new Error(vErr.message);
        if (vData) updatedRecordsCount += vData.length;

        const { data: sData, error: sErr } = await supabase
          .from('voucher_splits')
          .update({ staff_name: cleanNew })
          .eq('staff_code', staffCode)
          .select('id');
        if (sErr) throw new Error(sErr.message);
        if (sData) updatedRecordsCount += sData.length;

        const { data: advData, error: advErr } = await supabase
          .from('staff_advances')
          .update({ staff_name: cleanNew })
          .eq('staff_code', staffCode)
          .select('id');
        if (advErr) throw new Error(advErr.message);
        if (advData) updatedRecordsCount += advData.length;
      }
    } else if (entityType === 'branch') {
      const cleanNew = newIdOrName.trim();
      const branchId = additionalUpdates.branch_id || oldIdOrName;
      const branchPayload: Record<string, any> = {
        branch_name: cleanNew,
        short_name: (additionalUpdates.short_name || cleanNew).trim(),
        city: (additionalUpdates.city || 'Ahmedabad').trim(),
        state: (additionalUpdates.state || 'Gujarat').trim(),
        gstin: additionalUpdates.gstin ? String(additionalUpdates.gstin).trim() : null,
        pan_number: additionalUpdates.pan_number ? String(additionalUpdates.pan_number).trim() : null,
        min_cash_threshold: Number(additionalUpdates.min_cash_threshold) || 3000,
        is_active: additionalUpdates.is_active ?? true,
        updated_at: new Date().toISOString(),
      };
      if (additionalUpdates.max_cash_ceiling !== undefined && additionalUpdates.max_cash_ceiling !== '') {
        branchPayload.max_cash_ceiling = Number(additionalUpdates.max_cash_ceiling) || 25000;
      }
      if (additionalUpdates.max_upi_ceiling !== undefined && additionalUpdates.max_upi_ceiling !== '') {
        branchPayload.max_upi_ceiling = Number(additionalUpdates.max_upi_ceiling) || 50000;
      }

      const { error: bErr } = await supabase
        .from('branches')
        .update(branchPayload)
        .eq('branch_id', branchId);
      if (bErr) throw new Error(bErr.message);
    }

    // 3. Create strong audit log entry
    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Master_Data_Rename',
      targetEntity: entityType,
      targetIdentifier: newIdOrName,
      eventDescription: `Renamed ${entityType} from "${oldIdOrName}" to "${newIdOrName}". Historical records update mode: ${
        updateHistoricalData ? `YES (Cascaded across ${updatedRecordsCount} past records)` : 'NO (Applied only to future records)'
      }`,
      justification: `Master Catalogue rename confirmed by ${userRole} ${userName}`,
    });

    // Invalidate caches and dispatch updates
    useVoucherStore.getState().invalidateMasterData();
    useBranchStore.getState().fetchBranchesAndWallets(true);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: entityType } }));
      window.dispatchEvent(new Event('asopalav:vouchers-updated'));
    }

    return { updatedRecordsCount };
  }

  async createDepartment(dept: any, userName: string, userRole: string) {
    const { error } = await supabase.from('departments').insert([dept]);
    if (error) throw new Error(error.message);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Create_Department',
      targetEntity: 'departments',
      targetIdentifier: dept.department_name,
      eventDescription: `Added new department: ${dept.department_name}`,
      justification: 'Organizational chart update',
    });

    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'departments' } }));
    }
  }

  async updateDepartment(deptCode: string, updates: any, userName: string, userRole: string) {
    const { error } = await supabase.from('departments').update(updates).eq('department_code', deptCode);
    if (error) throw new Error(error.message);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Update_Department',
      targetEntity: 'departments',
      targetIdentifier: deptCode,
      eventDescription: `Updated department ${deptCode}`,
      justification: 'Department modification',
    });

    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'departments' } }));
    }
  }

  async deleteDepartment(deptCode: string, deptName: string, userName: string, userRole: string, reason?: string) {
    const { error } = await supabase.from('departments').update({ is_active: false }).eq('department_code', deptCode);
    if (error) throw new Error(error.message);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Delete_Department',
      targetEntity: 'departments',
      targetIdentifier: deptName || deptCode,
      eventDescription: `Deleted department ${deptName || deptCode}`,
      justification: reason || 'Department removal by Super Admin',
    });

    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'departments' } }));
    }
  }

  async createCourier(courier: any, userName: string, userRole: string) {
    const { error } = await supabase.from('courier_partners').insert([courier]);
    if (error) throw new Error(error.message);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Create_Courier',
      targetEntity: 'courier_partners',
      targetIdentifier: courier.partner_name,
      eventDescription: `Added courier partner: ${courier.partner_name}`,
      justification: 'Logistics vendor onboarding',
    });

    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'courier_partners' } }));
    }
  }

  async updateCourier(partnerCode: string, updates: any, userName: string, userRole: string) {
    const { error } = await supabase.from('courier_partners').update(updates).eq('partner_code', partnerCode);
    if (error) throw new Error(error.message);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Update_Courier',
      targetEntity: 'courier_partners',
      targetIdentifier: partnerCode,
      eventDescription: `Updated courier partner ${partnerCode}`,
      justification: 'Courier detail update',
    });

    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'courier_partners' } }));
    }
  }

  async deleteCourier(partnerCode: string, partnerName: string, userName: string, userRole: string, reason?: string) {
    const { error } = await supabase.from('courier_partners').update({ is_active: false }).eq('partner_code', partnerCode);
    if (error) throw new Error(error.message);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Delete_Courier',
      targetEntity: 'courier_partners',
      targetIdentifier: partnerName || partnerCode,
      eventDescription: `Deleted courier partner ${partnerName || partnerCode}`,
      justification: reason || 'Courier vendor decommission',
    });

    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'courier_partners' } }));
    }
  }

  async updateRolePermissions(roleCode: string, permissions: Partial<RolePermissions>, userName: string, userRole: string) {
    const { error } = await supabase.from('role_permissions').update(permissions).eq('role_code', roleCode);
    if (error) throw new Error(error.message);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Update_Permissions',
      targetEntity: 'role_permissions',
      targetIdentifier: roleCode,
      eventDescription: `Modified permissions matrix for role ${roleCode}`,
      justification: 'RBAC security policy update by Super Admin',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:users-roles-updated'));
    }
  }

  async deleteAppUser(userId: string, username: string, userName: string, userRole: string, reason?: string) {
    const { error } = await supabase.from('app_users').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', userId);
    if (error) throw new Error(error.message);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Delete_User',
      targetEntity: 'app_users',
      targetIdentifier: username || userId,
      eventDescription: `Deleted user account @${username}`,
      justification: reason || 'User offboarding by Super Admin',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:users-roles-updated'));
    }
  }

  async deleteStaffMember(staffCode: string, staffName: string, userName: string, userRole: string, reason?: string) {
    const { error } = await supabase.from('staff_members').update({ is_active: false, updated_at: new Date().toISOString() }).eq('staff_code', staffCode);
    if (error) throw new Error(error.message);

    // Direct cut of all linked app_users login access
    try {
      await supabase
        .from('app_users')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .or(`staff_code.eq.${staffCode},id.eq.${staffCode}`);
    } catch (e) {
      console.warn('Could not revoke linked app_users on staff delete:', e);
    }

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Delete_User',
      targetEntity: 'staff_members',
      targetIdentifier: staffCode,
      eventDescription: `Removed staff member ${staffName} (${staffCode}) and revoked linked user login access`,
      justification: reason || 'Staff departure from showroom',
    });

    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'staff_members' } }));
      window.dispatchEvent(new Event('asopalav:users-roles-updated'));
    }
  }

  async saveBranch(branch: any, isEdit: boolean, userName: string, userRole: string) {
    const branchCode = (branch.branch_code || 'BR').toUpperCase();
    const branchId = branch.branch_id || `Aellp-${branchCode}`;
    const payload: Record<string, any> = {
      branch_id: branchId,
      branch_code: branchCode,
      branch_name: (branch.branch_name || '').trim(),
      short_name: (branch.short_name || branch.branch_name || '').trim(),
      entity_company_name: (branch.entity_company_name || 'Asopalav Endeavours LLP').trim(),
      pan_number: branch.pan_number ? String(branch.pan_number).trim() : null,
      gstin: branch.gstin ? String(branch.gstin).trim() : null,
      accountant_name: (branch.accountant_name || '').trim(),
      contact_phone: (branch.contact_phone || '').trim(),
      contact_email: (branch.contact_email || '').trim(),
      city: (branch.city || 'Ahmedabad').trim(),
      state: (branch.state || 'Gujarat').trim(),
      address: (branch.address || '').trim(),
      min_cash_threshold: Number(branch.min_cash_threshold) || 3000,
      is_active: branch.is_active ?? true,
    };

    if (branch.max_cash_ceiling !== undefined && branch.max_cash_ceiling !== '') {
      payload.max_cash_ceiling = Number(branch.max_cash_ceiling) || 25000;
    }
    if (branch.max_upi_ceiling !== undefined && branch.max_upi_ceiling !== '') {
      payload.max_upi_ceiling = Number(branch.max_upi_ceiling) || 50000;
    }

    let { error } = await supabase.from('branches').upsert([payload]);
    if (error && error.message && error.message.includes('column of') && error.message.includes('branches')) {
      console.warn('[Supabase Schema Adaptor] Retrying branch upsert without ceiling columns:', error.message);
      delete payload.max_cash_ceiling;
      delete payload.max_upi_ceiling;
      const retry = await supabase.from('branches').upsert([payload]);
      error = retry.error;
    }
    if (error) throw new Error(error.message);

    // Guarantee sub-wallet row exists without overwriting existing balances to 0 on edit
    if (!isEdit || branch.cash_balance !== undefined || branch.upi_balance !== undefined) {
      const { data: existingWallet } = await supabase
        .from('branch_wallets')
        .select('branch_id, cash_balance, upi_balance')
        .eq('branch_id', branchId)
        .maybeSingle();

      if (!existingWallet || branch.cash_balance !== undefined || branch.upi_balance !== undefined) {
        await supabase.from('branch_wallets').upsert([
          {
            branch_id: branchId,
            cash_balance:
              branch.cash_balance !== undefined
                ? Number(branch.cash_balance)
                : Number(existingWallet?.cash_balance || 0),
            upi_balance:
              branch.upi_balance !== undefined
                ? Number(branch.upi_balance)
                : Number(existingWallet?.upi_balance || 0),
            updated_at: new Date().toISOString(),
          },
        ]);
      }
    }

    await logSecurityEvent({
      userName,
      userRole,
      actionType: isEdit ? 'Update_Branch' : 'Create_Branch',
      targetEntity: 'branches',
      targetIdentifier: payload.branch_code,
      eventDescription: `${isEdit ? 'Updated' : 'Created'} showroom branch ${payload.branch_name} (${payload.branch_code})`,
      justification: 'Showroom master management',
    });

    useBranchStore.getState().fetchBranchesAndWallets(true);
    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'branches' } }));
    }
  }

  async saveCategory(category: any, isEdit: boolean, userName: string, userRole: string) {
    const payload = {
      category_name: (category.category_name || '').trim(),
      color_theme: category.color_theme || 'Vanilla',
      is_active: category.is_active ?? true,
    };
    if (!payload.category_name) throw new Error('Category Name is required.');

    const { error } = await supabase.from('expense_categories').upsert([payload]);
    if (error) throw new Error(error.message);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: isEdit ? 'Update_Category' : 'Create_Category',
      targetEntity: 'expense_categories',
      targetIdentifier: payload.category_name,
      eventDescription: `${isEdit ? 'Updated' : 'Created'} expense category ${payload.category_name}`,
      justification: 'Expense category master management',
    });

    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'expense_categories' } }));
    }
  }

  async saveDepartment(department: any, isEdit: boolean, userName: string, userRole: string) {
    const payload = {
      department_code: (department.department_code || '').trim().toUpperCase(),
      department_name: (department.department_name || '').trim(),
      is_active: department.is_active ?? true,
    };
    if (!payload.department_code || !payload.department_name) {
      throw new Error('Department Code and Name are required.');
    }

    const { error } = await supabase.from('departments').upsert([payload]);
    if (error) throw new Error(error.message);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: isEdit ? 'Update_Department' : 'Create_Department',
      targetEntity: 'departments',
      targetIdentifier: payload.department_code,
      eventDescription: `${isEdit ? 'Updated' : 'Created'} department ${payload.department_name} (${payload.department_code})`,
      justification: 'Department master management',
    });

    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'departments' } }));
    }
  }

  async saveCourier(courier: any, isEdit: boolean, userName: string, userRole: string) {
    const rawPhone = courier.contact_phone ? String(courier.contact_phone).trim() : null;
    let cleanPhone: string | null = null;
    if (rawPhone && rawPhone !== '-' && rawPhone !== '+91' && rawPhone.toLowerCase() !== 'null' && rawPhone.toLowerCase() !== 'na') {
      const digits = rawPhone.replace(/[^0-9]/g, '');
      if (digits.length >= 10) {
        const clean10 = digits.startsWith('91') && digits.length > 10 ? digits.slice(2, 12) : digits.slice(0, 10);
        cleanPhone = `+91 ${clean10.slice(0, 5)} ${clean10.slice(5, 10)}`;
      } else if (digits.length > 0) {
        cleanPhone = rawPhone;
      }
    }

    const payload = {
      partner_code: (courier.partner_code || '').trim().toUpperCase(),
      partner_name: (courier.partner_name || '').trim(),
      contact_phone: cleanPhone,
      is_active: courier.is_active ?? true,
    };
    if (!payload.partner_code || !payload.partner_name) {
      throw new Error('Courier Partner Code and Name are required.');
    }

    const { error } = await supabase.from('courier_partners').upsert([payload]);
    if (error) throw new Error(error.message);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: isEdit ? 'Update_Courier' : 'Create_Courier',
      targetEntity: 'courier_partners',
      targetIdentifier: payload.partner_code,
      eventDescription: `${isEdit ? 'Updated' : 'Created'} courier partner ${payload.partner_name} (${payload.partner_code})`,
      justification: 'Courier master management',
    });

    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'courier_partners' } }));
    }
  }

  async saveAppUser(userRecord: any, isEdit: boolean, userName: string, userRole: string) {
    const id = userRecord.id || `USR-${Date.now().toString().slice(-6)}`;
    // Normalize role code if legacy Showroom_Cashier is passed
    let normalizedRole = userRecord.role_code || 'Cashier';
    if (normalizedRole === 'Showroom_Cashier' || normalizedRole === 'Store_Cashier') {
      normalizedRole = 'Cashier';
    }
    const payload: any = {
      ...userRecord,
      id,
      role_code: normalizedRole,
      theme_preference: userRecord.theme_preference || 'Dark',
      is_active: userRecord.is_active ?? true,
    };

    // Helper to securely hash plain text passwords/pins using bcrypt
    const ensureHashed = (val?: string) => {
      if (!val) return undefined;
      if (val.startsWith('$2a$') || val.startsWith('$2b$') || val.startsWith('$2y$')) {
        return val;
      }
      return bcrypt.hashSync(val, 10);
    };

    if (payload.password_hash) {
      payload.password_hash = ensureHashed(payload.password_hash);
    }
    if (payload.lock_pin_hash) {
      payload.lock_pin_hash = ensureHashed(payload.lock_pin_hash);
    }

    if (payload.staff_code && payload.is_active !== false) {
      // Check if linked staff member is active
      try {
        const { data: staffData } = await supabase
          .from('staff_members')
          .select('is_active, first_name, last_name')
          .eq('staff_code', payload.staff_code)
          .maybeSingle();

        if (staffData && staffData.is_active === false) {
          throw new Error(`Cannot grant login access: Linked staff member ${staffData.first_name} ${staffData.last_name} (${payload.staff_code}) is marked as inactive or resigned.`);
        }
      } catch (e: any) {
        if (e.message && e.message.includes('Cannot grant login access')) {
          throw e;
        }
      }
    }

    // Persist staff link in local cache mapping
    try {
      const linksRaw = localStorage.getItem('asopalav_user_staff_links') || '{}';
      const links = JSON.parse(linksRaw);
      if (payload.staff_code) {
        links[id] = payload.staff_code;
        if (payload.username) links[payload.username.toLowerCase()] = payload.staff_code;
      } else {
        delete links[id];
        if (payload.username) delete links[payload.username.toLowerCase()];
      }
      localStorage.setItem('asopalav_user_staff_links', JSON.stringify(links));
    } catch {
      // Ignore local storage errors
    }

    if (isEdit) {
      if (!payload.password_hash) delete payload.password_hash;
      if (!payload.lock_pin_hash) delete payload.lock_pin_hash;
    }

    const executeUserDbOp = async (dataPayload: any) => {
      if (isEdit) {
        const { error: updateErr, data } = await supabase
          .from('app_users')
          .update(dataPayload)
          .eq('id', id)
          .select();

        if (updateErr) {
          throw updateErr;
        }

        if (!data || data.length === 0) {
          const insertData = { ...dataPayload };
          if (!insertData.password_hash) insertData.password_hash = bcrypt.hashSync('Admin@123', 10);
          if (!insertData.lock_pin_hash) insertData.lock_pin_hash = bcrypt.hashSync('1234', 10);
          const { error: insertErr } = await supabase.from('app_users').insert([insertData]);
          if (insertErr) throw insertErr;
        }
      } else {
        const insertData = { ...dataPayload };
        if (!insertData.password_hash) insertData.password_hash = bcrypt.hashSync('Admin@123', 10);
        if (!insertData.lock_pin_hash) insertData.lock_pin_hash = bcrypt.hashSync('1234', 10);
        const { error: insertErr } = await supabase.from('app_users').insert([insertData]);
        if (insertErr) {
          if (insertErr.code === '23505') {
            const { error: updateErr } = await supabase.from('app_users').update(insertData).eq('id', id);
            if (updateErr) throw updateErr;
          } else {
            throw insertErr;
          }
        }
      }
    };

    // Execute with automatic schema cache fallback
    try {
      await executeUserDbOp(payload);
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      if (
        errMsg.includes('staff_code') ||
        errMsg.includes('studio_password') ||
        errMsg.includes('schema cache') ||
        err?.code === 'PGRST204' ||
        err?.code === '42703'
      ) {
        console.warn('Supabase app_users schema cache notice, retrying with core columns:', errMsg);
        const fallbackPayload = { ...payload };
        delete fallbackPayload.staff_code;
        delete fallbackPayload.studio_password;
        try {
          await executeUserDbOp(fallbackPayload);
        } catch (retryErr: any) {
          throw new Error(retryErr?.message || 'Failed to save user account in database.');
        }
      } else {
        throw new Error(errMsg);
      }
    }

    await logSecurityEvent({
      userName,
      userRole,
      actionType: isEdit ? 'Update_User' : 'Create_User',
      targetEntity: 'app_users',
      targetIdentifier: payload.username,
      eventDescription: `${isEdit ? 'Updated' : 'Created'} login account @${payload.username} (${payload.role_code})${payload.staff_code ? ` linked to staff ${payload.staff_code}` : ''}`,
      justification: 'User credentials and RBAC assignment',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:users-roles-updated'));
    }
  }

  async saveStaffMember(staffMember: any, isEdit: boolean, userName: string, userRole: string) {
    if (!staffMember.staff_code || !staffMember.first_name) {
      throw new Error('Staff Code and First Name are required.');
    }

    const branchId = staffMember.branch_id || 'Aellp-ASI';
    const branchCode = staffMember.branch_code || branchId.replace(/^Aellp-/, '') || 'ASI';
    const lastName = (staffMember.last_name || '').trim() || null;
    const designation = (staffMember.designation || '').trim() || null;
    const departmentName = (staffMember.department_name || '').trim() || null;
    
    // Clean mobile number
    let mobileNumber: string | null = null;
    const rawMobile = (staffMember.mobile_number || '').trim();
    if (rawMobile && rawMobile !== '-' && rawMobile !== '+91' && rawMobile.toLowerCase() !== 'null' && rawMobile.toLowerCase() !== 'na') {
      const digits = rawMobile.replace(/[^0-9]/g, '');
      if (digits.length >= 10) {
        const clean10 = digits.startsWith('91') && digits.length > 10 ? digits.slice(2, 12) : digits.slice(0, 10);
        mobileNumber = `+91 ${clean10.slice(0, 5)} ${clean10.slice(5, 10)}`;
      } else if (digits.length > 0) {
        mobileNumber = rawMobile;
      }
    }

    const payload = {
      staff_code: staffMember.staff_code.trim().toUpperCase(),
      first_name: staffMember.first_name.trim(),
      middle_name: staffMember.middle_name ? staffMember.middle_name.trim() : null,
      last_name: lastName,
      avatar_url: staffMember.avatar_url || null,
      mobile_number: mobileNumber,
      branch_id: branchId,
      branch_code: branchCode,
      department_code: staffMember.department_code || null,
      department_name: departmentName,
      designation: designation,
      is_active: staffMember.is_active ?? true,
    };

    const { error } = await supabase.from('staff_members').upsert([payload]);
    if (error) {
      console.error('Staff member upsert error:', error);
      throw new Error(error.message || 'Failed to save staff member in database.');
    }

    // DIRECT CUT: If staff member is marked inactive/quit, immediately revoke login access
    if (payload.is_active === false) {
      try {
        await supabase
          .from('app_users')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .or(`staff_code.eq.${payload.staff_code},id.eq.${payload.staff_code}`);
        
        await logSecurityEvent({
          userName,
          userRole,
          actionType: 'Update_User',
          targetEntity: 'app_users',
          targetIdentifier: payload.staff_code,
          eventDescription: `Directly revoked login access for inactive/resigned staff ${payload.first_name} ${payload.last_name} (${payload.staff_code})`,
          justification: 'Staff departure / inactivation access cutoff',
        });
      } catch (err) {
        console.warn('Could not deactivate linked user login for staff:', err);
      }
    }

    await logSecurityEvent({
      userName,
      userRole,
      actionType: isEdit ? 'Update_User' : 'Create_User',
      targetEntity: 'staff_members',
      targetIdentifier: payload.staff_code,
      eventDescription: `${isEdit ? 'Updated' : 'Added'} staff member ${payload.first_name} ${payload.last_name} (${payload.staff_code})`,
      justification: 'Staff personnel directory update',
    });

    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'staff_members' } }));
      window.dispatchEvent(new Event('asopalav:users-roles-updated'));
    }
  }

  async toggleStaffActiveStatus(
    staffCode: string,
    isActive: boolean,
    staffName: string,
    userName: string,
    userRole: string,
    reason?: string
  ) {
    const { error } = await supabase
      .from('staff_members')
      .update({ is_active: isActive })
      .eq('staff_code', staffCode);
    if (error) throw new Error(error.message);

    if (!isActive) {
      // Direct cut/revocation of all linked login accounts
      try {
        await supabase
          .from('app_users')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .or(`staff_code.eq.${staffCode},id.eq.${staffCode}`);
      } catch (e) {
        console.warn('Error revoking login on staff toggle:', e);
      }
    }

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Update_User',
      targetEntity: 'staff_members',
      targetIdentifier: staffCode,
      eventDescription: isActive
        ? `Reactivated staff profile for ${staffName} (${staffCode})`
        : `Deactivated staff member ${staffName} (${staffCode}) and revoked system login access`,
      justification: reason || (isActive ? 'Staff reinstatement' : 'Staff departure / access cutoff'),
    });

    useVoucherStore.getState().invalidateMasterData();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { table: 'staff_members' } }));
      window.dispatchEvent(new Event('asopalav:users-roles-updated'));
    }
  }

  // --------------------------------------------------------------------------
  // 7. USER & ROLE MANAGEMENT
  // --------------------------------------------------------------------------
  async getAppUsers(): Promise<AppUser[]> {
    let users: AppUser[] = [];
    try {
      const { data } = await supabase
        .from('app_users')
        .select('*')
        .order('created_at', { ascending: true });
      if (data && data.length > 0) {
        users = data.map((u: any) => {
          const { password_hash: _p, lock_pin_hash: _l, studio_password: _s, ...safeUser } = u;
          return safeUser as AppUser;
        });
      }
    } catch (e) {
      console.warn('App users fetch fallback:', e);
    }

    // Merge staff_code mapping from local link registry if column is not yet present on remote DB
    try {
      const linksRaw = localStorage.getItem('asopalav_user_staff_links');
      if (linksRaw) {
        const links = JSON.parse(linksRaw);
        users = users.map((u) => {
          const linkedStaffCode = u.staff_code || links[u.id] || links[u.username?.toLowerCase()];
          return linkedStaffCode ? { ...u, staff_code: linkedStaffCode } : u;
        });
      }
    } catch {
      // Ignore parsing errors
    }

    return users;
  }

  async getAppRoles(): Promise<AppRole[]> {
    try {
      const { data } = await supabase
        .from('app_roles')
        .select('*')
        .order('created_at', { ascending: true });
      if (data && data.length > 0) return data;
    } catch (e) {
      console.warn('App roles fetch fallback:', e);
    }
    return [];
  }

  async getAllRolePermissions(): Promise<RolePermissions[]> {
    try {
      const { data } = await supabase
        .from('role_permissions')
        .select('*');
      if (data && data.length > 0) return data;
    } catch (e) {
      console.warn('Role permissions fetch fallback:', e);
    }
    return [];
  }

  async getRolePermissions(roleCode: string): Promise<RolePermissions | null> {
    try {
      const { data } = await supabase
        .from('role_permissions')
        .select('*')
        .eq('role_code', roleCode)
        .maybeSingle();
      return data || null;
    } catch (e) {
      console.warn('Role permissions fetch single fallback:', e);
      return null;
    }
  }

  async saveRole(
    roleData: { role_code: string; role_title: string; description?: string; is_system_role?: boolean },
    permissionsData: Partial<RolePermissions>,
    isEdit: boolean,
    userName: string,
    userRole: string
  ) {
    const roleCode = roleData.role_code.trim();
    if (!roleCode || !roleData.role_title) {
      throw new Error('Role Code and Role Title are required.');
    }

    // 1. Upsert into app_roles
    const rolePayload = {
      role_code: roleCode,
      role_title: roleData.role_title.trim(),
      description: roleData.description?.trim() || null,
      is_system_role: roleData.is_system_role ?? false,
    };
    const { error: roleError } = await supabase.from('app_roles').upsert([rolePayload]);
    if (roleError) throw new Error(roleError.message);

    // 2. Upsert into role_permissions
    const permPayload = {
      role_code: roleCode,
      can_create_voucher: permissionsData.can_create_voucher ?? true,
      can_void_voucher: permissionsData.can_void_voucher ?? false,
      can_backdate_voucher: permissionsData.can_backdate_voucher ?? false,
      can_disburse_advance: permissionsData.can_disburse_advance ?? false,
      can_settle_advance: permissionsData.can_settle_advance ?? false,
      max_advance_limit: Number(permissionsData.max_advance_limit) || 5000,
      can_inject_float: permissionsData.can_inject_float ?? false,
      can_verify_f9_closing: permissionsData.can_verify_f9_closing ?? false,
      can_export_tally: permissionsData.can_export_tally ?? false,
      can_download_hr_payroll: permissionsData.can_download_hr_payroll ?? false,
      can_view_all_branches: permissionsData.can_view_all_branches ?? false,
      can_view_audit_logs: permissionsData.can_view_audit_logs ?? false,
      can_manage_users_roles: permissionsData.can_manage_users_roles ?? false,
      can_manage_periods: permissionsData.can_manage_periods ?? false,
      updated_at: new Date().toISOString(),
    };
    const { error: permError } = await supabase.from('role_permissions').upsert([permPayload]);
    if (permError) throw new Error(permError.message);

    // 3. Security Audit Log
    await logSecurityEvent({
      userName,
      userRole,
      actionType: isEdit ? 'Update_Role' : 'Create_Role',
      targetEntity: 'app_roles',
      targetIdentifier: roleCode,
      eventDescription: `${isEdit ? 'Updated' : 'Created'} role ${roleData.role_title} (${roleCode})`,
      justification: 'RBAC role and permissions configuration',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:users-roles-updated'));
    }
  }

  async deleteRole(roleCode: string, userName: string, userRole: string) {
    const { error } = await supabase.from('app_roles').delete().eq('role_code', roleCode);
    if (error) throw new Error(error.message);

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Delete_Role',
      targetEntity: 'app_roles',
      targetIdentifier: roleCode,
      eventDescription: `Deleted role ${roleCode}`,
      justification: 'Role removal from system',
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('asopalav:users-roles-updated'));
    }
  }

  async generateNextStaffCode(branchCode: string): Promise<string> {
    try {
      const code = (branchCode || 'ASI').toUpperCase();
      const { data } = await supabase
        .from('staff_members')
        .select('staff_code')
        .eq('branch_code', code);

      let maxNum = 0;
      if (data && data.length > 0) {
        data.forEach((s) => {
          const match = (s.staff_code || '').match(/(\d+)$/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (!isNaN(num) && num > maxNum) {
              maxNum = num;
            }
          }
        });
      }
      const nextNum = maxNum + 1;
      const padded = String(nextNum).padStart(3, '0');
      return `${code}-${padded}`;
    } catch (e) {
      return `${branchCode || 'ASI'}-001`;
    }
  }

  async getStaffMembers(branchId?: string): Promise<StaffMember[]> {
    try {
      let query = supabase
        .from('staff_members')
        .select('*')
        .eq('is_active', true)
        .order('first_name', { ascending: true });

      if (branchId && branchId !== 'ALL') {
        query = query.eq('branch_id', branchId);
      }

      const { data } = await query;
      if (data && data.length > 0) return data;
    } catch (e) {
      console.warn('Staff members fetch fallback:', e);
    }
    return [];
  }

  async getDepartments(includeInactive: boolean = false): Promise<Department[]> {
    try {
      let query = supabase
        .from('departments')
        .select('*')
        .order('department_name', { ascending: true });

      if (!includeInactive) {
        query = query.eq('is_active', true);
      }

      const { data } = await query;
      if (data && data.length > 0) return data;
    } catch (e) {
      console.warn('Departments fetch fallback:', e);
    }
    return [];
  }

  // --------------------------------------------------------------------------
  // 8. BULK MASTER DATA IMPORT
  // --------------------------------------------------------------------------
  async bulkImportMasterData(
    classification: 'categories' | 'departments' | 'couriers' | 'payments' | 'staff' | 'branches',
    records: any[],
    userName: string,
    userRole: string
  ): Promise<{ success: boolean; insertedCount: number; skippedCount?: number; message: string }> {
    if (!records || records.length === 0) {
      return { success: false, insertedCount: 0, message: 'No records to import.' };
    }

    try {
      let targetTable = '';
      let formattedRecords: any[] = [];

      switch (classification) {
        case 'categories':
          targetTable = 'expense_categories';
          formattedRecords = records.map((r) => ({
            category_name: typeof r === 'string' ? r.trim() : (r.category_name || r.name || '').trim(),
            color_theme: r.color_theme || 'Vanilla',
            is_active: true,
          }));
          break;

        case 'departments':
          targetTable = 'departments';
          formattedRecords = records.map((r) => {
            const rawName = typeof r === 'string' ? r.trim() : (r.department_name || r.name || '').trim();
            const rawCode = (typeof r === 'object' && r.department_code) 
              ? r.department_code.trim() 
              : rawName.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 20);
            return {
              department_code: rawCode || 'DEPT',
              department_name: rawName || rawCode,
              is_active: true,
            };
          });
          break;

        case 'couriers':
          targetTable = 'courier_partners';
          formattedRecords = records.map((r) => {
            const rawName = typeof r === 'string' ? r.trim() : (r.partner_name || r.name || '').trim();
            const rawCode = (typeof r === 'object' && r.partner_code)
              ? r.partner_code.trim()
              : rawName.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 20);
            
            let phone: string | null = null;
            const rawPhone = typeof r === 'object' && (r.contact_phone || r.phone || r.mobile) ? String(r.contact_phone || r.phone || r.mobile).trim() : null;
            if (rawPhone && rawPhone !== '-' && rawPhone !== '+91' && rawPhone.toLowerCase() !== 'null' && rawPhone.toLowerCase() !== 'na') {
              const digits = rawPhone.replace(/[^0-9]/g, '');
              if (digits.length >= 10) {
                const clean10 = digits.startsWith('91') && digits.length > 10 ? digits.slice(2, 12) : digits.slice(0, 10);
                phone = `+91 ${clean10.slice(0, 5)} ${clean10.slice(5, 10)}`;
              } else if (digits.length > 0) {
                phone = rawPhone;
              }
            }

            return {
              partner_code: rawCode || 'COU',
              partner_name: rawName,
              contact_phone: phone,
              is_active: true,
            };
          });
          break;

        case 'payments':
          targetTable = 'payment_methods';
          formattedRecords = records.map((r) => ({
            method_name: typeof r === 'string' ? r.trim() : (r.method_name || r.name || '').trim(),
            is_active: true,
          }));
          break;

        case 'staff':
          targetTable = 'staff_members';
          formattedRecords = records.map((r, i) => {
            const code = (r.staff_code || `STF-${1000 + i}`).trim().toUpperCase();
            const firstName = (r.first_name || (r.name ? r.name.split(' ')[0] : '')).trim();
            const middleName = r.middle_name ? String(r.middle_name).trim() : null;
            const lastName = r.last_name ? String(r.last_name).trim() : null;
            
            // Clean mobile number without fake defaults
            let mobile: string | null = null;
            const rawMobile = r.mobile_number || r.mobile || r.phone || r.phone_number || r.contact_phone;
            if (rawMobile) {
              const str = String(rawMobile).trim();
              const digits = str.replace(/[^0-9]/g, '');
              if (digits.length >= 10) {
                const clean10 = digits.startsWith('91') && digits.length > 10 ? digits.slice(2, 12) : digits.slice(0, 10);
                mobile = `+91 ${clean10.slice(0, 5)} ${clean10.slice(5, 10)}`;
              } else if (str !== '-' && str !== '+91' && str.toLowerCase() !== 'null' && str.toLowerCase() !== 'na' && digits.length > 0) {
                mobile = str;
              }
            }

            const departmentName = r.department_name ? String(r.department_name).trim() : null;
            const designation = r.designation ? String(r.designation).trim() : null;
            const branchId = r.branch_id || 'Aellp-ASI';
            const branchCode = r.branch_code || (branchId.replace(/^Aellp-/, '') || 'ASI');

            return {
              staff_code: code,
              first_name: firstName,
              middle_name: middleName || null,
              last_name: lastName || null,
              mobile_number: mobile || null,
              branch_id: branchId,
              branch_code: branchCode,
              department_name: departmentName || null,
              designation: designation || null,
              is_active: r.is_active ?? true,
            };
          });
          break;

        case 'branches':
          targetTable = 'branches';
          formattedRecords = records.map((r) => {
            const code = (r.branch_code || 'ASI').toUpperCase();
            const id = r.branch_id || `Aellp-${code}`;
            return {
              branch_id: id,
              branch_code: code,
              branch_name: r.branch_name || `Asopalav - ${code}`,
              short_name: r.short_name || code,
              entity_company_name: 'Asopalav Endeavours LLP',
              accountant_name: r.accountant_name || 'Showroom Accountant',
              contact_phone: r.contact_phone || '+91 9925009050',
              contact_email: r.contact_email || 'account@asopalav.com',
              city: r.city || 'Ahmedabad',
              state: r.state || 'Gujarat',
              address: r.address || `${code} Showroom, Gujarat`,
              min_cash_threshold: Number(r.min_cash_threshold) || 3000,
              is_active: true,
            };
          });
          break;
      }

      // SMART DUPLICATE CHECK: Query existing database records to prevent duplicate creation
      const existingSet = new Set<string>();
      try {
        if (classification === 'staff') {
          const { data } = await supabase.from('staff_members').select('staff_code');
          (data || []).forEach((s: any) => {
            if (s.staff_code) existingSet.add(s.staff_code.trim().toUpperCase());
          });
        } else if (classification === 'categories') {
          const { data } = await supabase.from('expense_categories').select('category_name');
          (data || []).forEach((c: any) => {
            if (c.category_name) existingSet.add(c.category_name.trim().toLowerCase());
          });
        } else if (classification === 'departments') {
          const { data } = await supabase.from('departments').select('department_code, department_name');
          (data || []).forEach((d: any) => {
            if (d.department_code) existingSet.add(d.department_code.trim().toUpperCase());
            if (d.department_name) existingSet.add(d.department_name.trim().toUpperCase());
          });
        } else if (classification === 'couriers') {
          const { data } = await supabase.from('courier_partners').select('partner_code, partner_name');
          (data || []).forEach((c: any) => {
            if (c.partner_code) existingSet.add(c.partner_code.trim().toUpperCase());
            if (c.partner_name) existingSet.add(c.partner_name.trim().toUpperCase());
          });
        } else if (classification === 'branches') {
          const { data } = await supabase.from('branches').select('branch_code, branch_id');
          (data || []).forEach((b: any) => {
            if (b.branch_code) existingSet.add(b.branch_code.trim().toUpperCase());
            if (b.branch_id) existingSet.add(b.branch_id.trim().toUpperCase());
          });
        }
      } catch (checkErr) {
        console.warn('Could not query existing records prior to bulk import:', checkErr);
      }

      // Separate records into new vs already existing / in-batch duplicates
      const seenInBatch = new Set<string>();
      const newRecords: any[] = [];
      const duplicateRecords: any[] = [];

      for (const rec of formattedRecords) {
        let uniqueKey = '';
        if (classification === 'staff') {
          uniqueKey = (rec.staff_code || '').trim().toUpperCase();
        } else if (classification === 'categories') {
          uniqueKey = (rec.category_name || '').trim().toLowerCase();
        } else if (classification === 'departments') {
          uniqueKey = (rec.department_code || rec.department_name || '').trim().toUpperCase();
        } else if (classification === 'couriers') {
          uniqueKey = (rec.partner_code || rec.partner_name || '').trim().toUpperCase();
        } else if (classification === 'branches') {
          uniqueKey = (rec.branch_code || rec.branch_id || '').trim().toUpperCase();
        }

        if (!uniqueKey || existingSet.has(uniqueKey) || seenInBatch.has(uniqueKey)) {
          duplicateRecords.push(rec);
        } else {
          seenInBatch.add(uniqueKey);
          newRecords.push(rec);
        }
      }

      // If all records already exist in the database, reject the import with an error
      if (newRecords.length === 0) {
        return {
          success: false,
          insertedCount: 0,
          skippedCount: duplicateRecords.length,
          message: `Duplicate Import Rejected: All ${duplicateRecords.length} record(s) already exist in your database. No new records were created.`,
        };
      }

      // Insert only the truly new records into Asopalav
      if (targetTable && newRecords.length > 0) {
        const { error } = await supabase.from(targetTable).insert(newRecords);
        if (error) {
          console.error(`Direct insert error in ${targetTable}:`, error);
          throw new Error(error.message || `Database error while saving records into ${targetTable}.`);
        }

        if (classification === 'branches') {
          const walletRows = newRecords.map((b) => ({
            branch_id: b.branch_id,
            cash_balance: 0,
            upi_balance: 0,
            updated_at: new Date().toISOString(),
          }));
          await supabase.from('branch_wallets').upsert(walletRows);
          useBranchStore.getState().fetchBranchesAndWallets(true);
        }
      }

      // Audit Log
      await logSecurityEvent({
        userName,
        userRole,
        actionType: 'Bulk_Import_Master_Data',
        targetEntity: targetTable || classification,
        targetIdentifier: `${newRecords.length} new records (${duplicateRecords.length} duplicates skipped)`,
        eventDescription: `Bulk imported ${newRecords.length} new records into ${classification} (${duplicateRecords.length} existing in database skipped)`,
        justification: 'Automated Master Data spreadsheet import with duplicate prevention',
      });

      useVoucherStore.getState().invalidateMasterData();
      // Dispatch global window event for live refresh
      window.dispatchEvent(new CustomEvent('asopalav:master-data-updated', { detail: { classification } }));

      return {
        success: true,
        insertedCount: newRecords.length,
        skippedCount: duplicateRecords.length,
        message: duplicateRecords.length > 0
          ? `Imported ${newRecords.length} new record(s). ${duplicateRecords.length} item(s) already exist in the database and were skipped.`
          : `Successfully imported all ${newRecords.length} record(s).`,
      };
    } catch (err: any) {
      console.error('Bulk import error:', err);
      return {
        success: false,
        insertedCount: 0,
        message: err.message || 'Failed to import master data.',
      };
    }
  }

  // --------------------------------------------------------------------------
  // 13. EOD TILL CLOSING & DENOMINATION LOCKS (DATABASE PERSISTENT)
  // --------------------------------------------------------------------------
  async saveEodTillLock(lockData: import('@/types/database').EodTillLockRecord): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const payload = {
        branch_id: lockData.branch_id,
        lock_date: lockData.lock_date,
        slip_id: lockData.slip_id,
        system_cash_balance: lockData.system_cash_balance,
        physical_counted_cash: lockData.physical_counted_cash,
        cash_variance: lockData.cash_variance,
        is_balanced: lockData.is_balanced,
        denominations: lockData.denominations,
        cashier_name: lockData.cashier_name,
        supervisor_name: lockData.supervisor_name,
        notes: lockData.notes || null,
        locked_at: lockData.locked_at || new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('eod_till_locks')
        .upsert([payload], { onConflict: 'branch_id,lock_date' })
        .select()
        .single();

      if (error) {
        console.warn('Database saveEodTillLock notice, keeping local copy:', error.message);
      }

      try {
        localStorage.setItem(`asopalav_eod_lock_${lockData.lock_date}_${lockData.branch_id}`, JSON.stringify(lockData));
      } catch {}

      return { success: true, data: data || lockData };
    } catch (err: any) {
      console.warn('EOD Lock save fallback to local:', err);
      try {
        localStorage.setItem(`asopalav_eod_lock_${lockData.lock_date}_${lockData.branch_id}`, JSON.stringify(lockData));
      } catch {}
      return { success: true, data: lockData };
    }
  }

  async getEodTillLock(branchId: string, lockDate: string): Promise<import('@/types/database').EodTillLockRecord | null> {
    try {
      const { data, error } = await supabase
        .from('eod_till_locks')
        .select('*')
        .eq('branch_id', branchId)
        .eq('lock_date', lockDate)
        .maybeSingle();

      if (!error && data) {
        return {
          id: data.id,
          branch_id: data.branch_id,
          lock_date: data.lock_date,
          slip_id: data.slip_id,
          system_cash_balance: Number(data.system_cash_balance) || 0,
          physical_counted_cash: Number(data.physical_counted_cash) || 0,
          cash_variance: Number(data.cash_variance) || 0,
          is_balanced: data.is_balanced,
          denominations: data.denominations || {},
          cashier_name: data.cashier_name,
          supervisor_name: data.supervisor_name,
          notes: data.notes,
          locked_at: data.locked_at,
          created_at: data.created_at,
        };
      }
    } catch (e) {
      console.warn('getEodTillLock DB lookup error:', e);
    }

    try {
      const raw = localStorage.getItem(`asopalav_eod_lock_${lockDate}_${branchId}`);
      if (raw) return JSON.parse(raw);
    } catch {}

    return null;
  }

  async getAllEodTillLocks(branchId?: string, limit = 1000): Promise<import('@/types/database').EodTillLockRecord[]> {
    try {
      let query = supabase
        .from('eod_till_locks')
        .select('*')
        .order('lock_date', { ascending: false })
        .limit(limit);

      if (branchId && branchId !== 'ALL') {
        query = query.eq('branch_id', branchId);
      }

      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        return data.map((d: any) => ({
          id: d.id,
          branch_id: d.branch_id,
          lock_date: d.lock_date,
          slip_id: d.slip_id,
          system_cash_balance: Number(d.system_cash_balance) || 0,
          physical_counted_cash: Number(d.physical_counted_cash) || 0,
          cash_variance: Number(d.cash_variance) || 0,
          is_balanced: d.is_balanced,
          denominations: d.denominations || {},
          cashier_name: d.cashier_name,
          supervisor_name: d.supervisor_name,
          notes: d.notes,
          locked_at: d.locked_at,
          created_at: d.created_at,
        }));
      }
    } catch (e) {
      console.warn('getAllEodTillLocks DB query fallback:', e);
    }

    const locks: import('@/types/database').EodTillLockRecord[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('asopalav_eod_lock_')) {
          try {
            const parsed = JSON.parse(localStorage.getItem(key) || '{}');
            if (parsed && (!branchId || branchId === 'ALL' || parsed.branchId === branchId || parsed.branch_id === branchId)) {
              locks.push(parsed);
            }
          } catch {}
        }
      }
    } catch {}

    return locks;
  }

  // --------------------------------------------------------------------------
  // BATCH VOUCHER SPLITS LOOKUP (FOR TALLY & SPLIT SCHEDULE REPORT)
  // --------------------------------------------------------------------------
  async getSplitsForVouchers(voucherNumbers: string[]): Promise<Record<string, VoucherSplit[]>> {
    if (!voucherNumbers || voucherNumbers.length === 0) return {};
    const splitsMap: Record<string, VoucherSplit[]> = {};
    try {
      const cleanNumbers = Array.from(new Set(voucherNumbers.filter(Boolean)));
      if (cleanNumbers.length === 0) return {};

      const { data, error } = await supabase
        .from('voucher_splits')
        .select('*')
        .in('voucher_number', cleanNumbers)
        .order('created_at', { ascending: true });

      if (!error && data) {
        data.forEach((s: any) => {
          if (!splitsMap[s.voucher_number]) {
            splitsMap[s.voucher_number] = [];
          }
          splitsMap[s.voucher_number].push({
            id: s.id,
            voucher_number: s.voucher_number,
            branch_id: s.branch_id,
            branch_code: s.branch_code,
            staff_code: s.staff_code,
            staff_name: s.staff_name,
            department_name: s.department_name,
            category_name: s.category_name,
            amount: Number(s.amount) || 0,
            created_at: s.created_at,
          });
        });
      }
    } catch (e) {
      console.warn('getSplitsForVouchers error:', e);
    }
    return splitsMap;
  }

  // --------------------------------------------------------------------------
  // DYNAMIC GST TAX SLABS (SUPABASE BACKED)
  // --------------------------------------------------------------------------
  async getGstTaxRates(onlyActive: boolean = false): Promise<GstTaxRate[]> {
    try {
      let query = supabase
        .from('gst_tax_rates')
        .select('*')
        .order('display_order', { ascending: true });

      if (onlyActive) {
        query = query.eq('is_active', true);
      }

      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        const mapped = data.map((d: any) => ({
          id: d.id,
          rate_percent: Number(d.rate_percent),
          rate_label: d.rate_label,
          is_active: Boolean(d.is_active),
          display_order: Number(d.display_order) || 0,
          created_at: d.created_at,
          updated_at: d.updated_at,
        }));
        try {
          localStorage.setItem('asopalav_gst_tax_rates_cache', JSON.stringify(mapped));
        } catch {}
        return mapped;
      }

      // If table exists in database but has 0 records, attempt automatic seed
      if (!error && data && data.length === 0) {
        try {
          const defaultSeed = [
            { rate_percent: 5, rate_label: '5% (Fabric & Saree Alterations)', is_active: true, display_order: 1 },
            { rate_percent: 12, rate_label: '12% (Readymade Apparel & Packaging)', is_active: true, display_order: 2 },
            { rate_percent: 18, rate_label: '18% (Standard Services & Repairs)', is_active: true, display_order: 3 },
            { rate_percent: 28, rate_label: '28% (Luxury Goods & Special GTA)', is_active: true, display_order: 4 },
          ];
          const { data: seeded, error: seedErr } = await supabase
            .from('gst_tax_rates')
            .insert(defaultSeed)
            .select();
          if (!seedErr && seeded && seeded.length > 0) {
            const mapped = seeded.map((d: any) => ({
              id: d.id,
              rate_percent: Number(d.rate_percent),
              rate_label: d.rate_label,
              is_active: Boolean(d.is_active),
              display_order: Number(d.display_order) || 0,
              created_at: d.created_at,
              updated_at: d.updated_at,
            }));
            try {
              localStorage.setItem('asopalav_gst_tax_rates_cache', JSON.stringify(mapped));
            } catch {}
            return onlyActive ? mapped.filter((s) => s.is_active) : mapped;
          }
        } catch {}
      }
    } catch (e) {
      console.warn('gst_tax_rates DB query error, using defaults:', e);
    }

    // Default standard slabs if table is not yet migrated or offline
    let baseSlabs: GstTaxRate[] = [
      { id: 'gst-5', rate_percent: 5, rate_label: '5% (Fabric & Saree Alterations)', is_active: true, display_order: 1 },
      { id: 'gst-12', rate_percent: 12, rate_label: '12% (Readymade Apparel & Packaging)', is_active: true, display_order: 2 },
      { id: 'gst-18', rate_percent: 18, rate_label: '18% (Standard Services & Repairs)', is_active: true, display_order: 3 },
      { id: 'gst-28', rate_percent: 28, rate_label: '28% (Luxury Goods & Special GTA)', is_active: true, display_order: 4 },
    ];

    try {
      const cached = localStorage.getItem('asopalav_gst_tax_rates_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          baseSlabs = parsed;
        }
      }
    } catch {}

    return onlyActive ? baseSlabs.filter((s) => s.is_active) : baseSlabs;
  }

  async toggleGstRateStatus(id: string, isActive: boolean, userName: string, userRole: string): Promise<boolean> {
    try {
      let query = supabase
        .from('gst_tax_rates')
        .update({ is_active: isActive, updated_at: new Date().toISOString() });

      if (id && !id.startsWith('gst-')) {
        query = query.eq('id', id);
      } else {
        const percent = Number(id.replace('gst-', ''));
        if (!isNaN(percent)) {
          query = query.eq('rate_percent', percent);
        }
      }

      await query;
    } catch (e) {
      console.warn('toggleGstRateStatus DB error:', e);
    }

    // Always keep local cache in sync so UI immediately updates
    try {
      const cached = localStorage.getItem('asopalav_gst_tax_rates_cache');
      let slabs: GstTaxRate[] = cached ? JSON.parse(cached) : [
        { id: 'gst-5', rate_percent: 5, rate_label: '5% (Fabric & Saree Alterations)', is_active: true, display_order: 1 },
        { id: 'gst-12', rate_percent: 12, rate_label: '12% (Readymade Apparel & Packaging)', is_active: true, display_order: 2 },
        { id: 'gst-18', rate_percent: 18, rate_label: '18% (Standard Services & Repairs)', is_active: true, display_order: 3 },
        { id: 'gst-28', rate_percent: 28, rate_label: '28% (Luxury Goods & Special GTA)', is_active: true, display_order: 4 },
      ];
      slabs = slabs.map((s) => {
        if (s.id === id || (id.startsWith('gst-') && s.rate_percent === Number(id.replace('gst-', '')))) {
          return { ...s, is_active: isActive };
        }
        return s;
      });
      localStorage.setItem('asopalav_gst_tax_rates_cache', JSON.stringify(slabs));
    } catch {}

    await logSecurityEvent({
      userName,
      userRole,
      actionType: 'Update_Master_Data' as any,
      targetEntity: 'gst_tax_rates',
      targetIdentifier: id,
      eventDescription: `${isActive ? 'Enabled' : 'Disabled'} GST tax slab ID ${id}`,
      justification: 'Showroom tax configuration updated by admin',
    });

    return true;
  }

  async saveGstTaxRate(
    rate: Partial<GstTaxRate>,
    userName: string,
    userRole: string
  ): Promise<{ success: boolean; data?: GstTaxRate; error?: string }> {
    try {
      const payload = {
        rate_percent: Number(rate.rate_percent),
        rate_label: rate.rate_label || `${rate.rate_percent}% GST Slab`,
        is_active: rate.is_active ?? true,
        display_order: Number(rate.display_order) || 0,
        updated_at: new Date().toISOString(),
      };

      let result: any;
      if (rate.id && !rate.id.startsWith('gst-')) {
        const { data, error } = await supabase
          .from('gst_tax_rates')
          .update(payload)
          .eq('id', rate.id)
          .select()
          .single();
        if (error) throw error;
        result = data;
      } else {
        const { data, error } = await supabase
          .from('gst_tax_rates')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        result = data;
      }

      await logSecurityEvent({
        userName,
        userRole,
        actionType: (rate.id ? 'Update_Master_Data' : 'Create_Master_Data') as any,
        targetEntity: 'gst_tax_rates',
        targetIdentifier: String(rate.rate_percent),
        eventDescription: `Saved GST slab ${rate.rate_percent}% (${payload.rate_label})`,
        justification: 'Admin updated GST tax master data',
      });

      return { success: true, data: result };
    } catch (e: any) {
      console.warn('saveGstTaxRate error:', e);
      return { success: false, error: e.message || 'Failed to save GST rate' };
    }
  }
}

export const erpService = new ERPService();
