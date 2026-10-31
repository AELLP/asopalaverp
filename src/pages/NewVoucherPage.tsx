import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useBranchStore } from '@/store/branchStore';
import { useAuthStore, isPrivilegedAdminRole } from '@/store/authStore';
import { useOverrideStore } from '@/store/overrideStore';
import { useVouchers } from '@/hooks/useVouchers';
import { useVoucherStore } from '@/store/voucherStore';
import { erpService } from '@/lib/erpService';
import { StaffSplitTable, SplitItem } from '@/components/vouchers/StaffSplitTable';
import { VendorSplitTable } from '@/components/vouchers/VendorSplitTable';
import { BillUploader } from '@/components/vouchers/BillUploader';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { DatePicker } from '@/components/ui/DatePicker';
import { SegmentedControl } from '@/components/ui';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { cn, formatINR, formatVoucherNumber, generateVoucherCollisionToken, numberToWordsINR, triggerHaptic, normalizeBranchCode, DEFAULT_BRANCHES } from '@/lib/utils';
import { format } from 'date-fns';
import { animateErrorBanner } from '@/lib/animations';
import { showToast } from '@/components/ui/ToastContainer';
import { VendorSplitItem, VoucherMode } from '@/types/database';
import {  CheckCircle2,  Check,  RotateCcw,
  Sparkles,  Zap,  Users,  Receipt,  ShieldAlert,  AlertTriangle,
  Store,
  Truck,  X,
  CreditCard,
  Coins,  Eye,
} from 'lucide-react';

export const NewVoucherPage: React.FC = () => {
  const { setActivePage } = useUIStore();
  const { user, getAllowedBranches, isBranchAllowed } = useAuthStore();
  const { branches, selectedBranchId, setSelectedBranchId, getActiveBranch } = useBranchStore();
  const { categories, departments, couriers, staff, vouchers, refresh } = useVouchers();

  const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  
  const allowedBranches = getAllowedBranches(branches);
  const activeBranch = getActiveBranch();
  const initialBranch = (selectedBranchId && selectedBranchId !== 'ALL' && isBranchAllowed(selectedBranchId))
    ? selectedBranchId
    : (allowedBranches[0]?.branch_id || activeBranch.branch_id || 'Aellp-ASI');

  // Mode Selection: Shop_Vendor (Default), Staff_Split, Courier
  const [mode, setMode] = useState<VoucherMode>('Shop_Vendor');
  const [selectedBranch, setSelectedBranch] = useState(initialBranch);
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [voucherDigits, setVoucherDigits] = useState<string>('');
  const [cashBalance, setCashBalance] = useState<number>(0);
  const [upiBalance, setUpiBalance] = useState<number>(0);
  const [isPeriodLocked, setIsPeriodLocked] = useState<boolean>(false);
  const isSubmittingRef = useRef(false);

  // Sync selected branch when store changes
  useEffect(() => {
    if (selectedBranchId && selectedBranchId !== 'ALL' && isBranchAllowed(selectedBranchId)) {
      setSelectedBranch(selectedBranchId);
    }
  }, [selectedBranchId]);

  const targetCode = normalizeBranchCode(selectedBranch);
  const branchList = allowedBranches && allowedBranches.length > 0 ? allowedBranches : DEFAULT_BRANCHES;
  const currBranch = branchList.find(
    (b) =>
      b.branch_id === selectedBranch ||
      normalizeBranchCode(b.branch_id) === targetCode ||
      normalizeBranchCode(b.branch_code) === targetCode
  ) || branchList[0] || DEFAULT_BRANCHES[0];

  // Scroll to top on mount
  useEffect(() => {
    const mainEl = document.querySelector('main');
    if (mainEl) {
      mainEl.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  }, []);

  // Load Live Wallet Balances
  const loadBalances = async () => {
    try {
      const w = await erpService.getBranchWallet(selectedBranch);
      setCashBalance(w.cash_balance);
      setUpiBalance(w.upi_balance);
    } catch (err) {
      console.warn('Error fetching wallet balance:', err);
    }
  };

  useEffect(() => {
    loadBalances();
    let timeoutId: any = null;
    const handleWalletUpdate = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        loadBalances();
      }, 300);
    };
    window.addEventListener('asopalav:wallet-updated', handleWalletUpdate);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('asopalav:wallet-updated', handleWalletUpdate);
    };
  }, [selectedBranch]);

  // Check Accounting Period Lock
  useEffect(() => {
    async function checkPeriod() {
      try {
        const locked = await erpService.checkIsPeriodLocked(paymentDate);
        setIsPeriodLocked(locked);
      } catch (err) {
        setIsPeriodLocked(false);
      }
    }
    checkPeriod();
  }, [paymentDate]);

  // Form Fields State
  const [categoryName, setCategoryName] = useState<string>('');
  const [departmentName, setDepartmentName] = useState<string>('');
  const [recipientName, setRecipientName] = useState<string>('');
  const [billNumber, setBillNumber] = useState<string>('');
  const [amount, setAmount] = useState<number | ''>('');

  // Staff Requester State
  const [requestedByStaffCode, setRequestedByStaffCode] = useState<string>('');
  const [requestedByStaffName, setRequestedByStaffName] = useState<string>('');

  // Multi-Vendor Mode State
  const [isMultiVendor, setIsMultiVendor] = useState<boolean>(false);
  const [vendorSplits, setVendorSplits] = useState<VendorSplitItem[]>([
    {
      vendor_name: '',
      category_name: '',
      department_name: '',
      bill_number: '',
      description: '',
      amount: 0,
    },
  ]);

  // Staff Split Multi-Mode State
  const [splits, setSplits] = useState<SplitItem[]>([
    {
      staffCode: '',
      staffName: '',
      departmentName: '',
      categoryName: '',
      amount: 0,
    },
  ]);

  // Courier Specific State
  const [courierCompany, setCourierCompany] = useState<string>('');
  const [trackingNumber, setTrackingNumber] = useState<string>('');

  // Payment & Remarks State
  const [paymentMethod, setPaymentMethod] = useState<'Physical_Cash' | 'Online_UPI'>('Online_UPI');
  const [remarks, setRemarks] = useState<string>('');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);

  // GST Tax Invoice State (for B2B Vendor Invoices & ITC Claims)
  const [isGstInvoice, setIsGstInvoice] = useState<boolean>(false);
  const [vendorGstin, setVendorGstin] = useState<string>('');
  const [gstRate, setGstRate] = useState<number>(18);
  const [activeGstSlabs, setActiveGstSlabs] = useState<Array<{ rate: number; label: string }>>([
    { rate: 5, label: '5%' },
    { rate: 12, label: '12%' },
    { rate: 18, label: '18%' },
    { rate: 28, label: '28%' },
  ]);

  // Load dynamic GST slabs from Supabase
  useEffect(() => {
    let isMounted = true;
    erpService.getGstTaxRates(true).then((slabs) => {
      if (isMounted && slabs && slabs.length > 0) {
        const mapped = slabs.map((s) => ({
          rate: s.rate_percent,
          label: `${s.rate_percent}%`,
        }));
        setActiveGstSlabs(mapped);
        if (!slabs.some((s) => s.rate_percent === 18) && slabs.length > 0) {
          setGstRate(slabs[0].rate_percent);
        }
      }
    }).catch((err) => {
      console.warn('Dynamic GST slabs load error:', err);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Submission, Preview & Feedback State
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successVoucher, setSuccessVoucher] = useState<any | null>(null);
  const errorBannerRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const amountInputRef = useRef<HTMLInputElement | null>(null);
  const payeeInputRef = useRef<HTMLInputElement | null>(null);
  const payeeDropdownRef = useRef<HTMLDivElement | null>(null);
  const [isPayeeDropdownOpen, setIsPayeeDropdownOpen] = useState<boolean>(false);

  // Payee Dictionary & Smart Autocomplete (Aggregated from Historical Vouchers)
  const payeeSuggestionsMap = useMemo(() => {
    const map = new Map<string, {
      name: string;
      count: number;
      categoryName?: string;
      departmentName?: string;
    }>();

    // Sort descending by date so we capture the latest category & department used
    const sorted = [...vouchers].sort((a, b) => {
      const da = a.payment_date || a.created_at || '';
      const db = b.payment_date || b.created_at || '';
      return db.localeCompare(da);
    });

    sorted.forEach((v) => {
      const name = (v.recipient_name || '').trim();
      if (!name || name.length < 2) return;
      const key = name.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, {
          name,
          count: 1,
          categoryName: v.category_name || undefined,
          departmentName: v.department_name || undefined,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [vouchers]);

  // Filtered matching payees based on current input text
  const matchingPayees = useMemo(() => {
    const q = recipientName.trim().toLowerCase();
    if (!q) {
      return payeeSuggestionsMap.slice(0, 6);
    }
    return payeeSuggestionsMap
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [payeeSuggestionsMap, recipientName]);

  // Duplicate Bill Number Radar (Across All Showrooms)
  const duplicateBillMatch = useMemo(() => {
    const clean = billNumber.trim().toLowerCase();
    if (!clean || clean.length < 3) return null;
    const allLoaded = Object.values(useVoucherStore.getState().vouchers).flat();
    const searchList = allLoaded.length > 0 ? allLoaded : vouchers;
    return (
      searchList.find((v) => {
        if (v.status === 'Voided') return false;
        const vBill = (v.bill_number || '').trim().toLowerCase();
        return vBill === clean;
      }) || null
    );
  }, [billNumber, vouchers]);

  // Close Payee Autocomplete when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        payeeDropdownRef.current &&
        !payeeDropdownRef.current.contains(e.target as Node) &&
        payeeInputRef.current &&
        !payeeInputRef.current.contains(e.target as Node)
      ) {
        setIsPayeeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectPayee = (payee: { name: string; categoryName?: string; departmentName?: string }) => {
    triggerHaptic('light');
    setRecipientName(payee.name);
    if (payee.categoryName) {
      setCategoryName(payee.categoryName);
    }
    if (payee.departmentName) {
      setDepartmentName(payee.departmentName);
    }
    setIsPayeeDropdownOpen(false);
    amountInputRef.current?.focus();
  };

  // Listen to Global Counter Custom Events (Alt+1 / Alt+2 / Alt+3 / F2)
  useEffect(() => {
    const handleSetMode = (e: Event) => {
      const custom = e as CustomEvent<any>;
      const nextMode = typeof custom.detail === 'string' ? custom.detail : custom.detail?.mode;
      if (nextMode === 'Shop_Vendor' || nextMode === 'Staff_Split' || nextMode === 'Courier') {
        triggerHaptic('selection');
        setMode(nextMode);
      }
    };
    const handleTriggerDisburse = () => {
      formRef.current?.requestSubmit();
    };

    window.addEventListener('asopalav:set-voucher-mode', handleSetMode);
    window.addEventListener('asopalav:trigger-disburse-f2', handleTriggerDisburse);

    return () => {
      window.removeEventListener('asopalav:set-voucher-mode', handleSetMode);
      window.removeEventListener('asopalav:trigger-disburse-f2', handleTriggerDisburse);
    };
  }, []);

  useEffect(() => {
    if (error && errorBannerRef.current) {
      animateErrorBanner(errorBannerRef.current);
    }
  }, [error]);

  // Keyboard Shortcuts Listener (F2: Disburse, Alt+1/2/3: Mode, ESC: Reset)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (successVoucher) return;

      if (e.key === 'F2') {
        e.preventDefault();
        if (isSubmittingRef.current) return;
        formRef.current?.requestSubmit();
      } else if (e.altKey && (e.key === '1' || e.code === 'Digit1')) {
        e.preventDefault();
        triggerHaptic('selection');
        setMode('Shop_Vendor');
      } else if (e.altKey && (e.key === '2' || e.code === 'Digit2')) {
        e.preventDefault();
        triggerHaptic('selection');
        setMode('Staff_Split');
      } else if (e.altKey && (e.key === '3' || e.code === 'Digit3')) {
        e.preventDefault();
        triggerHaptic('selection');
        setMode('Courier');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [successVoucher]);

  // Quick Amount Add
  
  // Calculated Total Amount
  const finalCalculatedAmount = useMemo(() => {
    if (mode === 'Staff_Split') {
      return splits.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    }
    if (mode === 'Shop_Vendor' && isMultiVendor) {
      return vendorSplits.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    }
    return Number(amount) || 0;
  }, [mode, isMultiVendor, amount, splits, vendorSplits]);

  // Cash Limit Check (₹10,000 threshold)
  const sec40A3Check = useMemo(() => {
    return erpService.validateSection40A3(paymentMethod, finalCalculatedAmount, mode);
  }, [paymentMethod, finalCalculatedAmount, mode]);

  // GST Breakdown (CGST/SGST for Gujarat 24, IGST for Inter-State)
  const gstBreakdown = useMemo(() => {
    const total = finalCalculatedAmount;
    if (!isGstInvoice || total <= 0) {
      return { taxable: total, cgst: 0, sgst: 0, igst: 0, totalGst: 0, totalAmount: total };
    }
    const cleanGstin = vendorGstin.trim().toUpperCase();
    const isInterstate = cleanGstin.length >= 2 && !cleanGstin.startsWith('24');
    const rate = Number(gstRate) || 0;
    const taxable = Math.round((total / (1 + rate / 100)) * 100) / 100;
    const totalGst = Math.round((total - taxable) * 100) / 100;

    if (isInterstate) {
      return { taxable, cgst: 0, sgst: 0, igst: totalGst, totalGst, totalAmount: total };
    } else {
      const half = Math.round((totalGst / 2) * 100) / 100;
      return { taxable, cgst: half, sgst: Math.round((totalGst - half) * 100) / 100, igst: 0, totalGst, totalAmount: total };
    }
  }, [isGstInvoice, finalCalculatedAmount, vendorGstin, gstRate]);

  const {
    isNegativeWalletAllowed,
    isAutoVoucherDigitsAllowed,
    is40A3ExceededAllowed,
    isLockedPeriodEntryAllowed,
    isBackdatedAllowed,
  } = useOverrideStore();

  const allowNegative = isNegativeWalletAllowed();
  const allowAutoVoucher = isAutoVoucherDigitsAllowed();
  const allowLockedPeriod = isLockedPeriodEntryAllowed();
  const allowBackdated = isBackdatedAllowed();

  const isBackdated = paymentDate < todayStr;
  const isBackdateRestricted = isBackdated && !isPrivilegedAdminRole(user?.role_code);
  const isBackdateBlocked = isBackdateRestricted && !allowBackdated;

  // Balance Check
  const availableBalance = paymentMethod === 'Physical_Cash' ? cashBalance : upiBalance;
  const isInsufficientBalance = finalCalculatedAmount > 0 && finalCalculatedAmount > availableBalance;

  const handleResetForm = () => {
    setAmount('');
    setCategoryName('');
    setDepartmentName('');
    setRecipientName('');
    setRequestedByStaffCode('');
    setRequestedByStaffName('');
    setIsMultiVendor(false);
    setVendorSplits([
      {
        vendor_name: '',
        category_name: '',
        department_name: '',
        bill_number: '',
        description: '',
        amount: 0,
      },
    ]);
    setBillNumber('');
    setRemarks('');
    setPhotoUrls([]);
    setError(null);
    setVoucherDigits('');
    setSplits([
      {
        staffCode: '',
        staffName: '',
        departmentName: '',
        categoryName: '',
        amount: 0,
      },
    ]);
    setCourierCompany('');
    setTrackingNumber('');
    setIsGstInvoice(false);
    setVendorGstin('');
    setGstRate(18);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    _handleValidateAndPreview();
  };

  const _handleValidateAndPreview = () => {
    setError(null);

    // Auditor is strictly read-only
    if (user?.role_code === 'Auditor') {
      const msg = 'Auditors have read-only access. Creating expense vouchers is not permitted.';
      setError(msg);
      showToast({ type: 'error', title: 'Read-Only Access', message: msg });
      triggerHaptic('error');
      return;
    }

    // Cash Limit Check (₹10,000 threshold)
    if (sec40A3Check.exceeded && !is40A3ExceededAllowed()) {
      setError(`Cash payment of ${formatINR(finalCalculatedAmount)} exceeds the ₹10,000 cash limit. Please switch to Online UPI or obtain Manager Approval.`);
      return;
    }

    // Block future-dated vouchers
    if (paymentDate > todayStr && !isPrivilegedAdminRole(user?.role_code)) {
      setError("Cannot pick future date. Please use today's date.");
      return;
    }

    // Date Validation for Cashiers
    if (isBackdateBlocked) {
      const msg = `Past dates are locked. Store Managers and Cashiers can only record for today (${format(new Date(), 'dd-MMM-yyyy')}).`;
      setError(msg);
      showToast({ type: 'error', title: 'Date Locked', message: msg });
      triggerHaptic('error');
      return;
    }

    // Voucher Number Validation
    let effectiveVoucherDigits = voucherDigits.trim();
    if (!effectiveVoucherDigits) {
      if (allowAutoVoucher) {
        effectiveVoucherDigits = `EMG-${Date.now().toString().slice(-4)}`;
      } else {
        const msg = 'Please enter the bill / voucher book number.';
        setError(msg);
        showToast({ type: 'error', title: 'Bill Number Needed', message: msg });
        triggerHaptic('error');
        return;
      }
    }

    // Same-Month Duplicate Check:
    // Rule: Same number can be used in the next month, but is strictly unique within the SAME month.
    const targetMonth = (paymentDate || '').slice(0, 7);
    const cleanDigits = effectiveVoucherDigits.toUpperCase();
    const branchPrefix = currBranch.branch_code.toUpperCase();
    const targetFullPrefix = `${branchPrefix}-${cleanDigits}`;

    const duplicateInSameMonth = vouchers.some((v) => {
      if (v.status === 'Voided') return false;
      const vMonth = (v.payment_date || v.created_at || '').slice(0, 7);
      if (vMonth !== targetMonth) return false;
      const vNum = (v.voucher_number || '').toUpperCase();
      return vNum === targetFullPrefix || vNum.startsWith(`${targetFullPrefix}-`);
    });

    if (duplicateInSameMonth) {
      const monthLabel = format(new Date(`${paymentDate}T12:00:00`), 'MMMM yyyy');
      const msg = `Bill #${branchPrefix}-${cleanDigits} already exists in ${monthLabel}. Same number cannot be reused in the same month.`;
      setError(msg);
      showToast({ type: 'error', title: 'Duplicate Number in Same Month', message: msg });
      triggerHaptic('error');
      return;
    }

    // Amount Validation
    if (finalCalculatedAmount <= 0) {
      const msg = 'Please enter an amount greater than ₹0.';
      setError(msg);
      showToast({ type: 'error', title: 'Amount Needed', message: msg });
      triggerHaptic('error');
      return;
    }

    // Till Balance Validation
    if (isInsufficientBalance && !allowNegative) {
      const msg = `Not enough ${paymentMethod === 'Physical_Cash' ? 'Cash in box' : 'UPI balance'}. Need ${formatINR(finalCalculatedAmount)}, but only ${formatINR(availableBalance)} available.`;
      setError(msg);
      showToast({ type: 'error', title: 'Not Enough Money', message: msg });
      triggerHaptic('error');
      return;
    }

    // Mode-Specific Validations (Strict: NO default Category or Department allowed)
    if (mode === 'Shop_Vendor') {
      if (isMultiVendor) {
        if (vendorSplits.length === 0) {
          const msg = 'Please add at least one vendor item in the table.';
          setError(msg);
          showToast({ type: 'error', title: 'Vendor Needed', message: msg });
          triggerHaptic('error');
          return;
        }
        const invalidVendorIndex = vendorSplits.findIndex(
          (v) =>
            !v.vendor_name?.trim() ||
            !v.category_name?.trim() ||
            !v.department_name?.trim() ||
            Number(v.amount) <= 0
        );
        if (invalidVendorIndex !== -1) {
          const rowNum = invalidVendorIndex + 1;
          const v = vendorSplits[invalidVendorIndex];
          const msg = !v.vendor_name?.trim()
            ? `Row #${rowNum}: Please enter the shop/vendor name.`
            : !v.category_name?.trim()
            ? `Row #${rowNum} (${v.vendor_name}): Please select an expense category.`
            : !v.department_name?.trim()
            ? `Row #${rowNum} (${v.vendor_name}): Please select a department.`
            : `Row #${rowNum} (${v.vendor_name}): Amount must be greater than ₹0.`;
          setError(msg);
          showToast({ type: 'error', title: 'Incomplete Vendor Row', message: msg });
          triggerHaptic('error');
          return;
        }
      } else {
        if (!recipientName.trim()) {
          const msg = 'Please write who was paid (shop or person name).';
          setError(msg);
          showToast({ type: 'error', title: 'Name Needed', message: msg });
          triggerHaptic('error');
          return;
        }
        if (!categoryName.trim()) {
          const msg = 'Please choose an expense category.';
          setError(msg);
          showToast({ type: 'error', title: 'Category Needed', message: msg });
          triggerHaptic('error');
          return;
        }
        if (!departmentName.trim()) {
          const msg = 'Please choose a department.';
          setError(msg);
          showToast({ type: 'error', title: 'Department Needed', message: msg });
          triggerHaptic('error');
          return;
        }
      }
    } else if (mode === 'Courier') {
      if (!courierCompany.trim()) {
        const msg = 'Please choose or write the courier agency name.';
        setError(msg);
        showToast({ type: 'error', title: 'Courier Needed', message: msg });
        triggerHaptic('error');
        return;
      }
      if (!trackingNumber.trim()) {
        const msg = 'Please enter the tracking number or agent name.';
        setError(msg);
        showToast({ type: 'error', title: 'Tracking / Agent Needed', message: msg });
        triggerHaptic('error');
        return;
      }
      if (!categoryName.trim()) {
        const msg = 'Please choose an expense category for this courier bill.';
        setError(msg);
        showToast({ type: 'error', title: 'Category Needed', message: msg });
        triggerHaptic('error');
        return;
      }
      if (!departmentName.trim()) {
        const msg = 'Please choose a department for this courier bill.';
        setError(msg);
        showToast({ type: 'error', title: 'Department Needed', message: msg });
        triggerHaptic('error');
        return;
      }
    } else if (mode === 'Staff_Split') {
      if (splits.length === 0) {
        const msg = 'Please add at least one staff member to split.';
        setError(msg);
        showToast({ type: 'error', title: 'Staff Needed', message: msg });
        triggerHaptic('error');
        return;
      }
      const invalidSplitIndex = splits.findIndex(
        (s) =>
          !s.staffCode?.trim() ||
          !s.staffName?.trim() ||
          !s.categoryName?.trim() ||
          !s.departmentName?.trim() ||
          Number(s.amount) <= 0
      );
      if (invalidSplitIndex !== -1) {
        const rowNum = invalidSplitIndex + 1;
        const s = splits[invalidSplitIndex];
        const msg =
          !s.staffCode?.trim() || !s.staffName?.trim()
            ? `Staff Row #${rowNum}: Please select a staff member.`
            : !s.categoryName?.trim()
            ? `Staff Row #${rowNum} (${s.staffName}): Please select an expense category.`
            : !s.departmentName?.trim()
            ? `Staff Row #${rowNum} (${s.staffName}): Please select a department.`
            : `Staff Row #${rowNum} (${s.staffName}): Amount must be greater than ₹0.`;
        setError(msg);
        showToast({ type: 'error', title: 'Incomplete Staff Split', message: msg });
        triggerHaptic('error');
        return;
      }
    }

    // Period Lock Validation
    if (isPeriodLocked && !allowLockedPeriod && !isPrivilegedAdminRole(user?.role_code)) {
      const msg = `Today's register has been closed. New expenses cannot be saved.`;
      setError(msg);
      showToast({ type: 'error', title: 'Day Closed', message: msg });
      triggerHaptic('error');
      return;
    }

    // Notes minimum length check
    if (!remarks.trim() || remarks.trim().length < 3) {
      const msg = 'Please write a short reason for this expense (at least 3 letters).';
      setError(msg);
      showToast({ type: 'error', title: 'Reason Needed', message: msg });
      triggerHaptic('error');
      return;
    }

    // All valid -> Open Preview Modal for confirmation!
    triggerHaptic('selection');
    setIsPreviewOpen(true);
  };

  const executeFinalDisbursal = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSubmitting(true);
    triggerHaptic('heavy');

    let effectiveVoucherDigits = voucherDigits.trim();
    if (!effectiveVoucherDigits && allowAutoVoucher) {
      effectiveVoucherDigits = `EMG-${Date.now().toString().slice(-4)}`;
    }

    try {
      // Guard: Same-Month Duplicate Check
      const targetMonth = (paymentDate || '').slice(0, 7);
      const cleanDigits = effectiveVoucherDigits.toUpperCase();
      const branchPrefix = currBranch.branch_code.toUpperCase();
      const targetFullPrefix = `${branchPrefix}-${cleanDigits}`;

      const duplicateInSameMonth = vouchers.some((v) => {
        if (v.status === 'Voided') return false;
        const vMonth = (v.payment_date || v.created_at || '').slice(0, 7);
        if (vMonth !== targetMonth) return false;
        const vNum = (v.voucher_number || '').toUpperCase();
        return vNum === targetFullPrefix || vNum.startsWith(`${targetFullPrefix}-`);
      });

      if (duplicateInSameMonth) {
        const monthLabel = format(new Date(`${paymentDate}T12:00:00`), 'MMMM yyyy');
        throw new Error(`Bill #${branchPrefix}-${cleanDigits} already exists in ${monthLabel}. Same number cannot be reused in the same month.`);
      }

      // Cross-Month Rollover Token:
      // Token is ONLY applied if this same number already exists in a DIFFERENT month,
      // preventing DB key collisions across repeating bill book batches.
      // In the SAME month, duplicate numbers are strictly rejected above (never allowed).
      const existsInDifferentMonth = vouchers.some((v) => {
        if (v.status === 'Voided') return false;
        const vMonth = (v.payment_date || v.created_at || '').slice(0, 7);
        if (vMonth === targetMonth) return false;
        const vNum = (v.voucher_number || '').toUpperCase();
        return vNum === targetFullPrefix || vNum.startsWith(`${targetFullPrefix}-`);
      });

      let generatedVoucherNumber = targetFullPrefix;
      if (existsInDifferentMonth) {
        const collisionToken = generateVoucherCollisionToken();
        generatedVoucherNumber = `${targetFullPrefix}-${collisionToken}`;
      }

      const payload: any = {
        branch_id: selectedBranch,
        branch_code: currBranch.branch_code,
        payment_date: paymentDate,
        payment_type: mode,
        payment_method: paymentMethod,
        total_amount: finalCalculatedAmount,
        remarks: remarks.trim(),
        bill_number:
          mode === 'Courier'
            ? trackingNumber.trim() || billNumber.trim() || undefined
            : billNumber.trim() || undefined,
        bill_photo_urls: photoUrls,
        created_by_name: `${user?.first_name || 'Cashier'} ${user?.last_name || ''}`.trim(),
        status: 'Approved',
        requested_by_staff_code: requestedByStaffCode.trim() || undefined,
        requested_by_staff_name: requestedByStaffName.trim() || undefined,
      };

      let cleanedStaffSplits: SplitItem[] | undefined = undefined;

      if (mode === 'Shop_Vendor') {
        if (isMultiVendor) {
          const cleanedVendorSplits: VendorSplitItem[] = vendorSplits.map((v) => ({
            vendor_name: v.vendor_name.trim(),
            category_name: v.category_name.trim(),
            department_name: v.department_name.trim(),
            bill_number: v.bill_number?.trim() || '',
            description: v.description?.trim() || '',
            amount: Number(v.amount) || 0,
          }));
          const uniqueCategories = Array.from(
            new Set(cleanedVendorSplits.map((v) => v.category_name).filter(Boolean))
          );
          const uniqueDepartments = Array.from(
            new Set(cleanedVendorSplits.map((v) => v.department_name).filter(Boolean))
          );

          payload.category_name = uniqueCategories.join(', ');
          payload.department_name = uniqueDepartments.join(', ');
          payload.recipient_name =
            cleanedVendorSplits.length === 1
              ? cleanedVendorSplits[0].vendor_name
              : `${cleanedVendorSplits.length} Vendors (${cleanedVendorSplits.map((v) => v.vendor_name.split(' ')[0]).join(', ')})`;
          payload.vendor_splits = cleanedVendorSplits;
        } else {
          payload.category_name = categoryName.trim();
          payload.department_name = departmentName.trim();
          payload.recipient_name = recipientName.trim();
          if (isGstInvoice) {
            payload.is_gst_invoice = true;
            payload.vendor_gstin = vendorGstin.trim().toUpperCase() || undefined;
            payload.taxable_amount = gstBreakdown.taxable;
            payload.gst_rate = gstRate;
            payload.cgst_amount = gstBreakdown.cgst;
            payload.sgst_amount = gstBreakdown.sgst;
            payload.igst_amount = gstBreakdown.igst;
          }
        }
      } else if (mode === 'Courier') {
        payload.category_name = categoryName.trim();
        payload.department_name = departmentName.trim();
        payload.recipient_name = courierCompany.trim();
        payload.courier_company = courierCompany.trim();
        payload.tracking_number = trackingNumber.trim();
      } else if (mode === 'Staff_Split') {
        cleanedStaffSplits = splits.map((s) => ({
          staffCode: s.staffCode.trim(),
          staffName: s.staffName.trim(),
          departmentName: s.departmentName.trim(),
          categoryName: s.categoryName.trim(),
          amount: Number(s.amount) || 0,
        }));
        const uniqueCategories = Array.from(
          new Set(cleanedStaffSplits.map((s) => s.categoryName).filter(Boolean))
        );
        const uniqueDepartments = Array.from(
          new Set(cleanedStaffSplits.map((s) => s.departmentName).filter(Boolean))
        );

        payload.category_name = uniqueCategories.join(', ');
        payload.department_name = uniqueDepartments.join(', ');
        payload.recipient_name =
          cleanedStaffSplits.length === 1
            ? cleanedStaffSplits[0].staffName
            : `${cleanedStaffSplits.length} Staff (${cleanedStaffSplits.map((s) => s.staffName.split(' ')[0]).join(', ')})`;
        payload.splits = cleanedStaffSplits;
      }

      const created = await erpService.createVoucherWithLedger({
        voucher: {
          ...payload,
          voucher_number: generatedVoucherNumber,
        },
        splits: cleanedStaffSplits,
        userName: `${user?.first_name || 'Cashier'} ${user?.last_name || ''}`.trim(),
        userRole: user?.role_code || 'Cashier',
      });

      showToast({
        type: 'success',
        title: 'Expense Saved',
        message: `Bill #${formatVoucherNumber(created.voucher_number)} for ${formatINR(created.total_amount)} paid successfully.`,
      });

      setIsPreviewOpen(false);
      setSuccessVoucher(created);
      refresh();
      loadBalances();
    } catch (err: any) {
      console.error('Error creating voucher:', err);
      const rawMsg = err?.message || 'Could not save expense.';
      let userFriendlyMsg = rawMsg;
      if (rawMsg.includes('duplicate key') || rawMsg.includes('voucher_number') || rawMsg.includes('Duplicate Voucher Number')) {
        userFriendlyMsg = `Bill #${currBranch.branch_code}-${effectiveVoucherDigits.toUpperCase()} already exists. Please check the next number in your bill book.`;
      }
      showToast({
        type: 'error',
        title: 'Could Not Save',
        message: userFriendlyMsg,
      });
      setError(userFriendlyMsg);
    } finally {
      setSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  const executeFinalDisbursalRef = useRef(executeFinalDisbursal);
  executeFinalDisbursalRef.current = executeFinalDisbursal;

  // Keyboard Shortcuts Listener when Preview Modal is open
  useEffect(() => {
    if (!isPreviewOpen) return;
    const handlePreviewKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsPreviewOpen(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        executeFinalDisbursalRef.current();
      }
    };
    window.addEventListener('keydown', handlePreviewKeyDown);
    return () => window.removeEventListener('keydown', handlePreviewKeyDown);
  }, [isPreviewOpen]);

  // Success Screen Keyboard Shortcuts Listener (Space: Next, Esc: Expenses)
  useEffect(() => {
    if (!successVoucher) return;
    const handleSuccessKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        triggerHaptic('success');
        setSuccessVoucher(null);
        handleResetForm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setActivePage('expenses');
      }
    };

    window.addEventListener('keydown', handleSuccessKeyDown);
    return () => window.removeEventListener('keydown', handleSuccessKeyDown);
  }, [successVoucher]);

  // SUCCESS STATE MODAL
  if (successVoucher) {
    return (
      <div className="max-w-2xl mx-auto py-10 px-4 font-sans select-none space-y-4 animate-in fade-in duration-200">
        <div className="p-6 sm:p-8 rounded-[12px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#262626] shadow-xs text-center space-y-6">
          {/* Top Success Badge */}
          <div className="w-12 h-12 rounded-full bg-emerald-500/10 dark:bg-[#3ecf8e]/10 border border-emerald-500/20 dark:border-[#3ecf8e]/20 text-emerald-600 dark:text-[#3ecf8e] flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6 stroke-[2]" />
          </div>

          <div className="space-y-1">
            <h2 className="text-xl sm:text-2xl font-medium text-slate-900 dark:text-white font-sans tracking-tight">
              Expense Saved &amp; Paid Successfully!
            </h2>
            <p className="text-xs font-mono text-slate-500 dark:text-zinc-400">
              Bill #{formatVoucherNumber(successVoucher.voucher_number)} • {currBranch.branch_name}
            </p>
          </div>

          {/* Quick Summary Card */}
          <div className="p-4 rounded-[8px] bg-slate-50/70 dark:bg-[#141414] border border-slate-200 dark:border-[#262626] divide-y divide-slate-200/70 dark:divide-[#242424] text-xs font-sans text-left">
            <div className="flex justify-between items-center pb-2.5">
              <span className="text-slate-500 dark:text-zinc-400 font-sans">Bill Number:</span>
              <span className="font-mono font-medium text-slate-900 dark:text-white text-xs px-2 py-0.5 rounded-[4px] bg-white dark:bg-[#1f1f1f] border border-slate-200 dark:border-[#2e2e2e]">
                #{formatVoucherNumber(successVoucher.voucher_number)}
              </span>
            </div>

            <div className="flex justify-between items-center py-2.5">
              <span className="text-slate-500 dark:text-zinc-400 font-sans">Amount Paid:</span>
              <span className="font-mono font-medium text-emerald-600 dark:text-[#3ecf8e] text-lg sm:text-xl tabular-nums">
                {formatINR(successVoucher.total_amount)}
              </span>
            </div>

            <div className="flex justify-between items-center py-2.5">
              <span className="text-slate-500 dark:text-zinc-400 font-sans">Paid To:</span>
              <span className="text-slate-900 dark:text-white font-medium font-sans">
                {successVoucher.recipient_name}
              </span>
            </div>

            <div className="flex justify-between items-center py-2.5">
              <span className="text-slate-500 dark:text-zinc-400 font-sans">Payment Source:</span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] text-xs font-mono font-medium bg-slate-100 dark:bg-[#1f1f1f] text-slate-800 dark:text-zinc-300 border border-slate-200 dark:border-[#2e2e2e]">
                {successVoucher.payment_method === 'Physical_Cash' ? 'Cash Box' : 'Online UPI'}
              </span>
            </div>

            <div className="flex justify-between items-center py-2.5">
              <span className="text-slate-500 dark:text-zinc-400 font-sans">Category:</span>
              <span className="text-slate-700 dark:text-zinc-300 font-sans">
                {successVoucher.category_name}
              </span>
            </div>

            <div className="flex justify-between items-center pt-2.5">
              <span className="text-slate-500 dark:text-zinc-400 font-sans">Department:</span>
              <span className="text-slate-700 dark:text-zinc-300 font-sans">
                {successVoucher.department_name}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                triggerHaptic('success');
                setSuccessVoucher(null);
                handleResetForm();
              }}
              className="w-full sm:flex-1 h-10 min-h-[40px] px-4 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-sans text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-xs select-none"
            >
              <Zap className="w-3.5 h-3.5 text-[#171717] stroke-[2.5]" />
              <span>Add Next Expense</span>
            </button>

            <button
              type="button"
              onClick={() => setActivePage('expenses')}
              className="w-full sm:w-auto h-10 min-h-[40px] px-4 rounded-[6px] border border-slate-300 dark:border-[#2e2e2e] bg-transparent hover:bg-slate-50 dark:hover:bg-[#202020] text-slate-800 dark:text-zinc-200 font-sans text-xs font-medium cursor-pointer transition-colors shadow-xs"
            >
              All Expenses
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex-1 flex flex-col bg-white dark:bg-[#141414] text-slate-900 dark:text-[#EDEDED] font-sans antialiased selection:bg-[#3ecf8e]/20 selection:text-[#3ecf8e] pb-6 select-none">
      {/* 1. Add Expense Header (2-Layer Layout: Left Title & Subtitle, Right Actions) */}
      <div className="border-b border-slate-200 dark:border-[#242424] bg-white dark:bg-[#141414] px-4 lg:px-6 py-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          {/* Left Layer: Title & Subtitle */}
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-medium tracking-tight text-slate-900 dark:text-[#EDEDED] font-sans flex items-center gap-2">
                <Receipt className="w-5 h-5 text-[#3ecf8e]" />
                <span>Add Expense</span>
              </h1>
            </div>
            <p className="text-xs text-slate-500 dark:text-[#8e8e93] font-sans mt-0.5">
              Record daily shop expenses, staff allocations, and courier bills.
            </p>
          </div>

          {/* Right Layer: Live Balances & Actions */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 font-mono text-xs">
              <div className="h-8 px-2.5 flex items-center gap-1.5 rounded-[6px] bg-slate-50 dark:bg-[#1c1c1f] border border-slate-200 dark:border-[#26262a] shadow-2xs">
                <span className="text-[10px] text-slate-500 dark:text-[#8e8e93] font-sans font-medium">Cash:</span>
                <span className="font-semibold text-emerald-700 dark:text-[#3ecf8e] tabular-nums">{formatINR(cashBalance)}</span>
              </div>
              <div className="h-8 px-2.5 flex items-center gap-1.5 rounded-[6px] bg-slate-50 dark:bg-[#1c1c1f] border border-slate-200 dark:border-[#26262a] shadow-2xs">
                <span className="text-[10px] text-slate-500 dark:text-[#8e8e93] font-sans font-medium">UPI:</span>
                <span className="font-semibold text-sky-600 dark:text-sky-400 tabular-nums">{formatINR(upiBalance)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleResetForm}
              className="h-8 w-8 flex items-center justify-center rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-slate-50 dark:bg-[#1c1c1f] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-[#EDEDED] hover:bg-slate-100 dark:hover:bg-[#242428] transition-all cursor-pointer shadow-2xs"
              title="Clear Form"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 2. Main Studio Content Area */}
      <div className="px-4 lg:px-6 py-4 space-y-4 flex-1">
        {/* Error Alert Banner */}
        {error && (
          <div ref={errorBannerRef}>
            <ErrorBanner
              type="error"
              title="Please check:"
              message={error}
              onClose={() => setError(null)}
            />
          </div>
        )}

        {/* Auditor Read-Only Notice */}
        {user?.role_code === 'Auditor' && (
          <div className="p-3.5 rounded-[12px] bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 flex items-center gap-2.5 text-xs font-sans animate-in fade-in shadow-xs text-blue-900 dark:text-blue-200">
            <ShieldAlert className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <div>
              <strong className="block font-semibold">Auditor Mode (Read-Only)</strong>
              <span>You have read-only inspection access across all branches. Creating expense vouchers is disabled.</span>
            </div>
          </div>
        )}

        {/* Cash Limit Notice */}
        {sec40A3Check.exceeded && (
          <div className="p-3.5 rounded-[12px] bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-sans animate-in fade-in shadow-xs">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-semibold text-amber-900 dark:text-amber-200 text-xs">
                  Cash Limit Notice (Over ₹10,000)
                </strong>
                <span className="text-amber-800 dark:text-amber-300 text-xs leading-relaxed">
                  Cash payment of {formatINR(finalCalculatedAmount)} exceeds ₹10,000. Please pay with Online UPI or obtain Manager Approval.
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPaymentMethod('Online_UPI')}
              className="px-3.5 py-1.5 rounded-[6px] bg-white dark:bg-[#202020] hover:bg-slate-50 dark:hover:bg-[#282828] text-slate-800 dark:text-white border border-slate-300 dark:border-[#2e2e2e] font-semibold text-xs shrink-0 cursor-pointer shadow-xs transition-all"
            >
              Pay via Online UPI
            </button>
          </div>
        )}

        {/* Main 2-Column Responsive POS Form Body */}
        <form ref={formRef} onSubmit={handleSubmit} className="w-full">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 items-start">
            {/* LEFT COLUMN: Modes, Basic Details, Expense Details */}
            <div className="lg:col-span-8 space-y-4">
              {/* 1. COMPACT MODE SELECTION TABS */}
              <div className="w-full">
                <SegmentedControl
                  options={[
                    { id: 'Shop_Vendor', label: 'Shop Bill', icon: <Store className="w-4 h-4 shrink-0" /> },
                    { id: 'Staff_Split', label: 'Staff', icon: <Users className="w-4 h-4 shrink-0" /> },
                    { id: 'Courier', label: 'Courier', icon: <Truck className="w-4 h-4 shrink-0" /> },
                  ]}
                  value={mode}
                  onChange={(val) => setMode(val as VoucherMode)}
                  size="md"
                  fullWidth
                />
              </div>

          {/* CARD 1: BASIC DETAILS */}
          <div className="p-4 sm:p-5 rounded-[12px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] shadow-2xs space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Showroom / Branch */}
              <div className="space-y-1 min-w-0">
                <label className="block text-xs font-medium text-slate-700 dark:text-[#EDEDED]">
                  Branch *
                </label>
                <SearchableSelect
                  value={selectedBranch}
                  onChange={(val) => {
                    setSelectedBranch(val);
                    setSelectedBranchId(val);
                  }}
                  options={branchList.map((b) => ({
                    value: b.branch_id,
                    label: b.branch_name,
                  }))}
                  placeholder="Select branch..."
                  allowCustom={false}
                />
              </div>

              {/* Date of Payment */}
              <div className="space-y-1 min-w-0">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-700 dark:text-[#EDEDED]">
                    Date *
                  </label>
                  {isBackdated && (
                    <span className="text-[10px] font-mono text-slate-500 dark:text-zinc-400">
                      Past Date
                    </span>
                  )}
                </div>
                <DatePicker
                  value={paymentDate}
                  onChange={setPaymentDate}
                  placeholder="Select date..."
                />
              </div>

              {/* Voucher Number */}
              <div className="space-y-1 min-w-0">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-700 dark:text-[#EDEDED]">
                    Bill No. *
                  </label>
                  <span className="text-[10px] font-mono text-emerald-600 dark:text-[#3ecf8e]">
                    Auto
                  </span>
                </div>
                <div className="relative flex items-center rounded-[6px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] focus-within:border-[#3ecf8e] focus-within:ring-1 focus-within:ring-[#3ecf8e]/30 overflow-hidden h-10 min-h-[40px] shadow-2xs">
                  <span className="px-3 h-full flex items-center bg-slate-50 dark:bg-[#1c1c1c] text-slate-600 dark:text-[#A1A1A1] font-mono font-medium text-xs select-none shrink-0 border-r border-slate-200 dark:border-[#282828]">
                    {currBranch.branch_code}-
                  </span>
                  <input
                    type="text"
                    value={voucherDigits}
                    onChange={(e) => setVoucherDigits(e.target.value.replace(/[^0-9a-zA-Z-]/g, ''))}
                    placeholder="0001"
                    className="w-full bg-transparent px-3 py-2 text-xs font-mono font-medium text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none tabular-nums"
                  />
                </div>
              </div>
            </div>

            {/* Bottom Sub-Row: Amount + Paid From */}
            <div className="pt-3 border-t border-slate-100 dark:border-[#222222] grid grid-cols-1 md:grid-cols-12 gap-3.5 items-start">
              {/* Left 7 cols: Amount Input */}
              <div className="md:col-span-7 space-y-1.5">
                <label className="block text-xs font-medium text-slate-800 dark:text-[#EDEDED]">
                  Amount (₹) *
                </label>

                <div className="relative flex items-center rounded-[6px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] focus-within:border-[#3ecf8e] focus-within:ring-1 focus-within:ring-[#3ecf8e]/30 shadow-2xs overflow-hidden h-10 min-h-[40px]">
                  <span className="pl-3.5 pr-1 text-sm font-mono text-slate-400 dark:text-zinc-500 font-medium select-none">
                    ₹
                  </span>
                  <input
                    ref={amountInputRef}
                    type="number"
                    inputMode="decimal"
                    min="1"
                    step="any"
                    disabled={mode === 'Staff_Split' || (mode === 'Shop_Vendor' && isMultiVendor)}
                    value={mode === 'Staff_Split' || (mode === 'Shop_Vendor' && isMultiVendor) ? finalCalculatedAmount || '' : amount}
                    onChange={(e) => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value) || '')}
                    placeholder="0.00"
                    className="w-full bg-transparent pl-1 pr-3.5 py-2 text-sm font-mono font-semibold tabular-nums text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none disabled:opacity-85 disabled:cursor-not-allowed"
                  />
                </div>

                {finalCalculatedAmount > 0 && (
                  <div className="p-1.5 rounded-[6px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#282828]">
                    <span className="text-[11px] text-emerald-600 dark:text-[#3ecf8e] font-mono font-medium block truncate">
                      {numberToWordsINR(finalCalculatedAmount)}
                    </span>
                  </div>
                )}
              </div>

              {/* Right 5 cols: Paid From (Online UPI vs Cash Box) */}
              <div className="md:col-span-5 space-y-1.5">
                <label className="block text-xs font-medium text-slate-800 dark:text-[#EDEDED]">
                  Pay Mode *
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('selection');
                      setPaymentMethod('Online_UPI');
                    }}
                    className={cn(
                      'p-2 rounded-[6px] border text-left flex flex-col justify-between cursor-pointer transition-all shadow-2xs h-10 min-h-[40px]',
                      paymentMethod === 'Online_UPI'
                        ? 'bg-sky-500/10 border-sky-400 text-slate-900 dark:text-white ring-1 ring-sky-400/30'
                        : 'bg-white dark:bg-[#181818] border-slate-200 dark:border-[#282828] text-slate-700 dark:text-[#A1A1A1] hover:bg-slate-50 dark:hover:bg-[#202020]'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium flex items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5 text-sky-500" />
                        <span>Online UPI</span>
                      </span>
                      {paymentMethod === 'Online_UPI' && <Check className="w-3 h-3 text-sky-400 stroke-[2.5]" />}
                    </div>
                    <span className="text-[9.5px] font-mono text-sky-500 dark:text-sky-400 tabular-nums font-semibold leading-none">
                      UPI: {formatINR(upiBalance)}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('selection');
                      setPaymentMethod('Physical_Cash');
                    }}
                    className={cn(
                      'p-2 rounded-[6px] border text-left flex flex-col justify-between cursor-pointer transition-all shadow-2xs h-10 min-h-[40px]',
                      paymentMethod === 'Physical_Cash'
                        ? 'bg-emerald-500/10 border-[#3ecf8e] text-slate-900 dark:text-white ring-1 ring-[#3ecf8e]/30'
                        : 'bg-white dark:bg-[#181818] border-slate-200 dark:border-[#282828] text-slate-700 dark:text-[#A1A1A1] hover:bg-slate-50 dark:hover:bg-[#202020]'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium flex items-center gap-1.5">
                        <Coins className="w-3.5 h-3.5 text-emerald-600 dark:text-[#3ecf8e]" />
                        <span>Cash Box</span>
                      </span>
                      {paymentMethod === 'Physical_Cash' && <Check className="w-3 h-3 text-[#3ecf8e] stroke-[2.5]" />}
                    </div>
                    <span className="text-[9.5px] font-mono text-emerald-600 dark:text-[#3ecf8e] tabular-nums font-semibold leading-none">
                      Cash: {formatINR(cashBalance)}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* CARD 2: EXPENSE DETAILS */}
          <div className="p-4 sm:p-5 rounded-[12px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] shadow-2xs space-y-3.5">
            {/* Who ordered this */}
            <div className="space-y-1 min-w-0">
              <label className="block text-xs font-medium text-slate-700 dark:text-[#EDEDED]">
                Staff Member (Optional)
              </label>
              <SearchableSelect
                value={requestedByStaffCode}
                onChange={(val) => {
                  const found = staff.find((s) => s.staff_code === val);
                  if (found) {
                    setRequestedByStaffCode(found.staff_code);
                    setRequestedByStaffName(`${found.first_name} ${found.last_name || ''}`.trim());
                  } else {
                    setRequestedByStaffCode('');
                    setRequestedByStaffName('');
                  }
                }}
                options={staff.map((s) => ({
                  value: s.staff_code,
                  label: `${s.first_name} ${s.last_name || ''}`.trim(),
                  subLabel: s.department_name || s.designation,
                }))}
                placeholder="Select staff member..."
                allowCustom={false}
                clearable={true}
              />
            </div>

            {/* Mode-Specific Inputs */}
            {mode === 'Shop_Vendor' && (
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-[#222222]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-800 dark:text-[#EDEDED]">
                    Shop Details
                  </span>

                  <div className="flex items-center p-0.5 rounded-[6px] bg-slate-100 dark:bg-[#1e1e1e] border border-slate-200 dark:border-[#2e2e2e] self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('selection');
                        setIsMultiVendor(false);
                      }}
                      className={cn(
                        'px-2.5 py-1 text-[11px] font-medium rounded-[4px] transition-all cursor-pointer select-none',
                        !isMultiVendor
                          ? 'bg-white dark:bg-[#282828] text-slate-900 dark:text-white shadow-2xs font-semibold'
                          : 'text-slate-500 dark:text-[#888888] hover:text-slate-800 dark:hover:text-[#dddddd]'
                      )}
                    >
                      Single Shop
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('selection');
                        setIsMultiVendor(true);
                      }}
                      className={cn(
                        'px-2.5 py-1 text-[11px] font-medium rounded-[4px] transition-all cursor-pointer select-none',
                        isMultiVendor
                          ? 'bg-emerald-500/15 dark:bg-[#3ecf8e]/15 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/30 dark:border-[#3ecf8e]/30 shadow-2xs font-semibold'
                          : 'text-slate-500 dark:text-[#888888] hover:text-slate-800 dark:hover:text-[#dddddd]'
                      )}
                    >
                      Multiple Shops
                    </button>
                  </div>
                </div>

                {!isMultiVendor ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1 relative">
                        <div className="flex items-center justify-between">
                          <label className="block text-xs font-medium text-slate-700 dark:text-[#EDEDED]">
                            Paid To *
                          </label>
                          {matchingPayees.length > 0 && (
                            <span className="text-[10px] text-emerald-600 dark:text-[#3ecf8e] font-sans font-medium flex items-center gap-1 select-none">
                              <Sparkles className="w-3 h-3" />
                              <span>Smart Suggestions</span>
                            </span>
                          )}
                        </div>
                        <input
                          ref={payeeInputRef}
                          type="text"
                          value={recipientName}
                          onFocus={() => setIsPayeeDropdownOpen(true)}
                          onChange={(e) => {
                            setRecipientName(e.target.value);
                            setIsPayeeDropdownOpen(true);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setIsPayeeDropdownOpen(false);
                            }
                          }}
                          placeholder="e.g. Ramesh Tea Stall, Sharma Electrician"
                          className="w-full rounded-[6px] border border-slate-200 dark:border-[#282828] bg-white dark:bg-[#181818] px-3.5 py-2 text-slate-900 dark:text-white text-xs font-sans placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 h-10 min-h-[40px] shadow-2xs"
                        />

                        {/* Autocomplete Dropdown Popover */}
                        {isPayeeDropdownOpen && matchingPayees.length > 0 && (
                          <div
                            ref={payeeDropdownRef}
                            className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 rounded-[8px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] shadow-lg overflow-hidden divide-y divide-slate-100 dark:divide-[#242424] animate-in fade-in duration-100"
                          >
                            <div className="p-1.5 px-2 bg-slate-50 dark:bg-[#141414] text-[10px] font-sans text-slate-500 dark:text-zinc-400 flex items-center justify-between select-none">
                              <span className="font-medium">Frequent Payees</span>
                              <span className="font-mono text-emerald-600 dark:text-[#3ecf8e]">Auto-fills Category &amp; Dept</span>
                            </div>
                            <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 dark:divide-[#222222]">
                              {matchingPayees.map((payee) => (
                                <button
                                  key={payee.name}
                                  type="button"
                                  onClick={() => handleSelectPayee(payee)}
                                  className="w-full text-left p-2 hover:bg-slate-50 dark:hover:bg-[#202020] transition-colors flex items-center justify-between gap-2.5 cursor-pointer group"
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-xs font-semibold text-slate-900 dark:text-white group-hover:text-[#3ecf8e] transition-colors truncate">
                                        {payee.name}
                                      </span>
                                      <span className="px-1.5 py-0.2 rounded-[4px] bg-slate-100 dark:bg-[#242424] text-[9.5px] font-mono text-slate-600 dark:text-zinc-400 shrink-0">
                                        {payee.count} {payee.count === 1 ? 'bill' : 'bills'}
                                      </span>
                                    </div>
                                    {(payee.categoryName || payee.departmentName) && (
                                      <div className="flex items-center gap-1.5 text-[10.5px] text-slate-500 dark:text-zinc-400 mt-0.5 truncate">
                                        {payee.categoryName && (
                                          <span className="truncate">📁 {payee.categoryName}</span>
                                        )}
                                        {payee.categoryName && payee.departmentName && <span>•</span>}
                                        {payee.departmentName && (
                                          <span className="truncate">🏢 {payee.departmentName}</span>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  <span className="text-[10px] font-mono font-medium text-emerald-600 dark:text-[#3ecf8e] opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                    Apply ↵
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="block text-xs font-medium text-slate-700 dark:text-[#EDEDED]">
                            Bill No. (Optional)
                          </label>
                          {duplicateBillMatch && (
                            <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1 select-none animate-in fade-in">
                              <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                              <span>Duplicate Detected</span>
                            </span>
                          )}
                        </div>
                        <input
                          type="text"
                          value={billNumber}
                          onChange={(e) => setBillNumber(e.target.value)}
                          placeholder="e.g. Bill #104"
                          className={cn(
                            "w-full rounded-[6px] border bg-white dark:bg-[#181818] px-3.5 py-2 text-slate-900 dark:text-white text-xs font-mono placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none h-10 min-h-[40px] shadow-2xs transition-colors",
                            duplicateBillMatch
                              ? "border-amber-400 dark:border-amber-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30"
                              : "border-slate-200 dark:border-[#282828] focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30"
                          )}
                        />
                        {duplicateBillMatch && (
                          <div className="flex items-start gap-1.5 p-2 rounded-[6px] bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200 mt-1 animate-in fade-in duration-150">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                            <div className="leading-tight">
                              <span className="font-semibold">Possible Duplicate Bill: </span>
                              Bill #{duplicateBillMatch.bill_number} was already paid for{' '}
                              <span className="font-mono font-medium">{formatINR(duplicateBillMatch.total_amount)}</span> on{' '}
                              <span className="font-mono font-medium">{duplicateBillMatch.payment_date || duplicateBillMatch.created_at?.slice(0, 10)}</span>{' '}
                              ({duplicateBillMatch.recipient_name} • Voucher #{formatVoucherNumber(duplicateBillMatch.voucher_number)} • {duplicateBillMatch.branch_code}).
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-slate-700 dark:text-[#EDEDED]">
                          Category *
                        </label>
                        <SearchableSelect
                          value={categoryName}
                          onChange={setCategoryName}
                          options={categories.map((c) => ({
                            value: c.category_name,
                            label: c.category_name,
                          }))}
                          placeholder="Select category..."
                          allowCustom={false}
                          clearable={true}
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-slate-700 dark:text-[#EDEDED]">
                          Department *
                        </label>
                        <SearchableSelect
                          value={departmentName}
                          onChange={setDepartmentName}
                          options={departments.map((d) => ({
                            value: d.department_name,
                            label: d.department_name,
                          }))}
                          placeholder="Select department..."
                          allowCustom={false}
                          clearable={true}
                        />
                      </div>
                    </div>

                    {/* GST Tax Invoice Toggle & Inputs */}
                    <div className="pt-2.5 border-t border-slate-100 dark:border-[#242424] space-y-2.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-slate-800 dark:text-[#EDEDED] flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={isGstInvoice}
                            onChange={(e) => {
                              triggerHaptic('selection');
                              setIsGstInvoice(e.target.checked);
                            }}
                            className="w-3.5 h-3.5 rounded-[4px] text-[#3ecf8e] focus:ring-[#3ecf8e]/30 border-slate-300 dark:border-[#2e2e2e]"
                          />
                          <span>Tax Invoice (GST Registered Vendor)</span>
                        </label>
                        {isGstInvoice && (
                          <span className="text-[10px] font-mono text-[#3ecf8e] bg-emerald-500/10 px-2 py-0.5 rounded-[4px] border border-emerald-500/20 font-medium">
                            ITC Eligible
                          </span>
                        )}
                      </div>

                      {isGstInvoice && (
                        <div className="p-3 rounded-[8px] bg-slate-50 dark:bg-[#1a1a1c] border border-slate-200/80 dark:border-[#2a2a2e] space-y-2.5 text-xs animate-in fade-in">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <label className="block text-[11px] font-medium text-slate-600 dark:text-[#A1A1A1]">
                                  Vendor GSTIN
                                </label>
                                <button
                                  type="button"
                                  onClick={() => setVendorGstin('24')}
                                  className="text-[10px] text-[#3ecf8e] hover:underline font-mono cursor-pointer"
                                >
                                  + Gujarat (24)
                                </button>
                              </div>
                              <input
                                type="text"
                                maxLength={15}
                                value={vendorGstin}
                                onChange={(e) => setVendorGstin(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))}
                                placeholder="24AAAAA0000A1Z5"
                                className="w-full rounded-[6px] border border-slate-200 dark:border-[#282828] bg-white dark:bg-[#141414] px-3 py-1.5 text-slate-900 dark:text-white text-xs font-mono placeholder:text-slate-400 dark:placeholder:text-zinc-600 uppercase focus:outline-none focus:border-[#3ecf8e]"
                              />
                            </div>

                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <label className="block text-[11px] font-medium text-slate-600 dark:text-[#A1A1A1]">
                                  GST Rate
                                </label>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {activeGstSlabs.length} slabs active
                                </span>
                              </div>
                              <div className={cn(
                                'grid gap-1',
                                activeGstSlabs.length <= 4 ? 'grid-cols-4' : 'grid-cols-5'
                              )}>
                                {activeGstSlabs.map((slab) => (
                                  <button
                                    key={slab.rate}
                                    type="button"
                                    onClick={() => {
                                      triggerHaptic('selection');
                                      setGstRate(slab.rate);
                                    }}
                                    className={cn(
                                      'py-1.5 rounded-[4px] font-mono text-xs text-center border transition-all cursor-pointer',
                                      gstRate === slab.rate
                                        ? 'bg-[#3ecf8e]/15 border-[#3ecf8e] text-emerald-800 dark:text-[#3ecf8e] font-semibold'
                                        : 'bg-white dark:bg-[#202020] border-slate-200 dark:border-[#2e2e2e] text-slate-600 dark:text-zinc-400'
                                    )}
                                  >
                                    {slab.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Calculated Tax Breakdown Display */}
                          {finalCalculatedAmount > 0 && (
                            <div className="pt-2 border-t border-slate-200 dark:border-[#282828] grid grid-cols-3 gap-2 text-center font-mono text-[11px]">
                              <div className="p-1.5 rounded-[4px] bg-white dark:bg-[#141414] border border-slate-200/60 dark:border-[#242424]">
                                <span className="block text-[10px] text-slate-400">Taxable Amount</span>
                                <span className="font-semibold text-slate-800 dark:text-zinc-200 tabular-nums">
                                  {formatINR(gstBreakdown.taxable)}
                                </span>
                              </div>
                              <div className="p-1.5 rounded-[4px] bg-white dark:bg-[#141414] border border-slate-200/60 dark:border-[#242424]">
                                <span className="block text-[10px] text-slate-400">
                                  {gstBreakdown.igst > 0 ? 'IGST' : 'CGST + SGST'}
                                </span>
                                <span className="font-semibold text-emerald-600 dark:text-[#3ecf8e] tabular-nums">
                                  +{formatINR(gstBreakdown.totalGst)}
                                </span>
                              </div>
                              <div className="p-1.5 rounded-[4px] bg-white dark:bg-[#141414] border border-slate-200/60 dark:border-[#242424]">
                                <span className="block text-[10px] text-slate-400">Total Invoice</span>
                                <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                                  {formatINR(gstBreakdown.totalAmount)}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <VendorSplitTable
                    splits={vendorSplits}
                    categories={categories}
                    departments={departments}
                    targetAmount={Number(amount) || undefined}
                    onChange={setVendorSplits}
                  />
                )}
              </div>
            )}

            {mode === 'Staff_Split' && (
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-[#222222]">
                <StaffSplitTable
                  splits={splits}
                  staffList={staff}
                  categories={categories}
                  departments={departments}
                  targetAmount={Number(amount) || undefined}
                  onChange={setSplits}
                />
              </div>
            )}

            {mode === 'Courier' && (
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-[#222222]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-slate-700 dark:text-[#EDEDED]">
                      Courier Name *
                    </label>
                    <SearchableSelect
                      value={courierCompany}
                      onChange={setCourierCompany}
                      options={couriers.map((c) => ({
                        value: c.partner_name,
                        label: c.partner_name,
                      }))}
                      placeholder="Select courier (Maruti, DTDC)..."
                      allowCustom={false}
                      clearable={true}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-slate-700 dark:text-[#EDEDED]">
                      Tracking / Agent Name *
                    </label>
                    <input
                      type="text"
                      value={trackingNumber}
                      onChange={(e) => setTrackingNumber(e.target.value)}
                      placeholder="e.g. Ramesh Bhai / Track No."
                      className="w-full rounded-[6px] border border-slate-200 dark:border-[#282828] bg-white dark:bg-[#181818] px-3.5 py-2 text-slate-900 dark:text-white text-xs font-mono placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 h-10 min-h-[40px] shadow-2xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-slate-700 dark:text-[#EDEDED]">
                      Category *
                    </label>
                    <SearchableSelect
                      value={categoryName}
                      onChange={setCategoryName}
                      options={categories.map((c) => ({
                        value: c.category_name,
                        label: c.category_name,
                      }))}
                      placeholder="Select category..."
                      allowCustom={false}
                      clearable={true}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-slate-700 dark:text-[#EDEDED]">
                      Department *
                    </label>
                    <SearchableSelect
                      value={departmentName}
                      onChange={setDepartmentName}
                      options={departments.map((d) => ({
                        value: d.department_name,
                        label: d.department_name,
                      }))}
                      placeholder="Select department..."
                      allowCustom={false}
                      clearable={true}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Notes / Reason */}
            <div className="pt-2 border-t border-slate-100 dark:border-[#222222] space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-slate-700 dark:text-[#EDEDED]">
                  Reason *
                </label>
                <span className="font-mono text-[10.5px] text-slate-400 dark:text-zinc-500">
                  {remarks.length} / 255
                </span>
              </div>

              <textarea
                rows={2}
                maxLength={255}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value.slice(0, 255))}
                placeholder="Why was this money spent? (e.g. Tea for floor staff)"
                className="w-full rounded-[6px] border border-slate-200 dark:border-[#262626] bg-slate-50/50 dark:bg-[#121212] p-2.5 text-slate-900 dark:text-white text-xs font-sans placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-[#3ecf8e] resize-none shadow-2xs leading-relaxed"
              />
            </div>
          </div>

            </div>
            {/* END LEFT COLUMN */}

            {/* RIGHT COLUMN (lg:col-span-4): Attach Bill, Total Amount & Review & Pay Dock */}
            <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-4">
              {/* CARD 3: ATTACH PHOTO */}
              <div className="p-4 sm:p-5 rounded-[12px] bg-white dark:bg-[#171717] border border-slate-200/80 dark:border-[#242424] shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-slate-900 dark:text-[#EDEDED] font-sans block">
                      Attach Bill (Optional)
                    </span>
                    <span className="text-[11px] text-slate-400 dark:text-[#707070] font-sans mt-0.5 block">
                      Upload photo of bill, voucher slip, or receipt
                    </span>
                  </div>

                  <span className="px-2 py-0.5 rounded-[4px] bg-slate-100 dark:bg-[#202020] text-slate-500 dark:text-[#8e8e8e] text-[10px] font-mono border border-slate-200/80 dark:border-[#282828] shrink-0 tabular-nums">
                    {photoUrls.length} / 4
                  </span>
                </div>

                <BillUploader photoUrls={photoUrls} onChange={setPhotoUrls} maxPhotos={4} />
              </div>

              {/* CARD 4: TOTAL & ACTION DOCK */}
              <div className="p-4 sm:p-5 rounded-[12px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] shadow-2xs space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10.5px] text-slate-400 dark:text-zinc-500 font-sans block font-medium">
                      Total Amount
                    </span>
                    <span className="text-3xl font-medium font-mono text-slate-900 dark:text-white tabular-nums tracking-tight block">
                      {formatINR(finalCalculatedAmount)}
                    </span>
                  </div>
                  <span className="px-2.5 py-1 rounded-[6px] text-xs font-mono font-medium bg-slate-100 dark:bg-[#202020] text-slate-700 dark:text-zinc-300 border border-slate-200 dark:border-[#2e2e2e]">
                    {paymentMethod === 'Physical_Cash' ? 'Cash Box' : 'Online UPI'}
                  </span>
                </div>

                {/* Main Review & Pay CTA */}
                <button
                  type="submit"
                  disabled={
                    submitting ||
                    (isInsufficientBalance && !allowNegative) ||
                    (isPeriodLocked && !allowLockedPeriod && !isPrivilegedAdminRole(user?.role_code))
                  }
                  className={cn(
                    'w-full h-11 px-5 rounded-[6px] font-sans font-medium text-sm tracking-tight transition-all cursor-pointer select-none flex items-center justify-center gap-2 shadow-2xs',
                    isInsufficientBalance && !allowNegative
                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-300 dark:border-rose-900/60 cursor-not-allowed'
                      : isInsufficientBalance && allowNegative
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold'
                      : isPeriodLocked && !allowLockedPeriod && !isPrivilegedAdminRole(user?.role_code)
                      ? 'bg-amber-600 text-white cursor-not-allowed opacity-80'
                      : 'bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] shadow-emerald-500/20 shadow-md font-semibold'
                  )}
                >
                  <Zap className="w-4 h-4 text-[#171717] stroke-[2.5]" />
                  <span>
                    {submitting
                      ? 'Checking...'
                      : isInsufficientBalance && !allowNegative
                      ? 'Not Enough Cash in Box'
                      : 'Review & Pay (F2)'}
                  </span>
                </button>

                {/* Secondary buttons */}
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 dark:border-[#222222]">
                  {/* Clear — rose/destructive tone */}
                  <button
                    type="button"
                    onClick={handleResetForm}
                    className="h-9 px-3 flex items-center justify-center gap-1.5 rounded-[6px] border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/20 hover:border-rose-300 dark:hover:border-rose-500/50 active:scale-[0.98] transition-all cursor-pointer text-xs font-medium"
                    title="Reset all form fields"
                  >
                    <RotateCcw className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Clear</span>
                  </button>

                  {/* Cancel — neutral slate with X feel */}
                  <button
                    type="button"
                    onClick={() => setActivePage('dashboard')}
                    className="h-9 px-3 rounded-[6px] border border-slate-300 dark:border-[#333333] bg-white dark:bg-[#1f1f1f] text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#2a2a2a] hover:border-slate-400 dark:hover:border-[#444] active:scale-[0.98] font-sans text-xs cursor-pointer transition-all font-medium flex items-center justify-center gap-1.5 shadow-2xs"
                  >
                    <span className="font-mono text-[10px] px-1 py-0.5 rounded-[3px] bg-slate-100 dark:bg-[#2a2a2a] border border-slate-200 dark:border-[#3a3a3a] text-slate-500 dark:text-zinc-400 leading-none">ESC</span>
                    <span>Cancel</span>
                  </button>
                </div>

                {/* POS Keyboard hints */}
                <div className="pt-2 border-t border-slate-100 dark:border-[#222222] flex items-center justify-between text-[11px] font-mono text-slate-400 dark:text-zinc-500">
                  <span>F2: Save &amp; Pay</span>
                  <span>F6: Add Cash</span>
                  <span>Alt+1-3: Mode</span>
                </div>
              </div>
            </div>
            {/* END RIGHT COLUMN */}

          </div>
        </form>

        {/* PREVIEW & CONFIRMATION MODAL (Step before final payment) */}
        {isPreviewOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 animate-in fade-in duration-100">
            <div className="w-full max-w-lg bg-white dark:bg-[#18181b] border border-slate-200 dark:border-[#2e2e32] rounded-[12px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col font-sans">
              {/* Modal Header */}
              <div className="px-5 py-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-[#3ecf8e]" />
                  <h3 className="text-base font-medium text-slate-900 dark:text-white">
                    Review Payment
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPreviewOpen(false)}
                  className="p-1 rounded-[6px] text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body: Voucher Summary Slip */}
              <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                <div className="p-4 rounded-[8px] bg-slate-50 dark:bg-[#121214] border border-slate-200 dark:border-[#242426] text-center space-y-1">
                  <span className="text-[11px] font-sans text-slate-500 dark:text-zinc-400 uppercase tracking-wider block font-medium">
                    Amount to Pay
                  </span>
                  <span className="text-3xl font-mono font-medium text-emerald-600 dark:text-[#3ecf8e] tabular-nums tracking-tight block">
                    {formatINR(finalCalculatedAmount)}
                  </span>
                  <span className="text-xs font-mono text-slate-600 dark:text-zinc-300 block">
                    {numberToWordsINR(finalCalculatedAmount)}
                  </span>
                </div>

                <div className="rounded-[8px] border border-slate-200 dark:border-[#242426] bg-white dark:bg-[#141416] divide-y divide-slate-100 dark:divide-white/5 text-xs">
                  <div className="flex items-center justify-between p-3">
                    <span className="text-slate-500 dark:text-zinc-400">Pay Mode:</span>
                    <span className="font-medium text-slate-900 dark:text-white flex items-center gap-1.5">
                      {paymentMethod === 'Physical_Cash' ? (
                        <>
                          <Coins className="w-3.5 h-3.5 text-emerald-500" />
                          <span>Cash Box</span>
                        </>
                      ) : (
                        <>
                          <CreditCard className="w-3.5 h-3.5 text-sky-500" />
                          <span>Online UPI</span>
                        </>
                      )}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-3">
                    <span className="text-slate-500 dark:text-zinc-400">Paid To:</span>
                    <span className="font-medium text-slate-900 dark:text-white text-right truncate max-w-[240px]">
                      {mode === 'Shop_Vendor'
                        ? isMultiVendor
                          ? vendorSplits.length === 1
                            ? vendorSplits[0].vendor_name.trim()
                            : `${vendorSplits.length} Vendors (${vendorSplits.map((v) => v.vendor_name.trim().split(' ')[0]).join(', ')})`
                          : recipientName.trim()
                        : mode === 'Courier'
                        ? courierCompany.trim()
                        : splits.length === 1
                        ? splits[0].staffName.trim()
                        : `${splits.length} Staff (${splits.map((s) => s.staffName.trim().split(' ')[0]).join(', ')})`}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-3">
                    <span className="text-slate-500 dark:text-zinc-400">Category &amp; Dept:</span>
                    <span className="text-slate-700 dark:text-zinc-300 text-right truncate max-w-[260px]">
                      {mode === 'Staff_Split'
                        ? `${Array.from(new Set(splits.map((s) => s.categoryName.trim()).filter(Boolean))).join(', ')} • ${Array.from(new Set(splits.map((s) => s.departmentName.trim()).filter(Boolean))).join(', ')}`
                        : mode === 'Shop_Vendor' && isMultiVendor
                        ? `${Array.from(new Set(vendorSplits.map((v) => v.category_name.trim()).filter(Boolean))).join(', ')} • ${Array.from(new Set(vendorSplits.map((v) => v.department_name.trim()).filter(Boolean))).join(', ')}`
                        : `${categoryName.trim()} • ${departmentName.trim()}`}
                    </span>
                  </div>

                  {mode === 'Staff_Split' && splits.length > 0 && (
                    <div className="p-3 space-y-1.5 bg-slate-50/50 dark:bg-[#111113]">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-zinc-400 block">
                        Staff Allocation Breakdown:
                      </span>
                      <div className="space-y-1">
                        {splits.map((s, idx) => (
                          <div key={idx} className="flex items-center justify-between text-[11px] py-1 border-b border-slate-100 dark:border-white/5 last:border-b-0">
                            <div className="truncate pr-2">
                              <span className="font-medium text-slate-900 dark:text-white">{s.staffName.trim()}</span>
                              <span className="text-slate-500 dark:text-zinc-400 ml-1.5">
                                ({s.categoryName.trim()} • {s.departmentName.trim()})
                              </span>
                            </div>
                            <span className="font-mono font-medium text-slate-900 dark:text-white shrink-0 tabular-nums">
                              {formatINR(Number(s.amount) || 0)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {mode === 'Shop_Vendor' && isMultiVendor && vendorSplits.length > 0 && (
                    <div className="p-3 space-y-1.5 bg-slate-50/50 dark:bg-[#111113]">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-zinc-400 block">
                        Vendor Split Breakdown:
                      </span>
                      <div className="space-y-1">
                        {vendorSplits.map((v, idx) => (
                          <div key={idx} className="flex items-center justify-between text-[11px] py-1 border-b border-slate-100 dark:border-white/5 last:border-b-0">
                            <div className="truncate pr-2">
                              <span className="font-medium text-slate-900 dark:text-white">{v.vendor_name.trim()}</span>
                              <span className="text-slate-500 dark:text-zinc-400 ml-1.5">
                                ({v.category_name.trim()} • {v.department_name.trim()})
                              </span>
                            </div>
                            <span className="font-mono font-medium text-slate-900 dark:text-white shrink-0 tabular-nums">
                              {formatINR(Number(v.amount) || 0)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between p-3">
                    <span className="text-slate-500 dark:text-zinc-400">Bill Number:</span>
                    <span className="font-mono text-slate-900 dark:text-white">
                      #{currBranch.branch_code}-{voucherDigits.trim() || 'AUTO'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-3">
                    <span className="text-slate-500 dark:text-zinc-400">Date:</span>
                    <span className="font-mono text-slate-900 dark:text-white">
                      {format(new Date(paymentDate), 'dd MMMM yyyy')}
                    </span>
                  </div>

                  {mode === 'Courier' && trackingNumber && (
                    <div className="flex items-center justify-between p-3">
                      <span className="text-slate-500 dark:text-zinc-400">Docket / Tracking:</span>
                      <span className="font-mono text-slate-900 dark:text-white font-medium">
                        {trackingNumber}
                      </span>
                    </div>
                  )}

                  {requestedByStaffName && (
                    <div className="flex items-center justify-between p-3">
                      <span className="text-slate-500 dark:text-zinc-400">Ordered By:</span>
                      <span className="text-slate-700 dark:text-zinc-300">
                        {requestedByStaffName}
                      </span>
                    </div>
                  )}

                  <div className="p-3 space-y-1">
                    <span className="text-slate-500 dark:text-zinc-400 block">Reason / Notes:</span>
                    <p className="text-slate-800 dark:text-zinc-200 leading-relaxed font-sans">
                      {remarks}
                    </p>
                  </div>

                  {photoUrls.length > 0 && (
                    <div className="flex items-center justify-between p-3">
                      <span className="text-slate-500 dark:text-zinc-400">Bill Photos:</span>
                      <span className="text-emerald-600 dark:text-[#3ecf8e] font-mono">
                        {photoUrls.length} attached
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="p-4 border-t border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-[#141416] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsPreviewOpen(false)}
                  className="h-9 px-4 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#1f1f1f] hover:bg-slate-100 dark:hover:bg-[#282828] text-slate-700 dark:text-zinc-300 font-medium text-xs transition-colors cursor-pointer"
                >
                  Go Back &amp; Edit
                </button>

                <SubmitButton
                  type="button"
                  submitting={submitting}
                  submittingText="Saving..."
                  onClick={executeFinalDisbursal}
                  size="md"
                >
                  Confirm &amp; Pay (Enter)
                </SubmitButton>
              </div>
            </div>
          </div>
        )}

        

      </div>
    </div>
  );
};
