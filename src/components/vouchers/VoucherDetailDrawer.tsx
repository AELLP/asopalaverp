import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useAuthStore, isPrivilegedAdminRole } from '@/store/authStore';
import { erpService } from '@/lib/erpService';
import { SlideOverDrawer } from '@/components/ui/SlideOverDrawer';
import { formatINR, formatDate, formatVoucherNumber, numberToWordsINR, triggerHaptic } from '@/lib/utils';
import { useVouchers } from '@/hooks/useVouchers';
import { useVoucherStore } from '@/store/voucherStore';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { StaffSplitTable, SplitItem } from '@/components/vouchers/StaffSplitTable';
import { VendorSplitTable } from '@/components/vouchers/VendorSplitTable';
import { VendorSplitItem } from '@/types/database';
import {
  XCircle,
  Eye,
  AlertTriangle,
  Trash2,
  Building2,
  Wallet,
  Check,
  Smartphone,
  Truck,
  Edit3,
  Save,
  Undo,
  Users,
  Loader2,
  Printer,
  Shield,
  Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { showToast } from '@/components/ui/ToastContainer';
import { useOverrideStore } from '@/store/overrideStore';
import { uploadToR2 } from '@/lib/r2';
import { supabase } from '@/lib/supabase';

export const VoucherDetailDrawer: React.FC = () => {
  const { activeDrawerVoucher, setActiveDrawerVoucher, closeDrawer, openLightbox } = useUIStore();
  const { user, can } = useAuthStore();
  const { isCashierVoidAllowed } = useOverrideStore();
  const { vouchers, categories, departments, staff, refresh } = useVouchers();

  const [activeAction, setActiveAction] = useState<'none' | 'void' | 'delete'>('none');
  const [actionReason, setActionReason] = useState('');
  const [loadingAction, setLoadingAction] = useState(false);
  const [cashReturnedToDrawer, setCashReturnedToDrawer] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isUploadingBill, setIsUploadingBill] = useState(false);
  const billFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleBillPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !activeDrawerVoucher) return;
    setIsUploadingBill(true);
    triggerHaptic('light');

    const toastId = 'reupload-bill-toast';
    showToast({
      id: toastId,
      type: 'loading',
      title: 'Uploading Receipt',
      message: `Saving ${files.length} receipt photo(s)...`,
      durationMs: 8000,
    });

    try {
      const uploadPromises = Array.from(files).map(f => uploadToR2(f, 'receipts', f.name));
      const uploadedUrls = await Promise.all(uploadPromises);
      const validR2Urls = uploadedUrls.filter(u => u && u.startsWith('http') && !u.startsWith('blob:'));

      if (validR2Urls.length === 0) {
        throw new Error('Could not process receipt photo.');
      }

      const existingCleanUrls = (activeDrawerVoucher.bill_photo_urls || []).filter(
        (url: string) => !url.startsWith('blob:')
      );
      const combinedUrls = [...existingCleanUrls, ...validR2Urls];

      const { error: dbError } = await supabase
        .from('expense_vouchers')
        .update({ bill_photo_urls: combinedUrls })
        .eq('id', activeDrawerVoucher.id);

      if (dbError) throw dbError;

      const updatedVoucher = { ...activeDrawerVoucher, bill_photo_urls: combinedUrls };
      setActiveDrawerVoucher(updatedVoucher);
      refresh();
      triggerHaptic('success');

      showToast({
        id: toastId,
        type: 'success',
        title: 'Receipt Attached',
        message: validR2Urls.length === 1 ? 'Receipt photo saved successfully.' : `${validR2Urls.length} receipt photos saved successfully.`,
      });
    } catch (err: any) {
      console.error('Re-upload bill error:', err);
      triggerHaptic('error');
      showToast({
        id: toastId,
        type: 'error',
        title: 'Upload Failed',
        message: err?.message || 'Could not upload receipt photo. Please try again.',
      });
    } finally {
      setIsUploadingBill(false);
      if (billFileInputRef.current) billFileInputRef.current.value = '';
    }
  };

  // Edit Mode States
  const [isEditing, setIsEditing] = useState(false);
  const [editRecipient, setEditRecipient] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editDepartment, setEditDepartment] = useState('');
  const [editStaffCode, setEditStaffCode] = useState('');
  const [editStaffName, setEditStaffName] = useState('');
  const [editBillNumber, setEditBillNumber] = useState('');
  const [editPaymentMethod, setEditPaymentMethod] = useState<'Physical_Cash' | 'Online_UPI'>('Physical_Cash');
  const [editPaymentDate, setEditPaymentDate] = useState('');
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editCourier, setEditCourier] = useState('');
  const [editRemarks, setEditRemarks] = useState('');
  const [editReason, setEditReason] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [staffSplits, setStaffSplits] = useState<any[]>([]);
  const [loadingSplits, setLoadingSplits] = useState(false);
  const [editStaffSplits, setEditStaffSplits] = useState<SplitItem[]>([]);
  const [editVendorSplits, setEditVendorSplits] = useState<VendorSplitItem[]>([]);

  // Populate edit fields when active voucher changes
  useEffect(() => {
    if (activeDrawerVoucher) {
      setEditRecipient(activeDrawerVoucher.recipient_name || '');
      setEditCategory(activeDrawerVoucher.category_name || '');
      setEditDepartment(activeDrawerVoucher.department_name || '');
      setEditStaffCode(activeDrawerVoucher.requested_by_staff_code || '');
      setEditStaffName(activeDrawerVoucher.requested_by_staff_name || '');
      setEditBillNumber(activeDrawerVoucher.bill_number || '');
      setEditPaymentMethod(activeDrawerVoucher.payment_method || 'Physical_Cash');
      setEditPaymentDate(activeDrawerVoucher.payment_date ? activeDrawerVoucher.payment_date.slice(0, 10) : '');
      setEditAmount(Number(activeDrawerVoucher.total_amount) || 0);
      setEditCourier(activeDrawerVoucher.courier_partner_name || '');
      setEditRemarks(activeDrawerVoucher.remarks || '');
      setEditReason('');
      setIsEditing(false);
      setActiveAction('none');
      setFeedback(null);
      setCashReturnedToDrawer(false);

      const isStaffType =
        activeDrawerVoucher.payment_type === 'Staff_Split' ||
        Boolean(activeDrawerVoucher.recipient_name && /\bStaff\b/i.test(activeDrawerVoucher.recipient_name));

      if (isStaffType) {
        setLoadingSplits(true);
        erpService.getVoucherSplits(activeDrawerVoucher.voucher_number)
          .then((splits) => {
            const list: any[] = splits || [];
            setStaffSplits(list);
            setEditStaffSplits(
              list.map((s: any) => ({
                staffCode: s.staff_code || s.staffCode || '',
                staffName: s.staff_name || s.staffName || '',
                departmentName: s.department_name || s.departmentName || '',
                categoryName: s.category_name || s.categoryName || '',
                amount: Number(s.amount) || 0,
              }))
            );
          })
          .catch((err) => {
            console.error('Failed to load splits from database:', err);
            setStaffSplits([]);
          })
          .finally(() => {
            setLoadingSplits(false);
          });
      } else {
        setStaffSplits([]);
        setEditStaffSplits([]);
        setLoadingSplits(false);
      }

      if (
        !isStaffType &&
        activeDrawerVoucher.payment_type === 'Shop_Vendor' &&
        activeDrawerVoucher.vendor_splits &&
        Array.isArray(activeDrawerVoucher.vendor_splits) &&
        activeDrawerVoucher.vendor_splits.length > 0
      ) {
        setEditVendorSplits(activeDrawerVoucher.vendor_splits);
      } else {
        setEditVendorSplits([]);
      }
    }
  }, [activeDrawerVoucher, staff]);

  // Duplicate Bill Number Radar for edit mode (Declared at top level - zero conditional hook violations)
  const duplicateEditBillMatch = useMemo(() => {
    const clean = editBillNumber.trim().toLowerCase();
    if (!clean || clean.length < 3 || !activeDrawerVoucher) return null;
    const allLoaded = Object.values(useVoucherStore.getState().vouchers).flat();
    const searchList = allLoaded.length > 0 ? allLoaded : (vouchers || []);
    return (
      searchList.find((item) => {
        if (item.status === 'Voided') return false;
        if (item.voucher_number === activeDrawerVoucher.voucher_number) return false;
        const vBill = (item.bill_number || '').trim().toLowerCase();
        return vBill === clean;
      }) || null
    );
  }, [editBillNumber, vouchers, activeDrawerVoucher]);

  if (!activeDrawerVoucher) return null;

  const v = activeDrawerVoucher;
  const isPrivileged = isPrivilegedAdminRole(user?.role_code);
  const isAuditor = user?.role_code === 'Auditor';
  const isStoreManager = user?.role_code === 'Store_Manager' || user?.role_code?.toLowerCase() === 'store_manager';
  const isCashier = user?.role_code === 'Cashier' || user?.role_code === 'Showroom_Cashier' || user?.role_code?.toLowerCase() === 'cashier';

  const todayStr = new Date().toISOString().slice(0, 10);
  const voucherDate = (v.payment_date || v.created_at || '').slice(0, 10);
  const isTodayVoucher = voucherDate === todayStr;

  // RBAC:
  // - Auditor: strictly read-only
  // - Super Admin: full master override
  // - Store Manager: can edit & void TODAY'S vouchers only
  // - Cashier: can edit TODAY'S vouchers details only (monetary amount adjustments require manager)
  const canEditVoucher = !isAuditor && (isPrivileged || ((isStoreManager || isCashier) && isTodayVoucher));
  const canVoid = !isAuditor && (isPrivileged || (isStoreManager && isTodayVoucher));
  const canDelete = !isAuditor && isPrivileged;

  const isStaffVoucher = v.payment_type === 'Staff_Split' || editStaffSplits.length > 0 || staffSplits.length > 0;
  const isMultiVendorVoucher =
    !isStaffVoucher &&
    v.payment_type === 'Shop_Vendor' &&
    ((v.vendor_splits && v.vendor_splits.length > 0) || editVendorSplits.length > 0);

  const handleSaveEdit = async () => {
    // Solution 2: Prevent Cashier Amount Tampering
    if (isCashier && Math.abs(editAmount - Number(v.total_amount)) > 0.001) {
      setFeedback({
        type: 'error',
        message: 'Cashiers cannot modify bill amounts. Adjusting payout amounts requires Store Manager authorization.',
      });
      return;
    }

    if (isStaffVoucher) {
      if (editStaffSplits.length === 0) {
        setFeedback({ type: 'error', message: 'Please add at least one staff member.' });
        return;
      }
      const invalidIdx = editStaffSplits.findIndex(
        (s) =>
          !s.staffCode?.trim() ||
          !s.staffName?.trim() ||
          !s.categoryName?.trim() ||
          !s.departmentName?.trim() ||
          Number(s.amount) <= 0
      );
      if (invalidIdx !== -1) {
        const s = editStaffSplits[invalidIdx];
        const rowNum = invalidIdx + 1;
        setFeedback({
          type: 'error',
          message:
            !s.staffCode?.trim() || !s.staffName?.trim()
              ? `Row #${rowNum}: Please select a staff member.`
              : !s.categoryName?.trim()
              ? `Row #${rowNum} (${s.staffName}): Please select an expense category.`
              : !s.departmentName?.trim()
              ? `Row #${rowNum} (${s.staffName}): Please select a department.`
              : `Row #${rowNum} (${s.staffName}): Amount must be greater than ₹0.`,
        });
        return;
      }
    } else if (isMultiVendorVoucher) {
      if (editVendorSplits.length === 0) {
        setFeedback({ type: 'error', message: 'Please add at least one vendor item.' });
        return;
      }
      const invalidIdx = editVendorSplits.findIndex(
        (s) =>
          !s.vendor_name?.trim() ||
          !s.category_name?.trim() ||
          !s.department_name?.trim() ||
          Number(s.amount) <= 0
      );
      if (invalidIdx !== -1) {
        const s = editVendorSplits[invalidIdx];
        const rowNum = invalidIdx + 1;
        setFeedback({
          type: 'error',
          message: !s.vendor_name?.trim()
            ? `Row #${rowNum}: Please enter a vendor name.`
            : !s.category_name?.trim()
            ? `Row #${rowNum} (${s.vendor_name}): Please select an expense category.`
            : !s.department_name?.trim()
            ? `Row #${rowNum} (${s.vendor_name}): Please select a department.`
            : `Row #${rowNum} (${s.vendor_name}): Amount must be greater than ₹0.`,
        });
        return;
      }
    } else {
      if (!editRecipient || !editRecipient.trim()) {
        setFeedback({ type: 'error', message: 'Payee / Vendor name is required.' });
        return;
      }
      if (!editCategory || !editCategory.trim()) {
        setFeedback({ type: 'error', message: 'Expense Category is required.' });
        return;
      }
      if (!editDepartment || !editDepartment.trim()) {
        setFeedback({ type: 'error', message: 'Department is required.' });
        return;
      }
    }

    if (editAmount <= 0) {
      setFeedback({ type: 'error', message: 'Amount must be greater than zero.' });
      return;
    }
    if (!editReason || editReason.trim().length < 3) {
      setFeedback({ type: 'error', message: 'Modification justification is mandatory (min 3 chars).' });
      return;
    }

    setSavingEdit(true);
    setFeedback(null);

    try {
      const cleanedStaffSplits = isStaffVoucher
        ? editStaffSplits.map((s) => ({
            ...s,
            staffCode: s.staffCode.trim(),
            staffName: s.staffName.trim(),
            categoryName: s.categoryName.trim(),
            departmentName: s.departmentName.trim(),
            amount: Number(s.amount) || 0,
          }))
        : undefined;

      const cleanedVendorSplits = isMultiVendorVoucher
        ? editVendorSplits.map((s) => ({
            ...s,
            vendor_name: s.vendor_name.trim(),
            category_name: s.category_name.trim(),
            department_name: s.department_name.trim(),
            bill_number: s.bill_number?.trim() || '',
            description: s.description?.trim() || '',
            amount: Number(s.amount) || 0,
          }))
        : undefined;

      const updates: any = {
        recipient_name:
          isStaffVoucher && cleanedStaffSplits
            ? cleanedStaffSplits.length === 1
              ? cleanedStaffSplits[0].staffName
              : `${cleanedStaffSplits.length} Staff (${cleanedStaffSplits.map((s) => s.staffName.split(' ')[0]).join(', ')})`
            : isMultiVendorVoucher && cleanedVendorSplits
            ? cleanedVendorSplits.length === 1
              ? cleanedVendorSplits[0].vendor_name
              : `${cleanedVendorSplits.length} Vendors (${cleanedVendorSplits.map((v) => v.vendor_name.split(' ')[0]).join(', ')})`
            : editRecipient.trim(),
        category_name:
          isStaffVoucher && cleanedStaffSplits
            ? Array.from(new Set(cleanedStaffSplits.map((s) => s.categoryName).filter(Boolean))).join(', ')
            : isMultiVendorVoucher && cleanedVendorSplits
            ? Array.from(new Set(cleanedVendorSplits.map((v) => v.category_name).filter(Boolean))).join(', ')
            : editCategory.trim(),
        department_name:
          isStaffVoucher && cleanedStaffSplits
            ? Array.from(new Set(cleanedStaffSplits.map((s) => s.departmentName).filter(Boolean))).join(', ')
            : isMultiVendorVoucher && cleanedVendorSplits
            ? Array.from(new Set(cleanedVendorSplits.map((v) => v.department_name).filter(Boolean))).join(', ')
            : editDepartment.trim(),
        requested_by_staff_code: editStaffCode || null,
        requested_by_staff_name: editStaffName || null,
        bill_number: editBillNumber ? editBillNumber.trim() : null,
        payment_method: editPaymentMethod,
        payment_date: editPaymentDate,
        total_amount: editAmount,
        courier_partner_name: editCourier ? editCourier.trim() : null,
        remarks: editRemarks ? editRemarks.trim() : '',
        vendor_splits: isStaffVoucher ? null : cleanedVendorSplits,
      };

      await erpService.updateVoucher(
        v.voucher_number,
        updates,
        `${user?.first_name || 'Admin'} ${user?.last_name || ''}`.trim(),
        user?.role_code || 'Store_Manager',
        editReason.trim(),
        cleanedStaffSplits
      );

      if (isStaffVoucher) {
        const freshSplits = await erpService.getVoucherSplits(v.voucher_number);
        setStaffSplits(freshSplits || []);
      }

      const updatedVoucher = {
        ...v,
        ...updates,
      };

      setActiveDrawerVoucher(updatedVoucher);
      setIsEditing(false);
      setFeedback({
        type: 'success',
        message: `Expense Bill #${formatVoucherNumber(v.voucher_number)} updated successfully.`,
      });
      showToast({
        type: 'success',
        title: 'Bill Updated',
        message: `Voucher #${formatVoucherNumber(v.voucher_number)} updated in database.`,
      });
      refresh(true);
    } catch (err: any) {
      console.error('Error updating voucher:', err);
      setFeedback({
        type: 'error',
        message: 'Failed to update voucher: ' + (err.message || 'Unknown error'),
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditRecipient(v.recipient_name || '');
    setEditCategory(v.category_name || '');
    setEditDepartment(v.department_name || '');
    setEditStaffCode(v.requested_by_staff_code || '');
    setEditStaffName(v.requested_by_staff_name || '');
    setEditBillNumber(v.bill_number || '');
    setEditPaymentMethod(v.payment_method || 'Physical_Cash');
    setEditPaymentDate(v.payment_date ? v.payment_date.slice(0, 10) : '');
    setEditAmount(Number(v.total_amount) || 0);
    setEditCourier(v.courier_partner_name || '');
    setEditRemarks(v.remarks || '');
    setEditReason('');
    setEditStaffSplits(
      staffSplits.map((s: any) => ({
        staffCode: s.staff_code || s.staffCode || '',
        staffName: s.staff_name || s.staffName || '',
        departmentName: s.department_name || s.departmentName || '',
        categoryName: s.category_name || s.categoryName || '',
        amount: Number(s.amount) || 0,
      }))
    );
    setEditVendorSplits(
      !isStaffVoucher && v.payment_type === 'Shop_Vendor' && v.vendor_splits && Array.isArray(v.vendor_splits)
        ? v.vendor_splits
        : []
    );
    setFeedback(null);
  };

  const handleVoidVoucher = async () => {
    if (!actionReason || actionReason.trim().length < 3) {
      setFeedback({ type: 'error', message: 'Void reason is required (minimum 3 characters).' });
      return;
    }

    setLoadingAction(true);
    setFeedback(null);
    try {
      await erpService.voidVoucher(
        v,
        actionReason.trim(),
        `${user?.first_name} ${user?.last_name}`,
        user?.role_code || 'Super_Admin',
        cashReturnedToDrawer
      );
      showToast({
        type: 'success',
        title: 'Voucher Voided',
        message: isTodayVoucher || cashReturnedToDrawer
          ? `Voucher #${formatVoucherNumber(v.voucher_number)} voided. ₹${v.total_amount} refunded to drawer.`
          : `Voucher #${formatVoucherNumber(v.voucher_number)} voided in accounting. Drawer balance unchanged.`,
      });
      setFeedback({
        type: 'success',
        message: isTodayVoucher || cashReturnedToDrawer
          ? `Voucher ${formatVoucherNumber(v.voucher_number)} voided and ₹${v.total_amount} refunded to drawer.`
          : `Voucher ${formatVoucherNumber(v.voucher_number)} cancelled in accounting. Drawer balance unchanged.`,
      });
      setTimeout(() => {
        closeDrawer();
      }, 800);
    } catch (err: any) {
      console.error('Error voiding voucher:', err);
      setFeedback({ type: 'error', message: 'Failed to void voucher: ' + (err.message || 'Unknown error') });
    } finally {
      setLoadingAction(false);
    }
  };

  const handleDeleteVoucher = async () => {
    if (!actionReason || actionReason.trim().length < 3) {
      setFeedback({ type: 'error', message: 'Super Admin deletion reason is mandatory for audit trail.' });
      return;
    }

    setLoadingAction(true);
    setFeedback(null);
    try {
      await erpService.deleteVoucher(
        v,
        `${user?.first_name} ${user?.last_name}`,
        user?.role_code || 'Super_Admin',
        actionReason.trim(),
        cashReturnedToDrawer
      );
      showToast({
        type: 'success',
        title: 'Voucher Deleted',
        message: `Voucher #${formatVoucherNumber(v.voucher_number)} permanently purged from system.`,
      });
      setFeedback({
        type: 'success',
        message: `Voucher ${formatVoucherNumber(v.voucher_number)} permanently deleted by Super Admin.`,
      });
      setTimeout(() => {
        closeDrawer();
      }, 800);
    } catch (err: any) {
      setFeedback({ type: 'error', message: 'Failed to delete voucher: ' + (err.message || 'Unknown error') });
    } finally {
      setLoadingAction(false);
    }
  };

  const statusBadge = (
    <span
      className={cn(
        'px-2 py-0.5 rounded-[4px] text-[10px] font-mono font-medium border select-none',
        v.status === 'Approved' || !v.status
          ? 'badge-status-emerald'
          : v.status === 'Voided'
          ? 'badge-status-rose'
          : 'badge-status-amber'
      )}
    >
      ● {v.status || 'Approved'}
    </span>
  );

  const handleStartEdit = () => {
    setIsEditing(true);
  };

  const handlePrintVoucher = () => {
    triggerHaptic('light');
    const printWin = window.open('', '_blank', 'width=700,height=800');
    if (!printWin) {
      window.print();
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Expense Voucher - ${formatVoucherNumber(v.voucher_number)}</title>
        <style>
          @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 28px; color: #111; max-width: 600px; margin: 0 auto; }
          .header { text-align: center; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
          .brand { font-size: 18px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
          .sub { font-size: 11px; color: #555; margin-top: 3px; }
          .vnum { font-size: 13px; font-weight: 700; border: 1px solid #111; padding: 4px 8px; display: inline-block; margin-top: 8px; font-family: monospace; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; margin: 12px 0; font-family: monospace; }
          .card { border: 1px solid #ddd; padding: 12px; margin: 14px 0; border-radius: 4px; }
          .amount-row { display: flex; justify-content: space-between; font-size: 15px; font-weight: 700; font-family: monospace; border-top: 1px solid #111; border-bottom: 1px solid #111; padding: 8px 0; margin: 12px 0; }
          .words { font-size: 11px; font-style: italic; color: #444; margin-top: -6px; margin-bottom: 12px; }
          .signatures { display: flex; justify-content: space-between; margin-top: 60px; font-size: 11px; }
          .sig-box { width: 30%; border-top: 1px solid #111; text-align: center; padding-top: 6px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="brand">ASOPALAV ENDEAVOURS LLP</div>
          <div class="sub">Showroom Expense Disbursement Voucher</div>
          <div class="vnum">VOUCHER #${formatVoucherNumber(v.voucher_number)}</div>
        </div>

        <div class="grid">
          <div><strong>Date:</strong> ${formatDate(v.payment_date)}</div>
          <div><strong>Branch:</strong> ${v.branch_code || 'ASI'}</div>
          <div><strong>Category:</strong> ${v.category_name || 'General Expense'}</div>
          <div><strong>Department:</strong> ${v.department_name || 'Showroom'}</div>
          <div><strong>Payment Mode:</strong> ${v.payment_method === 'Physical_Cash' ? 'Cash Box' : 'Online UPI'}</div>
          <div><strong>Bill/Ref #:</strong> ${v.bill_number || 'Cash Memo'}</div>
          <div style="grid-column: span 2;"><strong>Paid To / Payee:</strong> ${v.recipient_name || 'Counter Expense'}</div>
        </div>

        <div class="amount-row">
          <span>TOTAL AMOUNT PAID</span>
          <span>₹${Number(v.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
        </div>
        <div class="words">Amount in Words: ${numberToWordsINR(v.total_amount)}</div>

        ${v.remarks ? `<div class="card"><strong style="font-size:11px;">Narration / Purpose:</strong><div style="font-size:12px; margin-top:4px;">${v.remarks}</div></div>` : ''}

        <div class="signatures">
          <div class="sig-box">
            ${v.created_by_name || 'Counter Cashier'}<br/>
            <span style="font-size:9px; color:#666;">Prepared By</span>
          </div>
          <div class="sig-box">
            Store Manager<br/>
            <span style="font-size:9px; color:#666;">Verified &amp; Approved</span>
          </div>
          <div class="sig-box">
            ${v.recipient_name || 'Payee'}<br/>
            <span style="font-size:9px; color:#666;">Received Signature</span>
          </div>
        </div>
      </body>
      </html>
    `;

    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => {
      printWin.print();
    }, 250);
  };

  const drawerFooter = isEditing ? (
    <div className="w-full flex items-center justify-end gap-2.5">
      <button
        type="button"
        onClick={handleCancelEdit}
        className="inline-flex items-center justify-center gap-1.5 h-10 min-h-[40px] px-4 rounded-[6px] border border-slate-300 dark:border-[#2e2e2e] bg-slate-100 dark:bg-[#202020] hover:bg-slate-200 dark:hover:bg-[#282828] text-slate-900 dark:text-white text-xs font-sans transition-colors cursor-pointer"
      >
        <Undo className="w-3.5 h-3.5" />
        <span>Cancel</span>
      </button>

      <button
        type="button"
        disabled={savingEdit}
        onClick={handleSaveEdit}
        className="inline-flex items-center justify-center gap-1.5 h-10 min-h-[40px] px-5 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] text-xs font-semibold font-sans transition-colors cursor-pointer shadow-xs disabled:opacity-50"
      >
        <Save className="w-3.5 h-3.5" />
        <span>{savingEdit ? 'Saving...' : 'Save Changes'}</span>
      </button>
    </div>
  ) : (
    <div className="w-full flex flex-col gap-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={handlePrintVoucher}
          className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#1a1a1a] hover:bg-slate-100 dark:hover:bg-[#222222] text-slate-700 dark:text-[#ededed] text-xs font-medium font-sans transition-colors cursor-pointer shadow-2xs"
          title="Print Physical Voucher Slip"
        >
          <Printer className="w-3.5 h-3.5 text-slate-500" />
          <span>Print Voucher</span>
        </button>

        {canEditVoucher && (
          <button
            type="button"
            onClick={handleStartEdit}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-[6px] border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-[#3ecf8e] text-xs font-medium font-sans transition-colors cursor-pointer shadow-2xs"
          >
            <Edit3 className="w-3.5 h-3.5 text-emerald-600 dark:text-[#3ecf8e]" />
            <span>Edit</span>
          </button>
        )}

        {canVoid && v.status !== 'Voided' && (
          <button
            type="button"
            onClick={() => setActiveAction(activeAction === 'void' ? 'none' : 'void')}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-[6px] border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-400 text-xs font-medium font-sans transition-colors cursor-pointer shadow-2xs"
          >
            <XCircle className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
            <span>Cancel Bill</span>
          </button>
        )}

        {canDelete && (
          <button
            type="button"
            onClick={() => setActiveAction(activeAction === 'delete' ? 'none' : 'delete')}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-[6px] bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium font-sans transition-colors cursor-pointer shadow-2xs"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        )}

        {isAuditor && (
          <div className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[6px] bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-400 text-xs font-medium font-sans">
            <Shield className="w-3.5 h-3.5 text-blue-500" />
            <span>Auditor View • Read-Only Mode</span>
          </div>
        )}

        {!isAuditor && !isPrivileged && !isTodayVoucher && (
          <div className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[6px] bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs font-medium font-sans">
            <Lock className="w-3.5 h-3.5 text-amber-500" />
            <span>Past Bill • Locked for Counter</span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={closeDrawer}
        className="w-full inline-flex items-center justify-center gap-2 h-10 min-h-[40px] px-4 rounded-[6px] bg-[#3ecf8e] hover:bg-[#34b27b] text-[#171717] text-xs font-semibold font-sans transition-colors cursor-pointer shadow-xs active:scale-[0.99]"
      >
        <Check className="w-4 h-4 stroke-[3]" />
        <span>Done</span>
      </button>
    </div>
  );

  return (
    <SlideOverDrawer
      isOpen={Boolean(activeDrawerVoucher)}
      onClose={closeDrawer}
      title={isEditing ? `Edit Bill #${formatVoucherNumber(v.voucher_number)}` : `Expense Bill #${formatVoucherNumber(v.voucher_number)}`}
      subtitle={`Recorded ${formatDate(v.payment_date)} • ${v.branch_code} • ${v.payment_method === 'Physical_Cash' ? 'Cash Box' : 'Online UPI'}`}
      badge={statusBadge}
      size="full"
      footer={drawerFooter}
    >
      <div className="max-w-4xl mx-auto w-full space-y-4 text-xs font-sans">
        {/* EDIT MODE: Full Admin CRUD Form */}
        {isEditing && (
          <div className="space-y-4 font-sans">
            <div className="p-3.5 rounded-[8px] bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-emerald-600 dark:text-[#3ecf8e]" />
                <span className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                  Editing Expense Voucher #{formatVoucherNumber(v.voucher_number)}
                </span>
              </div>
              <span className="text-[11px] font-mono text-emerald-700 dark:text-[#3ecf8e]">
                Branch: {v.branch_code}
              </span>
            </div>

            {isStaffVoucher ? (
              /* Multi-Staff Split Editor */
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-1 border-b border-slate-200 dark:border-[#282828]">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-600 dark:text-[#3ecf8e]" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-zinc-200">
                      Staff Multi-Split Allocations ({editStaffSplits.length} members)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500 dark:text-zinc-400">Total Calculated:</span>
                    <span className="text-xs font-mono font-bold text-emerald-600 dark:text-[#3ecf8e]">
                      {formatINR(editAmount)}
                    </span>
                  </div>
                </div>

                <StaffSplitTable
                  splits={editStaffSplits}
                  staffList={staff}
                  categories={categories}
                  departments={departments}
                  targetAmount={editAmount}
                  onChange={(s) => {
                    if (isCashier) {
                      showToast({ type: 'warning', title: 'Amount Locked', message: 'Staff payout amount adjustments require Store Manager authorization.' });
                      return;
                    }
                    setEditStaffSplits(s);
                    const total = s.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
                    setEditAmount(total);
                  }}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300">
                      Bill / Invoice No. (Optional)
                    </label>
                    <input
                      type="text"
                      value={editBillNumber}
                      onChange={(e) => setEditBillNumber(e.target.value)}
                      placeholder="e.g. INV-9021"
                      className="w-full h-10 min-h-[40px] px-3 rounded-[6px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] text-xs font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30"
                    />
                  </div>
                </div>
              </div>
            ) : isMultiVendorVoucher ? (
              /* Multi-Vendor Split Editor */
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-1 border-b border-slate-200 dark:border-[#282828]">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-zinc-200">
                      Multi-Vendor Split Allocations ({editVendorSplits.length} vendors)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500 dark:text-zinc-400">Total Calculated:</span>
                    <span className="text-xs font-mono font-bold text-purple-600 dark:text-purple-400">
                      {formatINR(editAmount)}
                    </span>
                  </div>
                </div>

                <VendorSplitTable
                  splits={editVendorSplits}
                  categories={categories}
                  departments={departments}
                  targetAmount={editAmount}
                  onChange={(s) => {
                    if (isCashier) {
                      showToast({ type: 'warning', title: 'Amount Locked', message: 'Vendor payout amount adjustments require Store Manager authorization.' });
                      return;
                    }
                    setEditVendorSplits(s);
                    const total = s.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
                    setEditAmount(total);
                  }}
                />
              </div>
            ) : (
              /* Standard Single-Vendor Form */
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300">
                      Vendor / Paid To *
                    </label>
                    <input
                      type="text"
                      required
                      value={editRecipient}
                      onChange={(e) => setEditRecipient(e.target.value)}
                      placeholder="e.g. Ramesh Chai / Vendor Name"
                      className="w-full h-10 min-h-[40px] px-3 rounded-[6px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30"
                    />
                  </div>

                  {/* Solution 2: Cashier Amount Tampering Guard */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300">
                        Total Amount (₹) *
                      </label>
                      {isCashier && (
                        <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 flex items-center gap-1 font-semibold">
                          <Lock className="w-3 h-3" /> Manager Auth Required
                        </span>
                      )}
                    </div>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-xs font-mono text-slate-400 dark:text-zinc-500">₹</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        disabled={isCashier}
                        value={editAmount || ''}
                        onChange={(e) => setEditAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                        placeholder="0.00"
                        className={cn(
                          "w-full h-10 min-h-[40px] pl-7 pr-3 rounded-[6px] border text-xs font-mono font-medium focus:outline-none",
                          isCashier
                            ? "bg-slate-100 dark:bg-[#202020] text-slate-500 dark:text-zinc-400 border-slate-200 dark:border-[#282828] cursor-not-allowed opacity-80"
                            : "bg-white dark:bg-[#181818] border-slate-200 dark:border-[#282828] text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30"
                        )}
                      />
                    </div>
                    {isCashier ? (
                      <p className="text-[10px] text-slate-500 dark:text-zinc-400">
                        Cashiers can edit payee, category, notes, and photos. Payout amount adjustments require a Store Manager.
                      </p>
                    ) : editAmount > 0 ? (
                      <p className="text-[10px] text-emerald-600 dark:text-[#3ecf8e] font-medium font-sans">
                        {numberToWordsINR(editAmount)}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300">
                      Expense Category *
                    </label>
                    <SearchableSelect
                      value={editCategory}
                      onChange={setEditCategory}
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
                    <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300">
                      Department *
                    </label>
                    <SearchableSelect
                      value={editDepartment}
                      onChange={setEditDepartment}
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300">
                      Staff Member (Optional)
                    </label>
                    <SearchableSelect
                      value={editStaffCode}
                      onChange={(val) => {
                        const foundStaff = staff.find((s) => s.staff_code === val);
                        if (foundStaff) {
                          setEditStaffCode(foundStaff.staff_code);
                          setEditStaffName(`${foundStaff.first_name} ${foundStaff.last_name}`.trim());
                        } else {
                          setEditStaffCode('');
                          setEditStaffName('');
                        }
                      }}
                      options={staff.map((s) => ({
                        value: s.staff_code,
                        label: `${s.first_name} ${s.last_name}`,
                        subLabel: `${s.staff_code} • ${s.department_name || s.designation || 'Staff'}`,
                      }))}
                      placeholder="Select staff (or leave blank)..."
                      allowCustom={false}
                      clearable={true}
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300">
                        Bill / Invoice No.
                      </label>
                      {duplicateEditBillMatch && (
                        <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1 select-none animate-in fade-in">
                          <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                          <span>Duplicate Detected</span>
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={editBillNumber}
                      onChange={(e) => setEditBillNumber(e.target.value)}
                      placeholder="e.g. INV-9021"
                      className={cn(
                        "w-full h-10 min-h-[40px] px-3 rounded-[6px] border text-xs font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none transition-colors",
                        duplicateEditBillMatch
                          ? "border-amber-400 dark:border-amber-600 bg-white dark:bg-[#181818] focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30"
                          : "border-slate-200 dark:border-[#282828] bg-white dark:bg-[#181818] focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30"
                      )}
                    />
                    {duplicateEditBillMatch && (
                      <div className="flex items-start gap-1.5 p-2 rounded-[6px] bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200 mt-1 animate-in fade-in duration-150">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <div className="leading-tight">
                          <span className="font-semibold">Possible Duplicate Bill: </span>
                          Bill #{duplicateEditBillMatch.bill_number} was already used on{' '}
                          <span className="font-mono font-medium">{duplicateEditBillMatch.payment_date || duplicateEditBillMatch.created_at?.slice(0, 10)}</span>{' '}
                          for <span className="font-mono font-medium">{formatINR(duplicateEditBillMatch.total_amount)}</span>{' '}
                          ({duplicateEditBillMatch.recipient_name} • Voucher #{formatVoucherNumber(duplicateEditBillMatch.voucher_number)} • {duplicateEditBillMatch.branch_code}).
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300">
                  Payment Method
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditPaymentMethod('Physical_Cash')}
                    className={cn(
                      'h-10 min-h-[40px] rounded-[6px] border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer',
                      editPaymentMethod === 'Physical_Cash'
                        ? 'border-emerald-500 bg-[#3ecf8e]/10 text-emerald-700 dark:text-[#3ecf8e]'
                        : 'border-slate-200 dark:border-[#282828] bg-white dark:bg-[#181818] text-slate-700 dark:text-zinc-300'
                    )}
                  >
                    <Wallet className="w-3.5 h-3.5 text-amber-500" />
                    <span>Cash Box</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditPaymentMethod('Online_UPI')}
                    className={cn(
                      'h-10 min-h-[40px] rounded-[6px] border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer',
                      editPaymentMethod === 'Online_UPI'
                        ? 'border-emerald-500 bg-[#3ecf8e]/10 text-emerald-700 dark:text-[#3ecf8e]'
                        : 'border-slate-200 dark:border-[#282828] bg-white dark:bg-[#181818] text-slate-700 dark:text-zinc-300'
                    )}
                  >
                    <Smartphone className="w-3.5 h-3.5 text-blue-500" />
                    <span>Online UPI</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300">
                  Payment Date
                </label>
                <input
                  type="date"
                  value={editPaymentDate}
                  onChange={(e) => setEditPaymentDate(e.target.value)}
                  disabled={!isPrivileged}
                  title={!isPrivileged ? "Date editing is restricted to Super Admin" : "Select date"}
                  className="w-full h-10 min-h-[40px] px-3 rounded-[6px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300">
                Courier / Parcel Logistics Partner (Optional)
              </label>
              <input
                type="text"
                value={editCourier}
                onChange={(e) => setEditCourier(e.target.value)}
                placeholder="e.g. Maruti Courier / DTDC"
                className="w-full h-10 min-h-[40px] px-3 rounded-[6px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300">
                Notes / Particulars
              </label>
              <textarea
                rows={2}
                value={editRemarks}
                onChange={(e) => setEditRemarks(e.target.value)}
                placeholder="Details of expense..."
                className="w-full p-2.5 rounded-[6px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30"
              />
            </div>

            <div className="p-3.5 rounded-[8px] bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 space-y-1.5">
              <label className="block text-xs font-semibold text-amber-900 dark:text-amber-200">
                Mandatory Edit Justification (Audit Log) *
              </label>
              <textarea
                rows={2}
                required
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="State the reason for this bill modification (e.g. Vendor name correction, category change)..."
                className="w-full p-2.5 rounded-[6px] bg-white dark:bg-[#141414] border border-amber-300 dark:border-amber-500/40 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-amber-500"
              />
            </div>

            {feedback && (
              <div
                className={cn(
                  'p-3 rounded-[6px] border font-sans text-xs font-medium',
                  feedback.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-900 dark:text-emerald-200'
                    : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-900 dark:text-rose-200'
                )}
              >
                {feedback.message}
              </div>
            )}
          </div>
        )}

        {/* VIEW MODE: Voucher Details */}
        {!isEditing && (
          <div className="space-y-4 font-sans">
            <div className="p-4 rounded-[12px] bg-slate-50 dark:bg-[#171717] border border-slate-200 dark:border-[#242424] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div>
                <span className="text-[11px] text-slate-500 dark:text-zinc-400 block uppercase tracking-wider font-mono">
                  Total Paid
                </span>
                <div className="text-2xl font-mono tabular-nums font-medium text-slate-900 dark:text-white mt-0.5">
                  {formatINR(v.total_amount)}
                </div>
                <p className="text-xs font-sans text-emerald-600 dark:text-[#3ecf8e] mt-0.5 font-medium">
                  {numberToWordsINR(Number(v.total_amount))}
                </p>
              </div>

              <div className="text-left sm:text-right space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-white dark:bg-[#202020] border border-slate-200 dark:border-[#2e2e2e] text-xs font-mono text-slate-900 dark:text-white">
                  {v.payment_method === 'Physical_Cash' ? (
                    <>
                      <Wallet className="w-3.5 h-3.5 text-amber-500" />
                      <span>Cash</span>
                    </>
                  ) : (
                    <>
                      <Smartphone className="w-3.5 h-3.5 text-blue-500" />
                      <span>UPI</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 rounded-[8px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] space-y-1 shadow-xs">
                <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-zinc-400 block">
                  Paid To
                </span>
                <span className="text-xs font-medium text-slate-900 dark:text-white block font-sans">
                  {v.recipient_name}
                </span>
              </div>

              <div className="p-3 rounded-[8px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] space-y-1 shadow-xs">
                <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-zinc-400 block">
                  Branch
                </span>
                <span className="text-xs font-mono font-medium text-slate-900 dark:text-white block">
                  {v.branch_code}
                </span>
              </div>

              <div className="p-3 rounded-[8px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] space-y-1 shadow-xs">
                <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-zinc-400 block">
                  Category
                </span>
                <span className="text-xs font-medium text-emerald-600 dark:text-[#3ecf8e] block font-sans">
                  {v.category_name}
                </span>
              </div>

              <div className="p-3 rounded-[8px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] space-y-1 shadow-xs">
                <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-zinc-400 block">
                  Department
                </span>
                <span className="text-xs font-medium text-slate-900 dark:text-white block font-sans">
                  {v.department_name || '—'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-[8px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] space-y-1 shadow-xs">
                <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-zinc-400 block">
                  Bill No.
                </span>
                <span className="text-xs font-mono text-slate-900 dark:text-white block">
                  {v.bill_number || 'N/A'}
                </span>
              </div>

              <div className="p-3 rounded-[8px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] space-y-1 shadow-xs">
                <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-zinc-400 block">
                  Ordered By
                </span>
                <span className="text-xs text-slate-900 dark:text-white font-medium block">
                  {v.requested_by_staff_name ? (
                    <span className="text-emerald-600 dark:text-[#3ecf8e]">
                      {v.requested_by_staff_name} {v.requested_by_staff_code && `(${v.requested_by_staff_code})`}
                    </span>
                  ) : (
                    '—'
                  )}
                </span>
              </div>

              <div className="p-3 rounded-[8px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] space-y-1 shadow-xs">
                <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-zinc-400 block">
                  Recorded By
                </span>
                <span className="text-xs text-slate-900 dark:text-white block">
                  {v.created_by_name || '—'}
                </span>
              </div>
            </div>

            {/* Multi-Vendor Line Items Breakdown if present */}
            {!isStaffVoucher && v.payment_type === 'Shop_Vendor' && v.vendor_splits && v.vendor_splits.length > 0 && (
              <div className="p-3.5 rounded-[12px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] space-y-2.5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-slate-500 dark:text-zinc-400 uppercase tracking-wider block">
                    Vendor Bills ({v.vendor_splits.length})
                  </span>
                  <span className="text-xs font-mono font-medium text-emerald-600 dark:text-[#3ecf8e]">
                    Total: {formatINR(v.total_amount)}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-[#262626] text-[10px] font-mono text-slate-400 uppercase">
                        <th className="py-1.5 px-2">#</th>
                        <th className="py-1.5 px-2">Vendor</th>
                        <th className="py-1.5 px-2">Category</th>
                        <th className="py-1.5 px-2">Dept</th>
                        <th className="py-1.5 px-2">Bill / Details</th>
                        <th className="py-1.5 px-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-[#222]">
                      {v.vendor_splits.map((vs: any, idx: number) => (
                        <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-[#1f1f1f]">
                          <td className="py-1.5 px-2 font-mono text-slate-400">{idx + 1}</td>
                          <td className="py-1.5 px-2 font-medium text-slate-900 dark:text-white">{vs.vendor_name}</td>
                          <td className="py-1.5 px-2 text-slate-600 dark:text-zinc-300">{vs.category_name}</td>
                          <td className="py-1.5 px-2 text-slate-500 dark:text-zinc-400">{vs.department_name || '-'}</td>
                          <td className="py-1.5 px-2 font-mono text-[11px] text-slate-500">{vs.bill_number || vs.description || '-'}</td>
                          <td className="py-1.5 px-2 text-right font-mono font-semibold text-slate-900 dark:text-white">{formatINR(vs.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Loading Indicator while fetching splits from Supabase */}
            {isStaffVoucher && loadingSplits && (
              <div className="p-3.5 rounded-[12px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] flex items-center gap-2.5 text-slate-500 dark:text-zinc-400 text-xs shadow-xs animate-pulse">
                <Loader2 className="w-4 h-4 animate-spin text-[#3ecf8e]" />
                <span className="font-mono text-[11px]">Loading staff allocations from database...</span>
              </div>
            )}

            {/* Staff / Multi-Employee Allocations Breakdown if present */}
            {!loadingSplits && staffSplits && staffSplits.length > 0 && (
              <div className="p-3.5 rounded-[12px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] space-y-2.5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-slate-500 dark:text-zinc-400 uppercase tracking-wider block">
                    Staff Allocations ({staffSplits.length})
                  </span>
                  <span className="text-xs font-mono font-medium text-emerald-600 dark:text-[#3ecf8e]">
                    Total: {formatINR(v.total_amount)}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-[#262626] text-[10px] font-mono text-slate-400 uppercase">
                        <th className="py-1.5 px-2">#</th>
                        <th className="py-1.5 px-2">Staff Member</th>
                        <th className="py-1.5 px-2">Department</th>
                        <th className="py-1.5 px-2">Category</th>
                        <th className="py-1.5 px-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-[#222]">
                      {staffSplits.map((s: any, idx: number) => (
                        <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-[#1f1f1f]">
                          <td className="py-1.5 px-2 font-mono text-slate-400">{idx + 1}</td>
                          <td className="py-1.5 px-2 font-medium text-slate-900 dark:text-white">
                            {s.staff_name} {s.staff_code && <span className="font-mono text-slate-400 text-[11px]">({s.staff_code})</span>}
                          </td>
                          <td className="py-1.5 px-2 text-slate-500 dark:text-zinc-400">{s.department_name || '-'}</td>
                          <td className="py-1.5 px-2 text-emerald-600 dark:text-[#3ecf8e] font-medium">{s.category_name || '-'}</td>
                          <td className="py-1.5 px-2 text-right font-mono font-semibold text-slate-900 dark:text-white">{formatINR(s.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Courier info if present */}
            {v.courier_partner_name && (
              <div className="p-3 rounded-[8px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] flex items-center justify-between shadow-xs">
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-blue-500" />
                  <span className="text-xs text-slate-900 dark:text-white font-medium">{v.courier_partner_name}</span>
                </div>
                <span className="text-xs font-mono text-slate-500 dark:text-zinc-400">Parcel Logistics</span>
              </div>
            )}

            {/* Remarks Section */}
            {v.remarks && (
              <div className="p-3.5 rounded-[8px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] space-y-1 shadow-xs">
                <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-zinc-400 block">
                  Notes
                </span>
                <p className="text-xs text-slate-900 dark:text-white font-sans leading-relaxed">
                  {v.remarks}
                </p>
              </div>
            )}

            {/* Bill Evidence Photo Attachments */}
            {v.bill_photo_urls && v.bill_photo_urls.length > 0 && (
              <div className="space-y-2 p-3.5 rounded-[12px] bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#242424] shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-slate-500 dark:text-zinc-400 block">
                    Attached Bill Photo ({v.bill_photo_urls.length})
                  </span>
                  <span className="text-[10px] font-mono text-slate-400 dark:text-zinc-500">Click to zoom</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {v.bill_photo_urls.map((url: string, idx: number) => (
                    <div
                      key={idx}
                      onClick={() => openLightbox(url)}
                      className="relative h-20 rounded-[6px] overflow-hidden border border-slate-200 dark:border-[#2e2e2e] cursor-pointer group bg-slate-100 dark:bg-[#202020]"
                    >
                      <img src={url} alt={`Bill #${idx + 1}`} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                        <Eye className="w-4 h-4" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Void / Delete Confirmation Form */}
            {activeAction !== 'none' && (
              <div className="p-3.5 rounded-[8px] bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 space-y-2 font-sans text-xs">
                <div className="flex items-center gap-2 text-rose-900 dark:text-rose-200 font-semibold">
                  <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                  <span>
                    Confirm {activeAction === 'void' ? 'Voucher Void' : 'Permanent Deletion (Super Admin)'}
                  </span>
                </div>
                <p className="text-[11px] text-rose-700 dark:text-rose-300 font-medium leading-relaxed">
                  {activeAction === 'void'
                    ? (isTodayVoucher
                        ? `This voucher was created today. Voiding it will immediately refund ₹${v.total_amount} back into today's ${v.payment_method.replace('_', ' ')} drawer balance.`
                        : `Past-day bill (${voucherDate}): Voiding will cancel this voucher in accounting records. Today's drawer cash balance will NOT be altered (preventing phantom cash drift).`)
                    : 'Permanent deletion is restricted to Super Admin and removes this voucher permanently.'}
                </p>

                {/* Solution 1: Zero-Phantom-Cash Rule Toggle for Admin */}
                {activeAction === 'void' && !isTodayVoucher && isPrivileged && (
                  <label className="flex items-center gap-2 pt-1 text-slate-800 dark:text-zinc-200 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={cashReturnedToDrawer}
                      onChange={(e) => setCashReturnedToDrawer(e.target.checked)}
                      className="rounded border-slate-300 dark:border-[#333] text-[#3ecf8e] focus:ring-[#3ecf8e]"
                    />
                    <span>Physical cash was collected back and added to today's drawer float</span>
                  </label>
                )}

                <textarea
                  rows={2}
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder={`Mandatory reason for ${activeAction === 'void' ? 'voiding' : 'deleting'} voucher...`}
                  className="w-full bg-white dark:bg-[#141414] border border-rose-300 dark:border-rose-500/40 rounded-[6px] p-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-rose-500"
                />
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setActiveAction('none')}
                    className="px-3 py-1 rounded-[4px] border border-slate-300 dark:border-[#2e2e2e] bg-white dark:bg-[#202020] text-slate-700 dark:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={loadingAction}
                    onClick={activeAction === 'void' ? handleVoidVoucher : handleDeleteVoucher}
                    className="px-3.5 py-1 rounded-[4px] bg-rose-600 hover:bg-rose-700 text-white font-medium cursor-pointer"
                  >
                    {loadingAction ? 'Processing...' : `Confirm ${activeAction === 'void' ? 'Void' : 'Delete'}`}
                  </button>
                </div>
              </div>
            )}

            {feedback && (
              <div
                className={cn(
                  'p-3 rounded-[6px] border font-sans text-xs font-medium',
                  feedback.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-900 dark:text-emerald-200'
                    : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-900 dark:text-rose-200'
                )}
              >
                {feedback.message}
              </div>
            )}
          </div>
        )}
      </div>
    </SlideOverDrawer>
  );
};
