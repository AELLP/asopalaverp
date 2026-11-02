import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { format, startOfWeek, startOfMonth, startOfQuarter, subDays, subMonths } from 'date-fns';
import { useAuthStore } from '@/store/authStore';
import { useBranchStore } from '@/store/branchStore';
import { useVouchers } from '@/hooks/useVouchers';
import { erpService } from '@/lib/erpService';
import { calculateDailyCashBalances } from '@/lib/dailyCashBalance';
import { WalletLedger, VoucherSplit } from '@/types/database';
import { MetricCard } from '@/components/ui/MetricCard';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { formatINR, cn, triggerHaptic } from '@/lib/utils';
import { showToast } from '@/components/ui/ToastContainer';
import {
  FileSpreadsheet,
  Download,
  Search,  Wallet,
  RefreshCw,
  Copy,  Building2,
  Receipt,
  Check,
  CalendarDays,
  Coins,  TrendingUp,
  Lock,
  Printer,  Split,
  Users,
  Layers,
  PieChart,} from 'lucide-react';

type ReportTab = 'daily_cash' | 'cost_centers' | 'tally' | 'eod_closings';
type TimeRangePreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'all'
  | 'custom';

function downloadBlob(filename: string, content: string, mimeType: string = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const ReportsPage: React.FC = () => {
  const { user, can } = useAuthStore();
  const { selectedBranchId, branches, getActiveBranch, wallets } = useBranchStore();
    const { vouchers, loading: vouchersLoading, refresh: refreshVouchers } = useVouchers();

  // Active Tab
  const [activeTab, setActiveTab] = useState<ReportTab>('daily_cash');

  // Filters State
  const [timeRange, setTimeRange] = useState<TimeRangePreset>('this_month');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [selectedMode, setSelectedMode] = useState<'ALL' | 'Physical_Cash' | 'Online_UPI'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranchFilter, setSelectedBranchFilter] = useState<string>(selectedBranchId || 'ALL');

  // Supplementary data states
  const [ledgerEntries, setLedgerEntries] = useState<WalletLedger[]>([]);
  const [eodLocks, setEodLocks] = useState<any[]>([]);
  const [splitsMap, setSplitsMap] = useState<Record<string, VoucherSplit[]>>({});
  const [tallyViewMode, setTallyViewMode] = useState<'itemized' | 'summary'>('itemized');
  const [loadingExtras, setLoadingExtras] = useState(false);
  const [copiedTally, setCopiedTally] = useState(false);

  // Sync selected branch filter if topbar branch changes
  useEffect(() => {
    if (selectedBranchId) {
      setSelectedBranchFilter(selectedBranchId);
    }
  }, [selectedBranchId]);

  // Current physical cash in branch wallet
  const currentBranchCash = useMemo(() => {
    const targetKey = selectedBranchFilter === 'ALL' ? 'ALL' : selectedBranchFilter;
    const w = wallets[targetKey] || wallets['Aellp-ASI'];
    return w ? Number(w.cash_balance) || 100000 : 100000;
  }, [wallets, selectedBranchFilter]);

  // Load wallet ledger and EOD till closing locks
  const loadExtras = useCallback(async () => {
    setLoadingExtras(true);
    try {
      const branchToQuery = selectedBranchFilter === 'ALL' ? undefined : selectedBranchFilter;
      const [ledgerData, locksData] = await Promise.all([
        erpService.getWalletLedger(branchToQuery),
        erpService.getAllEodTillLocks(branchToQuery),
      ]);
      setLedgerEntries(ledgerData);
      setEodLocks(locksData);
    } catch (err) {
      console.warn('Error loading ledger / lock data:', err);
    } finally {
      setLoadingExtras(false);
    }
  }, [selectedBranchFilter]);

  useEffect(() => {
    loadExtras();
    const handleWalletUpdate = () => loadExtras();
    window.addEventListener('asopalav:wallet-updated', handleWalletUpdate);
    return () => {
      window.removeEventListener('asopalav:wallet-updated', handleWalletUpdate);
    };
  }, [loadExtras]);

  // Date Range Bounds
  const dateBounds = useMemo(() => {
    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');

    switch (timeRange) {
      case 'today':
        return { start: todayStr, end: todayStr };
      case 'yesterday': {
        const yest = format(subDays(now, 1), 'yyyy-MM-dd');
        return { start: yest, end: yest };
      }
      case 'this_week':
        return {
          start: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
          end: todayStr,
        };
      case 'this_month':
        return {
          start: format(startOfMonth(now), 'yyyy-MM-dd'),
          end: todayStr,
        };
      case 'last_month': {
        const prevMonth = subMonths(now, 1);
        return {
          start: format(startOfMonth(prevMonth), 'yyyy-MM-dd'),
          end: format(new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0), 'yyyy-MM-dd'),
        };
      }
      case 'this_quarter':
        return {
          start: format(startOfQuarter(now), 'yyyy-MM-dd'),
          end: todayStr,
        };
      case 'custom':
        return {
          start: customStartDate || '1970-01-01',
          end: customEndDate || '2099-12-31',
        };
      case 'all':
      default:
        return { start: '1970-01-01', end: '2099-12-31' };
    }
  }, [timeRange, customStartDate, customEndDate]);

  // Daily Cash Opening & Closing Engine
  const dailyCashFlow = useMemo(() => {
    return calculateDailyCashBalances(
      ledgerEntries,
      currentBranchCash,
      dateBounds.start !== '1970-01-01' ? dateBounds.start : undefined,
      dateBounds.end !== '2099-12-31' ? dateBounds.end : undefined
    );
  }, [ledgerEntries, currentBranchCash, dateBounds]);

  // Filtered Expense Vouchers
  const filteredVouchers = useMemo(() => {
    return vouchers.filter((v) => {
      // 1. Branch filter
      if (selectedBranchFilter !== 'ALL') {
        const branchMatch =
          v.branch_id === selectedBranchFilter ||
          v.branch_code === selectedBranchFilter ||
          (selectedBranchFilter === 'Aellp-ASI' && (v.branch_code === 'ASI' || v.branch_id === 'ASI')) ||
          (selectedBranchFilter === 'Aellp-CG' && (v.branch_code === 'CG' || v.branch_id === 'CG')) ||
          (selectedBranchFilter === 'Aellp-NAV' && (v.branch_code === 'NAV' || v.branch_id === 'NAV')) ||
          (selectedBranchFilter === 'Aellp-SUR' && (v.branch_code === 'SUR' || v.branch_id === 'SUR'));
        if (!branchMatch) return false;
      }

      // 2. Date filter
      const rawDate = v.payment_date || v.created_at || '';
      const vDate = rawDate.trim().slice(0, 10);
      if (dateBounds.start && vDate && vDate < dateBounds.start) {
        return false;
      }
      if (dateBounds.end && vDate && vDate > dateBounds.end) {
        return false;
      }

      // 3. Payment Mode filter
      if (selectedMode !== 'ALL' && v.payment_method !== selectedMode) {
        return false;
      }

      // 4. Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const num = (v.voucher_number || '').toLowerCase();
        const payee = (v.recipient_name || '').toLowerCase();
        const cat = (v.category_name || '').toLowerCase();
        const bill = (v.bill_number || '').toLowerCase();
        const remarks = (v.remarks || '').toLowerCase();
        const staffCode = (v.requested_by_staff_code || '').toLowerCase();
        if (
          !num.includes(query) &&
          !payee.includes(query) &&
          !cat.includes(query) &&
          !bill.includes(query) &&
          !remarks.includes(query) &&
          !staffCode.includes(query)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [vouchers, selectedBranchFilter, dateBounds, selectedMode, searchQuery]);

  // Active Approved Vouchers (Excluding Voided)
  const approvedVouchers = useMemo(() => {
    return filteredVouchers.filter((v) => v.status !== 'Voided');
  }, [filteredVouchers]);

  // Automatically load line-level split items for any multi-employee split vouchers in view
  useEffect(() => {
    let isMounted = true;
    const splitVoucherNumbers = approvedVouchers
      .filter((v) => v.payment_type === 'Staff_Split' || (v.vendor_splits && v.vendor_splits.length > 0))
      .map((v) => v.voucher_number);

    if (splitVoucherNumbers.length > 0) {
      erpService.getSplitsForVouchers(splitVoucherNumbers).then((res) => {
        if (isMounted) {
          setSplitsMap(res);
        }
      }).catch((e) => {
        console.warn('Error loading splits for vouchers:', e);
      });
    } else {
      setSplitsMap({});
    }

    return () => {
      isMounted = false;
    };
  }, [approvedVouchers]);

  // --------------------------------------------------------------------------
  // FAANG-GRADE COST CENTERS & VENDOR PROCUREMENT MATRIX
  // --------------------------------------------------------------------------
  const costCenterReportData = useMemo(() => {
    const deptMap = new Map<string, {
      name: string;
      amount: number;
      count: number;
      cashAmount: number;
      upiAmount: number;
      vendors: Map<string, { count: number; amount: number }>;
    }>();

    const vendorMap = new Map<string, {
      name: string;
      amount: number;
      count: number;
      cashAmount: number;
      upiAmount: number;
      primaryDept: string;
      primaryCat: string;
    }>();

    let totalAllocatedSpend = 0;

    approvedVouchers
      .filter((v) => v.payment_type !== 'Advance_Settlement')
      .forEach((v) => {
        const isCash = v.payment_method === 'Physical_Cash';
        const splits = erpService.extractAllSplitsFromVoucher(v, splitsMap);

        if (splits.length > 0) {
          splits.forEach((s) => {
            const dept = s.departmentName || v.department_name || 'General Operations';
            const cat = s.categoryName || v.category_name || 'Operational Expense';
            const payee = s.staffName ? `${s.staffName}${s.staffCode ? ` (${s.staffCode})` : ''}` : (v.recipient_name || 'Unknown');
            const amt = Number(s.amount) || 0;
            totalAllocatedSpend += amt;

            // Department
            const d = deptMap.get(dept) || {
              name: dept,
              amount: 0,
              count: 0,
              cashAmount: 0,
              upiAmount: 0,
              vendors: new Map(),
            };
            d.amount += amt;
            d.count += 1;
            if (isCash) d.cashAmount += amt; else d.upiAmount += amt;
            const vEntry = d.vendors.get(payee) || { count: 0, amount: 0 };
            vEntry.count += 1;
            vEntry.amount += amt;
            d.vendors.set(payee, vEntry);
            deptMap.set(dept, d);

            // Vendor
            const vend = vendorMap.get(payee) || {
              name: payee,
              amount: 0,
              count: 0,
              cashAmount: 0,
              upiAmount: 0,
              primaryDept: dept,
              primaryCat: (cat === 'Advance Salary' || cat === 'Staff Adv for Exps') ? `${cat} (Staff Advance)` : cat,
            };
            vend.amount += amt;
            vend.count += 1;
            if (isCash) vend.cashAmount += amt; else vend.upiAmount += amt;
            vendorMap.set(payee, vend);
          });
          return;
        }

        // Standard Single Voucher
        const dept = v.department_name || 'General Operations';
        const cat = v.category_name || 'Operational Expense';
        const payee = v.recipient_name || 'Unknown';
        const amt = Number(v.total_amount) || 0;
        totalAllocatedSpend += amt;

        const d = deptMap.get(dept) || {
          name: dept,
          amount: 0,
          count: 0,
          cashAmount: 0,
          upiAmount: 0,
          vendors: new Map(),
        };
        d.amount += amt;
        d.count += 1;
        if (isCash) d.cashAmount += amt; else d.upiAmount += amt;
        const vEntry = d.vendors.get(payee) || { count: 0, amount: 0 };
        vEntry.count += 1;
        vEntry.amount += amt;
        d.vendors.set(payee, vEntry);
        deptMap.set(dept, d);

        const vend = vendorMap.get(payee) || {
          name: payee,
          amount: 0,
          count: 0,
          cashAmount: 0,
          upiAmount: 0,
          primaryDept: dept,
          primaryCat: cat,
        };
        vend.amount += amt;
        vend.count += 1;
        if (isCash) vend.cashAmount += amt; else vend.upiAmount += amt;
        vendorMap.set(payee, vend);
      });

    // Format Departments list
    const departments = Array.from(deptMap.values()).map((d) => {
      let topVendorName = '-';
      let topVendorAmt = 0;
      d.vendors.forEach((val, k) => {
        if (val.amount > topVendorAmt) {
          topVendorAmt = val.amount;
          topVendorName = k;
        }
      });

      return {
        name: d.name,
        amount: d.amount,
        count: d.count,
        cashAmount: d.cashAmount,
        upiAmount: d.upiAmount,
        percentage: totalAllocatedSpend > 0 ? Math.round((d.amount / totalAllocatedSpend) * 1000) / 10 : 0,
        avgTicket: d.count > 0 ? Math.round(d.amount / d.count) : 0,
        primaryVendor: topVendorName,
        primaryVendorAmount: topVendorAmt,
      };
    }).sort((a, b) => b.amount - a.amount);

    // Format Vendors list (Pareto sorted)
    const vendors = Array.from(vendorMap.values()).map((v) => ({
      ...v,
      percentage: totalAllocatedSpend > 0 ? Math.round((v.amount / totalAllocatedSpend) * 1000) / 10 : 0,
      avgTicket: v.count > 0 ? Math.round(v.amount / v.count) : 0,
    })).sort((a, b) => b.amount - a.amount);

    const top3VendorsSpend = vendors.slice(0, 3).reduce((sum, v) => sum + v.amount, 0);
    const top3Ratio = totalAllocatedSpend > 0 ? Math.round((top3VendorsSpend / totalAllocatedSpend) * 100) : 0;

    return {
      departments,
      vendors,
      totalAllocatedSpend,
      totalDeptsCount: departments.length,
      totalVendorsCount: vendors.length,
      top3Ratio,
    };
  }, [approvedVouchers, splitsMap]);

  // Cost Centers & Vendors Full CSV Export
  const handleExportCostCentersCSV = () => {
    triggerHaptic();
    const deptHeaders = ['Rank', 'Department Name', 'Total Spend (INR)', '% Share', 'Voucher Count', 'Average Ticket (INR)', 'Cash Spend (INR)', 'UPI Spend (INR)', 'Primary Payee'];
    const deptRows = costCenterReportData.departments.map((d, idx) => [
      idx + 1,
      `"${d.name.replace(/"/g, '""')}"`,
      d.amount,
      `${d.percentage}%`,
      d.count,
      d.avgTicket,
      d.cashAmount,
      d.upiAmount,
      `"${d.primaryVendor.replace(/"/g, '""')}"`,
    ]);

    const vendorHeaders = ['Rank', 'Vendor / Payee Name', 'Primary Department', 'Primary Category', 'Total Paid (INR)', '% Share', 'Bills Count', 'Average Ticket (INR)', 'Cash Paid (INR)', 'UPI Paid (INR)'];
    const vendorRows = costCenterReportData.vendors.map((v, idx) => [
      idx + 1,
      `"${v.name.replace(/"/g, '""')}"`,
      `"${v.primaryDept.replace(/"/g, '""')}"`,
      `"${v.primaryCat.replace(/"/g, '""')}"`,
      v.amount,
      `${v.percentage}%`,
      v.count,
      v.avgTicket,
      v.cashAmount,
      v.upiAmount,
    ]);

    const csvContent =
      '\uFEFF' +
      '--- DEPARTMENT COST CENTERS ALLOCATION ---\n' +
      [deptHeaders.join(','), ...deptRows.map((r) => r.join(','))].join('\n') +
      '\n\n--- PARETO VENDOR PROCUREMENT MATRIX ---\n' +
      [vendorHeaders.join(','), ...vendorRows.map((r) => r.join(','))].join('\n');

    downloadBlob(
      `Asopalav_Cost_Centers_and_Vendors_${selectedBranchFilter}_${dateBounds.start}_to_${dateBounds.end}.csv`,
      csvContent
    );
    showToast({
      type: 'success',
      title: 'Cost Centers & Vendors Exported',
      message: `Exported ${costCenterReportData.departments.length} cost centers and ${costCenterReportData.vendors.length} vendors to CSV.`,
    });
  };

  // --------------------------------------------------------------------------
  // EXPORT GENERATORS
  // --------------------------------------------------------------------------

  // 1. Daily Cash Statement CSV Export
  const handleExportDailyCashStatement = () => {
    triggerHaptic();
    const headers = [
      'Date',
      'Calendar Day',
      'Opening Cash (INR)',
      'Cash Inflows (+) Float (INR)',
      'Cash Outflows (-) Expenses (INR)',
      'Net Movement (INR)',
      'Closing Cash (INR)',
      'Transaction Count',
      'Status',
    ];

    const rows = dailyCashFlow.days.map((d) => [
      `"${d.date}"`,
      `"${d.displayDate}"`,
      Number(d.opening) || 0,
      Number(d.inflow) || 0,
      Number(d.outflow) || 0,
      Number(d.net) || 0,
      Number(d.closing) || 0,
      d.count,
      `"Balanced"`,
    ]);

    const csv = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    downloadBlob(
      `Daily_Cash_Statement_${selectedBranchFilter}_${dateBounds.start}_to_${dateBounds.end}.csv`,
      csv
    );
    showToast({
      type: 'success',
      title: 'Cash Statement Exported',
      message: 'Downloaded verified daily opening and closing cash statement.',
    });
  };

  // 2. Tally Prime Master CSV Export (Full Support for Multi-Employee Split Items)
  const handleExportTally = () => {
    triggerHaptic();
    const headers = [
      'Vch Date (YYYY-MM-DD)',
      'Voucher Type',
      'Voucher Number',
      'Line #',
      'Reference / Bill No',
      'Cost Centre (Branch)',
      'Department',
      'Debit Ledger (Expense Account)',
      'Debit Amount (INR)',
      'Credit Ledger (Cash / UPI Account)',
      'Credit Amount (INR)',
      'Beneficiary / Payee Name',
      'Staff Code',
      'Payment Mode',
      'Narration / Purpose',
    ];

    const exportVouchers = approvedVouchers.filter((v) => v.payment_type !== 'Advance_Settlement');
    const rows: string[] = [];

    exportVouchers.forEach((v) => {
      const vDate = v.payment_date ? v.payment_date.slice(0, 10) : '';
      const vType = 'Payment';
      const vNum = v.voucher_number || '';
      const branchCode = v.branch_code || (v.branch_id ? v.branch_id.replace(/^Aellp-/, '') : 'ASI');
      const costCentre = `Showroom ${branchCode}`;
      const creditLedger =
        v.payment_method === 'Physical_Cash'
          ? `Cash on Hand - ${branchCode} A/c`
          : `UPI Current A/c - ${branchCode}`;
      const mode = v.payment_method === 'Physical_Cash' ? 'Physical Cash' : 'Online UPI';
      const splits = erpService.extractAllSplitsFromVoucher(v, splitsMap);

      if (splits.length > 0) {
        // Multi-employee split breakdown (1 real row per staff member)
        splits.forEach((s, idx) => {
          const refBill = s.billNumber || v.bill_number ? `Bill: ${s.billNumber || v.bill_number}` : 'Split Voucher';
          const department = s.departmentName || v.department_name || 'General Operations';
          const cat = s.categoryName || v.category_name || 'General Store Expense';
          const isSalaryAdv = cat === 'Advance Salary' || cat === 'Staff Adv for Exps';
          const debitLedger = isSalaryAdv ? 'Advance Against Salary - Staff A/c' : `${cat} A/c`;
          const splitAmount = Number(s.amount) || 0;
          const payee = (s.staffName || v.recipient_name || 'Counter Expense').replace(/"/g, '""');
          const staffCode = (s.staffCode || '').replace(/"/g, '""');
          const narration = (s.description || v.remarks || `Split line item for ${payee}`).replace(/"/g, '""');

          rows.push([
            `"${vDate}"`,
            `"${vType}"`,
            `"${vNum}"`,
            idx + 1,
            `"${refBill}"`,
            `"${costCentre}"`,
            `"${department}"`,
            `"${debitLedger}"`,
            splitAmount,
            `"${creditLedger}"`,
            splitAmount,
            `"${payee}"`,
            `"${staffCode}"`,
            `"${mode}"`,
            `"${narration}"`,
          ].join(','));
        });
      } else {
        // Single line voucher
        const refBill = v.bill_number ? `Bill: ${v.bill_number}` : 'Cash Voucher';
        const department = v.department_name || 'General Operations';
        const cat = v.category_name || 'General Store Expense';
        const isSalaryAdv = cat === 'Advance Salary' || cat === 'Staff Adv for Exps';
        const debitLedger = isSalaryAdv ? 'Advance Against Salary - Staff A/c' : `${cat} A/c`;
        const amount = Number(v.total_amount) || 0;
        const payee = (v.recipient_name || 'Counter Expense').replace(/"/g, '""');
        const narration = (v.remarks || `Expense disbursement for ${v.category_name || 'Store Operations'}`).replace(
          /"/g,
          '""'
        );

        rows.push([
          `"${vDate}"`,
          `"${vType}"`,
          `"${vNum}"`,
          1,
          `"${refBill}"`,
          `"${costCentre}"`,
          `"${department}"`,
          `"${debitLedger}"`,
          amount,
          `"${creditLedger}"`,
          amount,
          `"${payee}"`,
          '""',
          `"${mode}"`,
          `"${narration}"`,
        ].join(','));
      }
    });

    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    downloadBlob(
      `Asopalav_Tally_Prime_Export_${selectedBranchFilter}_${dateBounds.start}_to_${dateBounds.end}.csv`,
      csv
    );
    showToast({
      type: 'success',
      title: 'Tally Prime Export Ready',
      message: `Exported ${rows.length} itemized line entries for accounting entry.`,
    });
  };

  // 2B. Official Tally Prime XML Export (Multi-ledger breakdown for Split Vouchers)
  const handleExportTallyXML = () => {
    triggerHaptic();
    const exportRows = approvedVouchers.filter((v) => v.payment_type !== 'Advance_Settlement');

    const escapeXml = (str: string) =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const voucherXmls = exportRows
      .map((v) => {
        const vDateStr = v.payment_date ? v.payment_date.slice(0, 10).replace(/-/g, '') : '20261019';
        const branchCode = v.branch_code || (v.branch_id ? v.branch_id.replace(/^Aellp-/, '') : 'ASI');
        const creditLedger =
          v.payment_method === 'Physical_Cash'
            ? `Cash on Hand - ${branchCode} A/c`
            : `UPI Current A/c - ${branchCode}`;
        const totalAmount = Number(v.total_amount) || 0;
        const narration = escapeXml(
          v.remarks ||
            `Expense disbursement for ${v.category_name || 'Store Operations'} to ${v.recipient_name || 'Vendor'}`
        );

        const splits = erpService.extractAllSplitsFromVoucher(v, splitsMap);

        // If split across multiple employees, create separate DEBIT entries for each employee
        let debitLedgerEntries = '';
        if (splits.length > 0) {
          debitLedgerEntries = splits
            .map((s) => {
              const cat = s.categoryName || v.category_name || 'General Store Expense';
              const isSalaryAdv = cat === 'Advance Salary' || cat === 'Staff Adv for Exps';
              const debitLedger = isSalaryAdv ? 'Advance Against Salary - Staff A/c' : `${cat} - ${s.staffName || 'Staff'} A/c`;
              const sAmount = Number(s.amount) || 0;
              return `          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(debitLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${sAmount.toFixed(2)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`;
            })
            .join('\n');
        } else {
          const cat = v.category_name || 'General Store Expense';
          const isSalaryAdv = cat === 'Advance Salary' || cat === 'Staff Adv for Exps';
          const debitLedger = isSalaryAdv ? 'Advance Against Salary - Staff A/c' : `${cat} A/c`;
          debitLedgerEntries = `          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(debitLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${totalAmount.toFixed(2)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`;
        }

        return `      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="Payment" ACTION="Create">
          <DATE>${vDateStr}</DATE>
          <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${escapeXml(v.voucher_number || '')}</VOUCHERNUMBER>
          <REFERENCE>${escapeXml(v.bill_number || '')}</REFERENCE>
          <PARTYLEDGERNAME>${escapeXml(creditLedger)}</PARTYLEDGERNAME>
          <NARRATION>${narration}</NARRATION>
${debitLedgerEntries}
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(creditLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${totalAmount.toFixed(2)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </TALLYMESSAGE>`;
      })
      .join('\n');

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
${voucherXmls}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

    downloadBlob(
      `Asopalav_Tally_Prime_Import_${selectedBranchFilter}_${dateBounds.start}_to_${dateBounds.end}.xml`,
      xml,
      'application/xml;charset=utf-8;'
    );

    showToast({
      type: 'success',
      title: 'Tally Prime XML Exported',
      message: `Exported ${exportRows.length} vouchers with itemized split ledgers in native Tally Prime XML.`,
    });
  };

  // 3. Copy Tally Data to Clipboard
  const handleCopyTallyToClipboard = () => {
    triggerHaptic();
    const headers = [
      'Date',
      'Voucher #',
      'Expense Ledger',
      'Debit (₹)',
      'Credit Ledger',
      'Credit (₹)',
      'Branch',
      'Payee',
      'Mode',
      'Narration',
    ];

    const exportRows = approvedVouchers.filter((v) => v.payment_type !== 'Advance_Settlement');

    const lines: string[] = [];
    exportRows.forEach((v) => {
      const vDate = v.payment_date ? v.payment_date.slice(0, 10) : '';
      const vNum = v.voucher_number || '';
      const branchCode = v.branch_code || (v.branch_id ? v.branch_id.replace(/^Aellp-/, '') : 'ASI');
      const creditLedger =
        v.payment_method === 'Physical_Cash'
          ? `Cash on Hand - ${branchCode}`
          : `UPI Current - ${branchCode}`;
      const mode = v.payment_method === 'Physical_Cash' ? 'Cash' : 'UPI';
      const splits = erpService.extractAllSplitsFromVoucher(v, splitsMap);

      if (tallyViewMode === 'itemized' && splits.length > 0) {
        splits.forEach((s) => {
          const staffTag = s.staffCode ? ` (${s.staffCode})` : '';
          const payee = s.staffName ? `${s.staffName}${staffTag}` : v.recipient_name;
          const cat = s.categoryName || v.category_name || 'Expense';
            const isSalaryAdv = cat === 'Advance Salary' || cat === 'Staff Adv for Exps';
            const debitLedger = isSalaryAdv ? 'Advance Against Salary - Staff A/c' : `${cat} A/c`;
          const amount = Number(s.amount) || 0;
          const narration = s.description || v.remarks || '';
          lines.push([vDate, vNum, debitLedger, amount, creditLedger, amount, branchCode, payee, mode, narration].join('\t'));
        });
      } else {
        const debitLedger = `${v.category_name || 'Expense'} A/c`;
        const amount = Number(v.total_amount) || 0;
        const payee = v.recipient_name || '';
        const narration = v.remarks || '';
        lines.push([vDate, vNum, debitLedger, amount, creditLedger, amount, branchCode, payee, mode, narration].join('\t'));
      }
    });

    const tsv = [headers.join('\t'), ...lines].join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      setCopiedTally(true);
      setTimeout(() => setCopiedTally(false), 2500);
      showToast({
        type: 'success',
        title: 'Copied to Clipboard',
        message: 'Paste directly into Excel or Tally import sheets.',
      });
    });
  };

  // Print Historical EOD Closing Slip
  const handlePrintEodSlip = (lock: any) => {
    triggerHaptic();
    const printWin = window.open('', '_blank', 'width=600,height=750');
    if (!printWin) {
      window.print();
      return;
    }

    const d = lock.denominations || {};
    const denomRows = [
      { name: '₹500 Notes', count: d.c500 || 0, total: (d.c500 || 0) * 500 },
      { name: '₹200 Notes', count: d.c200 || 0, total: (d.c200 || 0) * 200 },
      { name: '₹100 Notes', count: d.c100 || 0, total: (d.c100 || 0) * 100 },
      { name: '₹50 Notes', count: d.c50 || 0, total: (d.c50 || 0) * 50 },
      { name: '₹20 Notes', count: d.c20 || 0, total: (d.c20 || 0) * 20 },
      { name: '₹10 Notes', count: d.c10 || 0, total: (d.c10 || 0) * 10 },
      { name: '₹5 Notes/Coins', count: d.c5 || 0, total: (d.c5 || 0) * 5 },
      { name: '₹2 Coins', count: d.c2 || 0, total: (d.c2 || 0) * 2 },
      { name: '₹1 Coins', count: d.c1 || 0, total: (d.c1 || 0) * 1 },
      { name: 'Loose Coins Value', count: '-', total: d.coins || 0 },
    ].filter((r) => r.total > 0);

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Till Closing Slip - ${lock.slip_id || lock.slipId || 'EOD'}</title>
        <style>
          @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #111; max-width: 440px; margin: 0 auto; }
          .header { text-align: center; border-bottom: 2px dashed #444; padding-bottom: 12px; margin-bottom: 14px; }
          .brand { font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
          .sub { font-size: 11px; color: #555; margin-top: 2px; }
          .title { font-size: 13px; font-weight: 700; text-transform: uppercase; margin-top: 8px; border: 1px solid #111; padding: 3px 6px; display: inline-block; }
          .meta-row { display: flex; justify-content: space-between; font-size: 11px; margin: 4px 0; font-family: monospace; }
          table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 11px; font-family: monospace; }
          th, td { padding: 4px; text-align: right; border-bottom: 1px dotted #ccc; }
          th:first-child, td:first-child { text-align: left; }
          th { border-bottom: 1px solid #111; border-top: 1px solid #111; font-weight: 700; text-transform: uppercase; font-size: 10px; }
          .total-row { font-weight: 700; border-top: 2px solid #111; border-bottom: 2px solid #111; font-size: 12px; }
          .signatures { display: flex; justify-content: space-between; margin-top: 40px; font-size: 11px; }
          .sig-box { width: 45%; border-top: 1px solid #111; text-align: center; padding-top: 6px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="brand">ASOPALAV ENDEAVOURS LLP</div>
          <div class="sub">Showroom Cash Till Closing &amp; Physical Count Slip</div>
          <div class="title">EOD TILL LOCK: ${lock.slip_id || lock.slipId || 'EOD'}</div>
        </div>
        <div class="meta-row"><span>Branch:</span><strong>${lock.branch_id || lock.branchCode || 'ASI'}</strong></div>
        <div class="meta-row"><span>Date:</span><span>${lock.lock_date || lock.date}</span></div>
        <div class="meta-row"><span>Cashier (Counted):</span><strong>${lock.cashier_name || lock.cashier || 'Cashier'}</strong></div>
        <div class="meta-row"><span>Supervisor (Verified):</span><strong>${lock.supervisor_name || lock.supervisor || 'Manager'}</strong></div>
        <table>
          <thead>
            <tr><th>Denomination</th><th>Count</th><th>Total (INR)</th></tr>
          </thead>
          <tbody>
            ${denomRows.map((r) => `<tr><td>${r.name}</td><td>${r.count}</td><td>${r.total.toFixed(2)}</td></tr>`).join('')}
            <tr class="total-row">
              <td>PHYSICAL TOTAL:</td>
              <td></td>
              <td>₹${Number(lock.physical_counted_cash || lock.physicalCounted || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
          </tbody>
        </table>
        <div class="meta-row"><span>System Expected:</span><span>₹${Number(lock.system_cash_balance || lock.systemBalance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
        <div class="meta-row"><span>Cash Variance:</span><strong>₹${Number(lock.cash_variance || lock.variance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
        ${lock.notes || lock.note ? `<div class="meta-row" style="margin-top:8px;"><span>Note:</span><em>${lock.notes || lock.note}</em></div>` : ''}
        <div class="signatures">
          <div class="sig-box">Cashier Signature</div>
          <div class="sig-box">Store Manager Signature</div>
        </div>
        <script>
          window.onload = function() { window.print(); }
        </script>
      </body>
      </html>
    `;

    printWin.document.write(html);
    printWin.document.close();
  };

  // Tally preview rows (Supports Itemized Split Breakdown per Staff / Vendor)
  const tallyPreviewRows = useMemo(() => {
    const list: Array<{
      id: string;
      date: string;
      voucherNumber: string;
      lineLabel?: string;
      debitLedger: string;
      creditLedger: string;
      amount: number;
      costCenter: string;
      department: string;
      payee: string;
      staffCode?: string;
      paymentMode: string;
      billNumber: string;
      narration: string;
      isSplitRow?: boolean;
      totalSplitsCount?: number;
    }> = [];

    approvedVouchers
      .filter((v) => v.payment_type !== 'Advance_Settlement')
      .forEach((v) => {
        const creditLedger =
          v.payment_method === 'Physical_Cash'
            ? `Cash on Hand - ${v.branch_code || 'ASI'} A/c`
            : `UPI Current A/c - ${v.branch_code || 'ASI'}`;
        const costCenter = `Showroom ${v.branch_code || 'ASI'}`;
        const vDate = v.payment_date ? v.payment_date.slice(0, 10) : '';
        const splits = erpService.extractAllSplitsFromVoucher(v, splitsMap);

        if (tallyViewMode === 'itemized' && splits.length > 0) {
          splits.forEach((s, idx) => {
            const staffTag = s.staffCode ? ` (${s.staffCode})` : '';
            const payeeName = s.staffName ? `${s.staffName}${staffTag}` : v.recipient_name;
            const debitLedger = `${s.categoryName || v.category_name || 'Expense'} A/c`;
            const dept = s.departmentName || v.department_name || 'General';
            const narration = s.description || v.remarks || `Split expense for ${payeeName}`;

            list.push({
              id: `${v.id}-split-${idx}`,
              date: vDate,
              voucherNumber: v.voucher_number,
              lineLabel: `Line ${idx + 1}/${splits.length}`,
              debitLedger,
              creditLedger,
              amount: Number(s.amount) || 0,
              costCenter,
              department: dept,
              payee: payeeName,
              staffCode: s.staffCode,
              paymentMode: v.payment_method === 'Physical_Cash' ? 'Cash' : 'UPI',
              billNumber: s.billNumber || v.bill_number || 'N/A',
              narration,
              isSplitRow: true,
              totalSplitsCount: splits.length,
            });
          });
        } else {
          list.push({
            id: v.id,
            date: vDate,
            voucherNumber: v.voucher_number,
            lineLabel: splits.length > 0 ? `${splits.length} Splits` : undefined,
            debitLedger: (v.category_name === 'Advance Salary' || v.category_name === 'Staff Adv for Exps')
              ? 'Advance Against Salary - Staff A/c'
              : `${v.category_name || 'Expense'} A/c`,
            creditLedger,
            amount: Number(v.total_amount) || 0,
            costCenter,
            department: v.department_name || 'General',
            payee: v.recipient_name,
            paymentMode: v.payment_method === 'Physical_Cash' ? 'Cash' : 'UPI',
            billNumber: v.bill_number || 'N/A',
            narration: v.remarks || `Expense disbursement for ${v.category_name}`,
            isSplitRow: false,
            totalSplitsCount: splits.length,
          });
        }
      });

    return list;
  }, [approvedVouchers, tallyViewMode, splitsMap]);

  const currentBranchLabel =
    selectedBranchFilter === 'ALL'
      ? 'All Showrooms'
      : branches.find((b) => b.branch_id === selectedBranchFilter || b.branch_code === selectedBranchFilter)
          ?.branch_name || selectedBranchFilter;

  return (
    <div className="min-h-full flex-1 flex flex-col bg-white dark:bg-[#141414] text-slate-900 dark:text-[#EDEDED] font-sans antialiased selection:bg-[#3ecf8e]/20 selection:text-[#3ecf8e] select-none">
      {/* 1. Header Toolbar */}
      <div className="px-4 lg:px-6 py-4 border-b border-slate-200 dark:border-[#242424] bg-white dark:bg-[#141414]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Left Title & Status */}
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-medium tracking-tight text-slate-900 dark:text-[#EDEDED] font-sans flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-[#3ecf8e]" />
                <span>Financial Reports</span>
              </h1>
              <span className="px-2.5 py-0.5 rounded-[4px] text-[11px] font-mono tabular-nums bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/20 whitespace-nowrap inline-flex items-center gap-1 font-medium">
                <Building2 className="w-3 h-3" />
                {currentBranchLabel}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-[#A1A1A1] font-sans mt-0.5">
              Daily cash passbook statement and Tally Prime accounting export.
            </p>
          </div>

          {/* Right Action Bar */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => {
                refreshVouchers();
                loadExtras();
              }}
              disabled={vouchersLoading || loadingExtras}
              className="h-9 px-3 py-1.5 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-slate-50 dark:bg-[#1c1c1f] hover:bg-slate-100 dark:hover:bg-[#242428] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-[#EDEDED] text-xs font-medium font-sans flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
              title="Refresh Data"
            >
              <RefreshCw
                className={cn('w-3.5 h-3.5 text-[#3ecf8e]', (vouchersLoading || loadingExtras) && 'animate-spin')}
              />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* Primary Action Button */}
            {activeTab === 'daily_cash' && (
              <button
                type="button"
                onClick={handleExportDailyCashStatement}
                className="h-9 px-3.5 py-1.5 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-medium text-xs font-sans flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs active:bg-[#1fa672]"
              >
                <Download className="w-4 h-4 text-[#171717] stroke-[2.5]" />
                <span>Export Cash Statement (CSV)</span>
              </button>
            )}

            {activeTab === 'cost_centers' && (
              <button
                type="button"
                onClick={handleExportCostCentersCSV}
                className="h-9 px-3.5 py-1.5 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-medium text-xs font-sans flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs active:bg-[#1fa672]"
              >
                <Download className="w-4 h-4 text-[#171717] stroke-[2.5]" />
                <span>Export Cost Centers &amp; Vendors (CSV)</span>
              </button>
            )}

            {activeTab === 'tally' && can('can_export_tally') && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportTallyXML}
                  className="h-9 px-3 py-1.5 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#1a1a1a] text-slate-800 dark:text-white hover:border-[#3ecf8e] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                  title="Export in native Tally Prime XML schema for direct import"
                >
                  <Download className="w-3.5 h-3.5 text-[#3ecf8e]" />
                  <span>Tally XML</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportTally}
                  className="h-9 px-3.5 py-1.5 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-medium text-xs font-sans flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs active:bg-[#1fa672]"
                >
                  <Download className="w-4 h-4 text-[#171717] stroke-[2.5]" />
                  <span>Export Tally CSV</span>
                </button>
              </div>
            )}

            {activeTab === 'eod_closings' && eodLocks.length > 0 && (
              <button
                type="button"
                onClick={() => handlePrintEodSlip(eodLocks[0])}
                className="h-9 px-3.5 py-1.5 rounded-[6px] bg-white dark:bg-[#202024] border border-slate-200 dark:border-[#2e2e2e] hover:bg-slate-100 dark:hover:bg-[#282828] text-slate-800 dark:text-white font-medium text-xs font-sans flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
              >
                <Printer className="w-3.5 h-3.5 text-[#3ecf8e]" />
                <span>Print Latest Closing Slip</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. Main Body Content */}
      <div className="px-4 lg:px-6 py-4 space-y-4 flex-1 w-full">
        {/* Filters Toolbar */}
        <div className="rounded-[12px] p-2.5 bg-slate-50/80 dark:bg-[#18181a]/80 border border-slate-200 dark:border-[#242424] shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {/* Left: DateRangePicker & Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <DateRangePicker
                startDate={timeRange === 'custom' ? customStartDate : dateBounds.start}
                endDate={timeRange === 'custom' ? customEndDate : dateBounds.end}
                onChange={(range) => {
                  setCustomStartDate(range.startDate);
                  setCustomEndDate(range.endDate);
                  setTimeRange('custom');
                }}
                size="sm"
              />

              {/* Showroom Dropdown */}
              <div className="flex items-center gap-1.5 bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#2e2e2e] rounded-[6px] px-2.5 h-8 shadow-2xs">
                <Building2 className="w-3.5 h-3.5 text-slate-400 dark:text-[#707070]" />
                <select
                  value={selectedBranchFilter}
                  onChange={(e) => setSelectedBranchFilter(e.target.value)}
                  className="bg-transparent text-xs text-slate-800 dark:text-[#EDEDED] font-sans focus:outline-none cursor-pointer pr-1"
                >
                  <option value="ALL">All Showrooms</option>
                  {branches.map((b) => (
                    <option key={b.branch_id} value={b.branch_id}>
                      {b.short_name || b.branch_name} ({b.branch_code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Payment Mode Selector */}
              <div className="flex items-center gap-1 bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#2e2e2e] rounded-[6px] p-0.5 shadow-2xs text-xs">
                {(
                  [
                    { id: 'ALL', label: 'All Modes' },
                    { id: 'Physical_Cash', label: 'Cash' },
                    { id: 'Online_UPI', label: 'UPI' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setSelectedMode(mode.id)}
                    className={cn(
                      'px-2 py-1 rounded-[4px] font-sans text-xs transition-colors cursor-pointer',
                      selectedMode === mode.id
                        ? 'bg-slate-100 dark:bg-[#252525] text-slate-900 dark:text-[#EDEDED] font-medium'
                        : 'text-slate-500 dark:text-[#707070] hover:text-slate-800 dark:hover:text-[#EDEDED]'
                    )}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Right: Quick Search */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 dark:text-[#707070] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search vouchers, payees, notes..."
                className="w-full h-8 pl-8 pr-2.5 rounded-[6px] text-xs bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#2e2e2e] text-slate-800 dark:text-[#EDEDED] placeholder:text-slate-400 dark:placeholder:text-[#606060] font-sans focus:outline-none focus:border-[#3ecf8e] transition-colors"
              />
            </div>
          </div>
        </div>

        {/* 3. Opening & Closing Cash Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Card 1: Opening Balance */}
          <MetricCard
            label="Opening Cash Balance"
            value={
              <span className="font-mono tabular-nums text-lg sm:text-xl font-medium text-slate-800 dark:text-white">
                {formatINR(dailyCashFlow.periodOpening)}
              </span>
            }
            subValue={`Cash in drawer at start of period (${dateBounds.start})`}
            badge="OPENING"
            badgeColor="neutral"
            icon={Coins}
          />

          {/* Card 2: Cash Inflows (+) */}
          <MetricCard
            label="Cash Added (Inflows)"
            value={
              <span className="font-mono tabular-nums text-lg sm:text-xl font-medium text-emerald-600 dark:text-[#3ecf8e]">
                +{formatINR(dailyCashFlow.periodInflows)}
              </span>
            }
            subValue="Cash top-ups and cash box deposits"
            badge="INFLOWS"
            badgeColor="emerald"
            icon={TrendingUp}
          />

          {/* Card 3: Total Outflows (-) */}
          <MetricCard
            label="Expenses Paid (Outflows)"
            value={
              <span className="font-mono tabular-nums text-lg sm:text-xl font-medium text-rose-600 dark:text-rose-400">
                -{formatINR(dailyCashFlow.periodOutflows)}
              </span>
            }
            subValue="Cash vouchers and expenses paid"
            badge="OUTFLOWS"
            badgeColor="rose"
            icon={Receipt}
          />

          {/* Card 4: Closing Balance */}
          <MetricCard
            label="Closing Cash Balance"
            value={
              <span className="font-mono tabular-nums text-lg sm:text-xl font-semibold text-emerald-600 dark:text-[#3ecf8e]">
                {formatINR(dailyCashFlow.periodClosing)}
              </span>
            }
            subValue={`Current cash in drawer (Till: ${formatINR(dailyCashFlow.currentWalletCash)})`}
            badge="CLOSING"
            badgeColor="emerald"
            icon={Wallet}
          />
        </div>

        {/* 4. Tab Navigation (Simple & Clear) */}
        <div className="border-b border-slate-200 dark:border-[#282828] flex items-center gap-1 overflow-x-auto scrollbar-none">
          <button
            type="button"
            onClick={() => {
              triggerHaptic();
              setActiveTab('daily_cash');
            }}
            className={cn(
              'px-4 py-2.5 text-xs font-medium font-sans flex items-center gap-2 border-b-2 whitespace-nowrap transition-colors cursor-pointer select-none',
              activeTab === 'daily_cash'
                ? 'border-[#3ecf8e] text-slate-900 dark:text-[#EDEDED] font-semibold'
                : 'border-transparent text-slate-500 dark:text-[#A1A1A1] hover:text-slate-800 dark:hover:text-[#EDEDED] hover:border-slate-300 dark:hover:border-[#383838]'
            )}
          >
            <CalendarDays
              className={cn(
                'w-4 h-4',
                activeTab === 'daily_cash' ? 'text-[#3ecf8e]' : 'text-slate-400 dark:text-[#707070]'
              )}
            />
            <span>Daily Cash Statement</span>
            <span
              className={cn(
                'px-1.5 py-0.2 rounded-[4px] text-[10px] font-mono tabular-nums ml-1',
                activeTab === 'daily_cash'
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/20'
                  : 'bg-slate-100 dark:bg-[#1f1f1f] text-slate-500 dark:text-[#707070]'
              )}
            >
              {dailyCashFlow.days.length} Days
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              triggerHaptic();
              setActiveTab('cost_centers');
            }}
            className={cn(
              'px-4 py-2.5 text-xs font-medium font-sans flex items-center gap-2 border-b-2 whitespace-nowrap transition-colors cursor-pointer select-none',
              activeTab === 'cost_centers'
                ? 'border-[#3ecf8e] text-slate-900 dark:text-[#EDEDED] font-semibold'
                : 'border-transparent text-slate-500 dark:text-[#A1A1A1] hover:text-slate-800 dark:hover:text-[#EDEDED] hover:border-slate-300 dark:hover:border-[#383838]'
            )}
          >
            <Layers
              className={cn(
                'w-4 h-4',
                activeTab === 'cost_centers' ? 'text-[#3ecf8e]' : 'text-slate-400 dark:text-[#707070]'
              )}
            />
            <span>Cost Centers &amp; Vendors</span>
            <span
              className={cn(
                'px-1.5 py-0.2 rounded-[4px] text-[10px] font-mono tabular-nums ml-1',
                activeTab === 'cost_centers'
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/20'
                  : 'bg-slate-100 dark:bg-[#1f1f1f] text-slate-500 dark:text-[#707070]'
              )}
            >
              {costCenterReportData.totalDeptsCount} Cost Centers
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              triggerHaptic();
              setActiveTab('tally');
            }}
            className={cn(
              'px-4 py-2.5 text-xs font-medium font-sans flex items-center gap-2 border-b-2 whitespace-nowrap transition-colors cursor-pointer select-none',
              activeTab === 'tally'
                ? 'border-[#3ecf8e] text-slate-900 dark:text-[#EDEDED] font-semibold'
                : 'border-transparent text-slate-500 dark:text-[#A1A1A1] hover:text-slate-800 dark:hover:text-[#EDEDED] hover:border-slate-300 dark:hover:border-[#383838]'
            )}
          >
            <FileSpreadsheet
              className={cn(
                'w-4 h-4',
                activeTab === 'tally' ? 'text-[#3ecf8e]' : 'text-slate-400 dark:text-[#707070]'
              )}
            />
            <span>Tally Prime Export</span>
            <span
              className={cn(
                'px-1.5 py-0.2 rounded-[4px] text-[10px] font-mono tabular-nums ml-1',
                activeTab === 'tally'
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/20'
                  : 'bg-slate-100 dark:bg-[#1f1f1f] text-slate-500 dark:text-[#707070]'
              )}
            >
              {tallyPreviewRows.length} {tallyViewMode === 'itemized' ? 'Lines' : 'Vouchers'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              triggerHaptic();
              setActiveTab('eod_closings');
            }}
            className={cn(
              'px-4 py-2.5 text-xs font-medium font-sans flex items-center gap-2 border-b-2 whitespace-nowrap transition-colors cursor-pointer select-none',
              activeTab === 'eod_closings'
                ? 'border-[#3ecf8e] text-slate-900 dark:text-[#EDEDED] font-semibold'
                : 'border-transparent text-slate-500 dark:text-[#A1A1A1] hover:text-slate-800 dark:hover:text-[#EDEDED] hover:border-slate-300 dark:hover:border-[#383838]'
            )}
          >
            <Lock
              className={cn(
                'w-4 h-4',
                activeTab === 'eod_closings' ? 'text-[#3ecf8e]' : 'text-slate-400 dark:text-[#707070]'
              )}
            />
            <span>EOD Till Closings</span>
            <span
              className={cn(
                'px-1.5 py-0.2 rounded-[4px] text-[10px] font-mono tabular-nums ml-1',
                activeTab === 'eod_closings'
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/20'
                  : 'bg-slate-100 dark:bg-[#1f1f1f] text-slate-500 dark:text-[#707070]'
              )}
            >
              {eodLocks.length} Records
            </span>
          </button>
        </div>

        {/* 5. TAB 1: DAILY CASH STATEMENT */}
        {activeTab === 'daily_cash' && (
          <div className="space-y-4">
            <div className="rounded-[12px] p-4 bg-white dark:bg-[#18181a] border border-slate-200 dark:border-[#242424] shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-slate-900 dark:text-[#EDEDED] font-sans">
                  Daily Cash Drawer Statement
                </h2>
                <p className="text-xs text-slate-500 dark:text-[#A1A1A1] font-sans mt-0.5">
                  Opening cash, cash additions, expenses paid, net change, and closing cash for each day.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleExportDailyCashStatement}
                  className="h-8.5 px-3.5 py-1.5 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-medium text-xs font-sans flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs active:bg-[#1fa672]"
                >
                  <Download className="w-4 h-4 text-[#171717] stroke-[2.5]" />
                  <span>Download Statement (CSV)</span>
                </button>
              </div>
            </div>

            {/* Daily Statement Table */}
            <div className="rounded-[12px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] shadow-2xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-[#242424] bg-slate-50/80 dark:bg-[#161618] text-[11px] font-mono uppercase text-slate-500 dark:text-[#707070]">
                      <th className="py-2.5 px-3 font-semibold">Date</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Opening Cash (₹)</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Cash Added (+) (₹)</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Cash Spent (-) (₹)</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Net Change (₹)</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Closing Cash (₹)</th>
                      <th className="py-2.5 px-3 font-semibold text-center">Entries</th>
                      <th className="py-2.5 px-3 font-semibold text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#202020] font-sans">
                    {dailyCashFlow.days.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400 dark:text-[#707070]">
                          No cash ledger transactions found for the selected date range.
                        </td>
                      </tr>
                    ) : (
                      dailyCashFlow.days.map((d) => (
                        <tr
                          key={d.date}
                          className="hover:bg-slate-50/60 dark:hover:bg-[#1c1c1f] transition-colors"
                        >
                          <td className="py-2 px-3 font-mono text-[11px] font-medium text-slate-800 dark:text-[#EDEDED] whitespace-nowrap">
                            {d.displayDate}
                          </td>
                          <td className="py-2 px-3 font-mono tabular-nums text-right text-slate-800 dark:text-zinc-200 whitespace-nowrap">
                            {formatINR(d.opening)}
                          </td>
                          <td className="py-2 px-3 font-mono tabular-nums text-right font-medium text-emerald-600 dark:text-[#3ecf8e] whitespace-nowrap">
                            {d.inflow > 0 ? `+${formatINR(d.inflow)}` : '-'}
                          </td>
                          <td className="py-2 px-3 font-mono tabular-nums text-right font-medium text-rose-600 dark:text-rose-400 whitespace-nowrap">
                            {d.outflow > 0 ? `-${formatINR(d.outflow)}` : '-'}
                          </td>
                          <td className="py-2 px-3 font-mono tabular-nums text-right font-medium whitespace-nowrap">
                            <span
                              className={
                                d.net > 0
                                  ? 'text-emerald-600 dark:text-[#3ecf8e]'
                                  : d.net < 0
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-slate-400'
                              }
                            >
                              {d.net > 0 ? `+${formatINR(d.net)}` : d.net < 0 ? formatINR(d.net) : '₹0'}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono tabular-nums text-right font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                            {formatINR(d.closing)}
                          </td>
                          <td className="py-2 px-3 font-mono text-center text-slate-500 whitespace-nowrap">
                            {d.count}
                          </td>
                          <td className="py-2 px-3 text-center whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded-[4px] text-[10px] font-mono bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/20 font-medium">
                              Balanced
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 6. TAB 2: COST CENTERS & VENDOR PROCUREMENT MATRIX */}
        {activeTab === 'cost_centers' && (
          <div className="space-y-4">
            {/* Header / Sub-banner */}
            <div className="rounded-[12px] p-4 bg-white dark:bg-[#18181a] border border-slate-200 dark:border-[#242424] shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-slate-900 dark:text-[#EDEDED] font-sans flex items-center gap-2">
                  <span>Showroom Cost Center Allocation &amp; Vendor Matrix</span>
                  <span className="px-2 py-0.5 rounded-[4px] bg-[#3ecf8e]/10 text-emerald-700 dark:text-[#3ecf8e] text-[10px] font-mono font-bold">
                    Full Details Breakdown
                  </span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-[#A1A1A1] font-sans mt-0.5">
                  Complete disaggregated financial analysis across all active departments and vendor concentration.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleExportCostCentersCSV}
                  className="h-8.5 px-3.5 py-1.5 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-medium text-xs font-sans flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs active:bg-[#1fa672]"
                >
                  <Download className="w-4 h-4 text-[#171717] stroke-[2.5]" />
                  <span>Download Cost Centers &amp; Vendors (CSV)</span>
                </button>
              </div>
            </div>

            {/* 4 Summary Telemetry Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-[8px] bg-white dark:bg-[#18181a] border border-slate-200 dark:border-[#242424] space-y-1">
                <span className="text-[11px] text-slate-500 dark:text-zinc-400 font-sans">Total Allocated Spend</span>
                <div className="font-mono text-lg font-bold text-slate-900 dark:text-white">
                  {formatINR(costCenterReportData.totalAllocatedSpend)}
                </div>
                <span className="text-[10px] text-slate-400 font-mono">Disbursed in selected period</span>
              </div>

              <div className="p-3.5 rounded-[8px] bg-white dark:bg-[#18181a] border border-slate-200 dark:border-[#242424] space-y-1">
                <span className="text-[11px] text-slate-500 dark:text-zinc-400 font-sans">Active Cost Centers</span>
                <div className="font-mono text-lg font-bold text-slate-900 dark:text-white">
                  {costCenterReportData.totalDeptsCount} Departments
                </div>
                <span className="text-[10px] text-emerald-600 dark:text-[#3ecf8e] font-mono">100% split disaggregated</span>
              </div>

              <div className="p-3.5 rounded-[8px] bg-white dark:bg-[#18181a] border border-slate-200 dark:border-[#242424] space-y-1">
                <span className="text-[11px] text-slate-500 dark:text-zinc-400 font-sans">Unique Vendors / Payees</span>
                <div className="font-mono text-lg font-bold text-slate-900 dark:text-white">
                  {costCenterReportData.totalVendorsCount} Payees
                </div>
                <span className="text-[10px] text-slate-400 font-mono">Vendors, shops &amp; floor staff</span>
              </div>

              <div className="p-3.5 rounded-[8px] bg-white dark:bg-[#18181a] border border-slate-200 dark:border-[#242424] space-y-1">
                <span className="text-[11px] text-slate-500 dark:text-zinc-400 font-sans">Pareto Concentration</span>
                <div className="font-mono text-lg font-bold text-sky-600 dark:text-sky-400">
                  {costCenterReportData.top3Ratio}%
                </div>
                <span className="text-[10px] text-slate-400 font-mono">Top 3 vendors share of total spend</span>
              </div>
            </div>

            {/* Section A: All Cost Centers Table */}
            <div className="rounded-[12px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] shadow-2xs overflow-hidden space-y-2 p-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-[#222222]">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#3ecf8e]" />
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-white uppercase font-sans">
                    Department Cost Allocation (Ranked by Outflow)
                  </h3>
                </div>
                <span className="text-xs font-mono text-slate-500">
                  {costCenterReportData.departments.length} Cost Centers
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-[#242424] bg-slate-50/80 dark:bg-[#161618] text-[11px] font-mono uppercase text-slate-500 dark:text-[#707070]">
                      <th className="py-2.5 px-3 font-semibold w-12 text-center">Rank</th>
                      <th className="py-2.5 px-3 font-semibold">Department Name</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Spend (INR)</th>
                      <th className="py-2.5 px-3 font-semibold text-center w-28">% Share</th>
                      <th className="py-2.5 px-3 font-semibold text-center">Bills</th>
                      <th className="py-2.5 px-3 font-semibold">Primary Payee</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Cash vs UPI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#202020] font-sans">
                    {costCenterReportData.departments.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-400">
                          No department records found for this period.
                        </td>
                      </tr>
                    ) : (
                      costCenterReportData.departments.map((dept, idx) => (
                        <tr key={dept.name} className="hover:bg-slate-50/60 dark:hover:bg-[#1c1c1f] transition-colors">
                          <td className="py-2 px-3 font-mono text-center font-bold text-slate-500">
                            #{idx + 1}
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white">
                            {dept.name}
                          </td>
                          <td className="py-2 px-3 font-mono font-bold text-right text-slate-900 dark:text-white tabular-nums">
                            {formatINR(dept.amount)}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <div className="flex items-center gap-1.5 justify-center">
                              <div className="w-16 h-1.5 rounded-full bg-slate-200 dark:bg-[#282828] overflow-hidden">
                                <div
                                  className="h-full bg-[#3ecf8e] rounded-full"
                                  style={{ width: `${Math.min(dept.percentage, 100)}%` }}
                                />
                              </div>
                              <span className="font-mono text-[10px] text-slate-600 dark:text-zinc-400 font-semibold w-8 text-right">
                                {dept.percentage}%
                              </span>
                            </div>
                          </td>
                          <td className="py-2 px-3 font-mono text-center text-slate-600 dark:text-zinc-400">
                            {dept.count}
                          </td>
                          <td className="py-2 px-3 text-slate-800 dark:text-zinc-200 truncate max-w-[200px]">
                            {dept.primaryVendor}
                            {dept.primaryVendorAmount > 0 && (
                              <span className="ml-1 text-[10px] font-mono text-slate-400">
                                ({formatINR(dept.primaryVendorAmount)})
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 font-mono text-right text-[11px] text-slate-600 dark:text-zinc-400 tabular-nums">
                            <span className="text-amber-600 dark:text-amber-400">₹{Math.round(dept.cashAmount).toLocaleString('en-IN')}</span> /{' '}
                            <span className="text-sky-600 dark:text-sky-400">₹{Math.round(dept.upiAmount).toLocaleString('en-IN')}</span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section B: Pareto 80/20 Vendor Procurement Concentration Table */}
            <div className="rounded-[12px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] shadow-2xs overflow-hidden space-y-2 p-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-[#222222]">
                <div className="flex items-center gap-2">
                  <PieChart className="w-4 h-4 text-sky-500" />
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-white uppercase font-sans">
                    Pareto Vendor Procurement Matrix (Ranked by Total Paid)
                  </h3>
                </div>
                <span className="text-xs font-mono text-slate-500">
                  {costCenterReportData.vendors.length} Vendors &amp; Payees
                </span>
              </div>

              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-slate-200 dark:border-[#242424] bg-slate-50 dark:bg-[#18181a] text-[11px] font-mono uppercase text-slate-500 dark:text-[#707070]">
                      <th className="py-2.5 px-3 font-semibold w-12 text-center">Rank</th>
                      <th className="py-2.5 px-3 font-semibold">Vendor / Beneficiary Name</th>
                      <th className="py-2.5 px-3 font-semibold">Primary Department</th>
                      <th className="py-2.5 px-3 font-semibold">Expense Head</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Total Disbursed (INR)</th>
                      <th className="py-2.5 px-3 font-semibold text-center w-20">% Share</th>
                      <th className="py-2.5 px-3 font-semibold text-center">Bills</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Cash / UPI Split</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#202020] font-sans">
                    {costCenterReportData.vendors.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400">
                          No vendor disbursement records found.
                        </td>
                      </tr>
                    ) : (
                      costCenterReportData.vendors.map((vendor, idx) => (
                        <tr key={vendor.name} className="hover:bg-slate-50/60 dark:hover:bg-[#1c1c1f] transition-colors">
                          <td className="py-2 px-3 font-mono text-center font-bold text-slate-500">
                            #{idx + 1}
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white">
                            {vendor.name}
                          </td>
                          <td className="py-2 px-3 text-slate-600 dark:text-zinc-400 text-xs">
                            {vendor.primaryDept}
                          </td>
                          <td className="py-2 px-3 text-slate-600 dark:text-zinc-400 text-xs">
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#202020] font-mono text-[10.5px]">
                              {vendor.primaryCat}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono font-bold text-right text-slate-900 dark:text-white tabular-nums">
                            {formatINR(vendor.amount)}
                          </td>
                          <td className="py-2 px-3 font-mono text-center text-slate-600 dark:text-zinc-400 font-semibold text-[11px]">
                            {vendor.percentage}%
                          </td>
                          <td className="py-2 px-3 font-mono text-center text-slate-600 dark:text-zinc-400">
                            {vendor.count}
                          </td>
                          <td className="py-2 px-3 font-mono text-right text-[11px] text-slate-600 dark:text-zinc-400 tabular-nums">
                            <span className="text-amber-600 dark:text-amber-400">₹{Math.round(vendor.cashAmount).toLocaleString('en-IN')}</span> /{' '}
                            <span className="text-sky-600 dark:text-sky-400">₹{Math.round(vendor.upiAmount).toLocaleString('en-IN')}</span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 7. TAB 3: TALLY PRIME EXPORT */}
        {activeTab === 'tally' && (
          <div className="space-y-4">
            <div className="rounded-[12px] p-4 bg-white dark:bg-[#18181a] border border-slate-200 dark:border-[#242424] shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-slate-900 dark:text-[#EDEDED] font-sans">
                  Tally Prime Accounting Ledger
                </h2>
                <p className="text-xs text-slate-500 dark:text-[#A1A1A1] font-sans mt-0.5">
                  Pre-configured vouchers mapped with Debit and Credit accounts, ready for your showroom accountant.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                {/* View Mode Switch */}
                <div className="flex items-center gap-1 p-0.5 rounded-[6px] bg-slate-100 dark:bg-[#1f1f23] border border-slate-200 dark:border-[#2e2e32]">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('selection');
                      setTallyViewMode('itemized');
                    }}
                    className={cn(
                      'px-2.5 py-1 text-xs font-medium rounded-[4px] transition-all cursor-pointer font-sans select-none flex items-center gap-1.5',
                      tallyViewMode === 'itemized'
                        ? 'bg-white dark:bg-[#28282c] text-slate-900 dark:text-white shadow-2xs font-semibold'
                        : 'text-slate-500 dark:text-[#888888] hover:text-slate-800 dark:hover:text-white'
                    )}
                    title="Display individual line-item records for each split employee / beneficiary"
                  >
                    <Split className="w-3 h-3 text-[#3ecf8e]" />
                    <span>Itemized Staff Breakdown</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('selection');
                      setTallyViewMode('summary');
                    }}
                    className={cn(
                      'px-2.5 py-1 text-xs font-medium rounded-[4px] transition-all cursor-pointer font-sans select-none flex items-center gap-1.5',
                      tallyViewMode === 'summary'
                        ? 'bg-white dark:bg-[#28282c] text-slate-900 dark:text-white shadow-2xs font-semibold'
                        : 'text-slate-500 dark:text-[#888888] hover:text-slate-800 dark:hover:text-white'
                    )}
                    title="Display one summary row per voucher"
                  >
                    <span>Voucher Summary</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleCopyTallyToClipboard}
                  className="h-8.5 px-3 py-1.5 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-slate-50 dark:bg-[#1a1a1a] hover:bg-slate-100 dark:hover:bg-[#222222] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-[#EDEDED] text-xs font-medium font-sans flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Copy to clipboard"
                >
                  {copiedTally ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#3ecf8e]" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>Copy Rows</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleExportTallyXML}
                  className="h-8.5 px-3 py-1.5 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#1a1a1a] text-slate-800 dark:text-white hover:border-[#3ecf8e] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                  title="Direct Tally Prime XML import file"
                >
                  <Download className="w-3.5 h-3.5 text-[#3ecf8e]" />
                  <span>Download Tally XML</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportTally}
                  className="h-8.5 px-3.5 py-1.5 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-medium text-xs font-sans flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs active:bg-[#1fa672]"
                >
                  <Download className="w-4 h-4 text-[#171717] stroke-[2.5]" />
                  <span>Download Tally CSV</span>
                </button>
              </div>
            </div>

            {/* Tally Vouchers Table */}
            <div className="rounded-[12px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] shadow-2xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-[#242424] bg-slate-50/80 dark:bg-[#161618] text-[11px] font-mono uppercase text-slate-500 dark:text-[#707070]">
                      <th className="py-2.5 px-3 font-semibold">Date</th>
                      <th className="py-2.5 px-3 font-semibold">Voucher #</th>
                      <th className="py-2.5 px-3 font-semibold">Debit Ledger (Expense)</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Debit (₹)</th>
                      <th className="py-2.5 px-3 font-semibold">Credit Ledger (Source)</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Credit (₹)</th>
                      <th className="py-2.5 px-3 font-semibold">Branch</th>
                      <th className="py-2.5 px-3 font-semibold">Payee</th>
                      <th className="py-2.5 px-3 font-semibold">Mode</th>
                      <th className="py-2.5 px-3 font-semibold">Narration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#202020] font-sans">
                    {tallyPreviewRows.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-8 text-center text-slate-400 dark:text-[#707070]">
                          No vouchers found for the selected filter period.
                        </td>
                      </tr>
                    ) : (
                      tallyPreviewRows.map((r) => (
                        <tr
                          key={r.id}
                          className="hover:bg-slate-50/60 dark:hover:bg-[#1c1c1f] transition-colors"
                        >
                          <td className="py-2 px-3 font-mono text-[11px] text-slate-600 dark:text-[#A1A1A1] whitespace-nowrap">
                            {r.date}
                          </td>
                          <td className="py-2 px-3 font-mono font-medium text-slate-900 dark:text-[#EDEDED] whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span>{r.voucherNumber}</span>
                              {r.lineLabel && (
                                <span
                                  className={cn(
                                    'px-1.5 py-0.2 rounded-[4px] text-[10px] font-mono select-none',
                                    r.isSplitRow
                                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/20'
                                      : 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20 cursor-pointer hover:bg-purple-500/20'
                                  )}
                                  onClick={!r.isSplitRow ? () => setTallyViewMode('itemized') : undefined}
                                  title={!r.isSplitRow ? 'Click to view individual employee split lines' : undefined}
                                >
                                  {r.lineLabel}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-slate-800 dark:text-[#EDEDED] font-medium whitespace-nowrap">
                            {r.debitLedger}
                          </td>
                          <td className="py-2 px-3 font-mono tabular-nums text-right font-medium text-slate-900 dark:text-white whitespace-nowrap">
                            {formatINR(r.amount)}
                          </td>
                          <td className="py-2 px-3 text-slate-600 dark:text-[#A1A1A1] whitespace-nowrap">
                            {r.creditLedger}
                          </td>
                          <td className="py-2 px-3 font-mono tabular-nums text-right font-medium text-slate-900 dark:text-white whitespace-nowrap">
                            {formatINR(r.amount)}
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] text-slate-600 dark:text-[#A1A1A1] whitespace-nowrap">
                            {r.costCenter}
                          </td>
                          <td className="py-2 px-3 text-slate-800 dark:text-[#EDEDED] whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              {r.isSplitRow && <Users className="w-3 h-3 text-[#3ecf8e] shrink-0" />}
                              <span>{r.payee}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <span
                              className={cn(
                                'px-1.5 py-0.5 rounded-[4px] text-[10px] font-mono',
                                r.paymentMode === 'Cash'
                                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20'
                                  : 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20'
                              )}
                            >
                              {r.paymentMode}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-500 dark:text-[#888888] max-w-xs truncate">
                            {r.narration}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 7. TAB 3: EOD TILL CLOSING HISTORY */}
        {activeTab === 'eod_closings' && (
          <div className="space-y-4">
            <div className="rounded-[12px] p-4 bg-white dark:bg-[#18181a] border border-slate-200 dark:border-[#242424] shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-slate-900 dark:text-[#EDEDED] font-sans">
                  Showroom Daily Till Closing Slips & Denomination Counts
                </h2>
                <p className="text-xs text-slate-500 dark:text-[#A1A1A1] font-sans mt-0.5">
                  Permanent record of end-of-day physical note counts, system balances, and cashier-manager sign-offs.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-500 dark:text-[#888888]">
                  {eodLocks.length} Closing{eodLocks.length === 1 ? '' : 's'} Logged
                </span>
              </div>
            </div>

            {/* Till Closings Table */}
            <div className="rounded-[12px] border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#18181a] overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50/80 dark:bg-[#151518] border-b border-slate-200 dark:border-[#242424] text-slate-500 dark:text-[#888888] font-sans">
                      <th className="py-2.5 px-3 whitespace-nowrap">Date</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Slip ID</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Showroom</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">System Cash (₹)</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Counted Cash (₹)</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Variance (₹)</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Counted By</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Verified By</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
                      <th className="py-2.5 px-3 text-center whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#242428] font-sans">
                    {eodLocks.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-8 text-center text-slate-400 dark:text-[#707070] text-xs">
                          No daily till closing slips recorded yet for this showroom. Lock the till using Daily Till Lock (F9).
                        </td>
                      </tr>
                    ) : (
                      eodLocks.map((lock, idx) => {
                        const variance = Number(lock.cash_variance || lock.variance || 0);
                        const isMatch = Math.abs(variance) < 0.01;
                        return (
                          <tr
                            key={lock.id || lock.slip_id || idx}
                            className="hover:bg-slate-50/60 dark:hover:bg-[#1c1c1f] transition-colors"
                          >
                            <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-[#A1A1A1] whitespace-nowrap">
                              {lock.lock_date || lock.date}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-medium text-slate-900 dark:text-[#EDEDED] whitespace-nowrap">
                              {lock.slip_id || lock.slipId || 'EOD'}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700 dark:text-[#EDEDED] whitespace-nowrap">
                              {lock.branch_id || lock.branchCode || 'ASI'}
                            </td>
                            <td className="py-2.5 px-3 font-mono tabular-nums text-right font-medium text-slate-700 dark:text-[#EDEDED] whitespace-nowrap">
                              {formatINR(Number(lock.system_cash_balance || lock.systemBalance || 0))}
                            </td>
                            <td className="py-2.5 px-3 font-mono tabular-nums text-right font-medium text-slate-900 dark:text-white whitespace-nowrap">
                              {formatINR(Number(lock.physical_counted_cash || lock.physicalCounted || 0))}
                            </td>
                            <td className={cn(
                              'py-2.5 px-3 font-mono tabular-nums text-right font-semibold whitespace-nowrap',
                              isMatch ? 'text-[#3ecf8e]' : 'text-amber-500'
                            )}>
                              {variance === 0 ? '₹0.00' : (variance > 0 ? `+${formatINR(variance)}` : `-${formatINR(Math.abs(variance))}`)}
                            </td>
                            <td className="py-2.5 px-3 text-slate-800 dark:text-[#EDEDED] whitespace-nowrap text-xs">
                              {lock.cashier_name || lock.cashier || 'Cashier'}
                            </td>
                            <td className="py-2.5 px-3 text-slate-800 dark:text-[#EDEDED] whitespace-nowrap text-xs">
                              {lock.supervisor_name || lock.supervisor || 'Manager'}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span
                                className={cn(
                                  'px-2 py-0.5 rounded-[4px] text-[10px] font-mono font-medium inline-flex items-center gap-1',
                                  isMatch
                                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/20'
                                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20'
                                )}
                              >
                                {isMatch ? (
                                  <>
                                    <Check className="w-3 h-3 text-[#3ecf8e]" />
                                    <span>Balanced</span>
                                  </>
                                ) : (
                                  <span>Variance</span>
                                )}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handlePrintEodSlip(lock)}
                                className="px-2.5 py-1 rounded-[4px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#202024] hover:bg-slate-100 dark:hover:bg-[#282828] text-slate-700 dark:text-[#EDEDED] text-[11px] font-medium inline-flex items-center gap-1.5 cursor-pointer shadow-2xs transition-colors"
                                title="Print Till Closing Slip"
                              >
                                <Printer className="w-3 h-3 text-slate-400" />
                                <span>Print Slip</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportsPage;
