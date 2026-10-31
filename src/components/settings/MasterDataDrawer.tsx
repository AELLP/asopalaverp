import React, { useState, useEffect, useCallback } from 'react';
import { useScrollLock } from '@/hooks/useScrollLock';
import { useAuthStore, isPrivilegedAdminRole } from '@/store/authStore';
import { useBranchStore } from '@/store/branchStore';
import { erpService } from '@/lib/erpService';
import { StaffMember, Department, AppRole } from '@/types/database';
import { SlideOverDrawer } from '@/components/ui/SlideOverDrawer';
import { SupabaseFieldRow } from '@/components/ui/SupabaseFieldRow';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import {
  Trash2,
  AlertCircle,
  AlertTriangle,  Check,
  Save,
  CheckCircle2,
  ShieldCheck,  X,
} from 'lucide-react';
import { cleanIndianPhoneInput } from '@/lib/utils';
import { showToast } from '@/components/ui/ToastContainer';

export type MasterDrawerType = 'branch' | 'category' | 'department' | 'courier' | 'user' | 'staff' | 'role';

export interface MasterDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  type: MasterDrawerType;
  record?: any;
  onSuccess: () => void;
}

export const MasterDataDrawer: React.FC<MasterDrawerProps> = ({
  isOpen,
  onClose,
  type,
  record,
  onSuccess,
}) => {
  const { user } = useAuthStore();
  const { branches } = useBranchStore();
  const isPrivileged = isPrivilegedAdminRole(user?.role_code);
    const isSuperAdmin = isPrivileged;
  const isEdit = Boolean(record);

  useScrollLock(isOpen);

  const [formData, setFormData] = useState<any>({});
  const [availableRoles, setAvailableRoles] = useState<AppRole[]>([]);
  const [availableStaff, setAvailableStaff] = useState<StaffMember[]>([]);
  const [availableDepartments, setAvailableDepartments] = useState<Department[]>([]);
  const [isCustomStaffCode, setIsCustomStaffCode] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [renameCascadeModal, setRenameCascadeModal] = useState<{
    open: boolean;
    oldName: string;
    newName: string;
    entityType: 'category' | 'department' | 'courier' | 'staff' | 'branch';
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (type === 'user' || type === 'role') {
        erpService.getAppRoles().then((rolesList) => {
          if (rolesList && rolesList.length > 0) {
            setAvailableRoles(rolesList);
          }
        });
      }
      if (type === 'user') {
        erpService.getStaffMembers().then((staffList) => {
          if (staffList && staffList.length > 0) {
            setAvailableStaff(staffList);
          }
        });
      }
      if (type === 'staff') {
        erpService.getDepartments(true).then((deptList) => {
          if (deptList && deptList.length > 0) {
            setAvailableDepartments(deptList);
          }
        });
      }
    }
  }, [isOpen, type]);

  useEffect(() => {
    if (isOpen) {
      setConfirmDelete(false);
      setDeleteReason('');
      setError('');
      setIsCustomStaffCode(false);
      setIsPreviewOpen(false);

      if (record) {
        const { password_hash: _p, lock_pin_hash: _l, studio_password: _s, ...cleanRecord } = record;
        setFormData({ ...cleanRecord });
        if (type === 'role' && record.role_code) {
          erpService.getRolePermissions(record.role_code).then((p) => {
            if (p) {
              setFormData((prev: any) => ({
                ...prev,
                can_create_voucher: p.can_create_voucher ?? true,
                can_void_voucher: p.can_void_voucher ?? false,
                can_backdate_voucher: p.can_backdate_voucher ?? false,
                can_disburse_advance: p.can_disburse_advance ?? false,
                can_settle_advance: p.can_settle_advance ?? false,
                max_advance_limit: p.max_advance_limit ?? 5000,
                can_inject_float: p.can_inject_float ?? false,
                can_verify_f9_closing: p.can_verify_f9_closing ?? false,
                can_export_tally: p.can_export_tally ?? false,
                can_download_hr_payroll: p.can_download_hr_payroll ?? false,
                can_view_all_branches: p.can_view_all_branches ?? false,
                can_view_audit_logs: p.can_view_audit_logs ?? false,
                can_manage_users_roles: p.can_manage_users_roles ?? false,
                can_manage_periods: p.can_manage_periods ?? false,
              }));
            }
          });
        }
      } else {
        switch (type) {
          case 'branch':
            setFormData({
              branch_name: '',
              branch_code: '',
              city: '',
              state: '',
              gstin: '',
              min_cash_threshold: 0,
              max_cash_ceiling: 0,
              max_upi_ceiling: 0,
              is_active: true,
            });
            break;
          case 'category':
            setFormData({
              category_name: '',
              color_theme: '',
              is_active: true,
            });
            break;
          case 'department':
            setFormData({
              department_name: '',
              department_code: '',
              is_active: true,
            });
            break;
          case 'courier':
            setFormData({
              partner_name: '',
              partner_code: '',
              contact_phone: '',
              is_active: true,
            });
            break;
          case 'user':
            setFormData({
              username: '',
              first_name: '',
              last_name: '',
              email: '',
              role_code: 'Cashier',
              assigned_branches: ['*'],
              password_hash: '',
              lock_pin_hash: '',
              is_active: true,
            });
            break;
          case 'staff': {
            const defaultBranch = branches[0] || { branch_id: 'Aellp-ASI', branch_code: 'ASI' };
            setFormData({
              staff_code: '',
              first_name: '',
              middle_name: '',
              last_name: '',
              department_name: '',
              designation: '',
              mobile_number: '',
              branch_id: defaultBranch.branch_id,
              branch_code: defaultBranch.branch_code,
              is_active: true,
            });
            // Auto-generate next Staff ID based on active branch
            erpService.generateNextStaffCode(defaultBranch.branch_code).then((code) => {
              setFormData((prev: any) => ({ ...prev, staff_code: code }));
            });
            break;
          }
          case 'role':
            setFormData({
              role_code: '',
              role_title: '',
              description: '',
              is_system_role: false,
              can_create_voucher: true,
              can_void_voucher: false,
              can_backdate_voucher: false,
              can_disburse_advance: false,
              can_settle_advance: false,
              max_advance_limit: 5000,
              can_inject_float: false,
              can_verify_f9_closing: false,
              can_export_tally: false,
              can_download_hr_payroll: false,
              can_view_all_branches: false,
              can_view_audit_logs: false,
              can_manage_users_roles: false,
              can_manage_periods: false,
            });
            break;
        }
      }
    }
  }, [isOpen, record, type, branches]);

  const handleChange = (field: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleInitiateSave = useCallback((e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError('');

    try {
      if (type === 'branch') {
        if (!formData.branch_name || !formData.branch_code) {
          throw new Error('Branch Name and Code are required.');
        }
      } else if (type === 'category') {
        if (!formData.category_name) {
          throw new Error('Category Name is required.');
        }
      } else if (type === 'department') {
        if (!formData.department_name || !formData.department_code) {
          throw new Error('Department Name and Code are required.');
        }
      } else if (type === 'courier') {
        if (!formData.partner_name || !formData.partner_code) {
          throw new Error('Partner Name and Code are required.');
        }
      } else if (type === 'user') {
        if (!formData.username || !formData.first_name) {
          throw new Error('Username and First Name are required.');
        }
        const isSuperAdminOrDev = formData.role_code === 'Super_Admin' || formData.role_code === 'Developer';
        if (!formData.staff_code && formData.username !== 'aellpadmin' && !isEdit && !isSuperAdminOrDev) {
          throw new Error('Please link an active Staff Member for this user account.');
        }
      } else if (type === 'staff') {
        if (!formData.staff_code || !formData.first_name) {
          throw new Error('Staff Code and First Name are required.');
        }
      } else if (type === 'role') {
        if (!formData.role_code || !formData.role_title) {
          throw new Error('Role Code and Role Title are required.');
        }
      }

      // Check if primary name/identifier was edited on existing record
      if (isEdit && record) {
        let oldName = '';
        let newName = '';
        if (type === 'category' && record.category_name && formData.category_name && record.category_name.trim() !== formData.category_name.trim()) {
          oldName = record.category_name.trim();
          newName = formData.category_name.trim();
        } else if (type === 'department' && record.department_name && formData.department_name && record.department_name.trim() !== formData.department_name.trim()) {
          oldName = record.department_name.trim();
          newName = formData.department_name.trim();
        } else if (type === 'courier' && record.partner_name && formData.partner_name && record.partner_name.trim() !== formData.partner_name.trim()) {
          oldName = record.partner_name.trim();
          newName = formData.partner_name.trim();
        } else if (type === 'staff' && record.first_name && formData.first_name && `${record.first_name} ${record.last_name || ''}`.trim() !== `${formData.first_name} ${formData.last_name || ''}`.trim()) {
          oldName = `${record.first_name} ${record.last_name || ''}`.trim();
          newName = `${formData.first_name} ${formData.last_name || ''}`.trim();
        } else if (type === 'branch' && record.branch_name && formData.branch_name && record.branch_name.trim() !== formData.branch_name.trim()) {
          oldName = record.branch_name.trim();
          newName = formData.branch_name.trim();
        }

        if (oldName && newName) {
          setRenameCascadeModal({
            open: true,
            oldName,
            newName,
            entityType: type as any,
          });
          return;
        }
      }

      setIsPreviewOpen(true);
    } catch (err: any) {
      setError(err.message || 'Please check required fields.');
      showToast({
        type: 'error',
        title: 'Validation Error',
        message: err.message || 'Please fill in all required fields.',
      });
    }
  }, [formData, isEdit, type, record]);

  const handleExecuteRename = async (updateHistoricalData: boolean) => {
    if (!renameCascadeModal) return;
    setLoading(true);
    setError('');
    const { oldName, newName, entityType } = renameCascadeModal;

    try {
      const userName = `${user?.first_name || 'Admin'} ${user?.last_name || ''}`.trim() || 'Super Admin';
      const userRole = user?.role_code || 'Super_Admin';

      const res = await erpService.renameMasterEntity({
        entityType,
        oldIdOrName: oldName,
        newIdOrName: newName,
        updateHistoricalData,
        additionalUpdates: formData,
        userName,
        userRole,
      });

      showToast({
        type: 'success',
        title: 'Master Record Updated',
        message: updateHistoricalData
          ? `Renamed "${oldName}" to "${newName}" and updated ${res.updatedRecordsCount} past records.`
          : `Renamed "${oldName}" to "${newName}" for future records. Historical data preserved.`,
      });

      setRenameCascadeModal(null);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Rename cascade error:', err);
      setError(err.message || 'Failed to rename record.');
      showToast({
        type: 'error',
        title: 'Rename Failed',
        message: err.message || 'Database error occurred.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFinalCommit = useCallback(async () => {
    setError('');
    setLoading(true);

    try {
      const userName = `${user?.first_name || 'Admin'} ${user?.last_name || ''}`.trim() || 'Super Admin';
      const userRole = user?.role_code || 'Super_Admin';

      if (type === 'branch') {
        await erpService.saveBranch(formData, isEdit, userName, userRole);
      } else if (type === 'category') {
        await erpService.saveCategory(formData, isEdit, userName, userRole);
      } else if (type === 'department') {
        await erpService.saveDepartment(formData, isEdit, userName, userRole);
      } else if (type === 'courier') {
        await erpService.saveCourier(formData, isEdit, userName, userRole);
      } else if (type === 'user') {
        await erpService.saveAppUser(formData, isEdit, userName, userRole);
      } else if (type === 'staff') {
        const bId = formData.branch_id || branches[0]?.branch_id || 'Aellp-ASI';
        const foundBranch = branches.find((b) => b.branch_id === bId);
        const bCode = formData.branch_code || foundBranch?.branch_code || bId.replace(/^Aellp-/, '') || 'ASI';

        await erpService.saveStaffMember(
          {
            ...formData,
            branch_id: bId,
            branch_code: bCode,
            last_name: (formData.last_name || '').trim() || null,
            department_name: (formData.department_name || '').trim() || null,
            designation: (formData.designation || '').trim() || null,
            mobile_number: (formData.mobile_number || '').trim() || null,
          },
          isEdit,
          userName,
          userRole
        );
      } else if (type === 'role') {
        await erpService.saveRole(
          {
            role_code: formData.role_code,
            role_title: formData.role_title,
            description: formData.description,
            is_system_role: formData.is_system_role || false,
          },
          formData,
          isEdit,
          userName,
          userRole
        );
      }

      showToast({
        type: 'success',
        title: isEdit ? 'Record Updated' : 'Record Created',
        message: `Successfully saved ${type} entry into database.`,
      });

      setIsPreviewOpen(false);
      onSuccess();
    } catch (err: any) {
      console.error('Save error:', err);
      setError(err.message || 'Failed to save record.');
      setIsPreviewOpen(false);
      showToast({
        type: 'error',
        title: 'Save Failed',
        message: err.message || 'Database error occurred.',
      });
    } finally {
      setLoading(false);
    }
  }, [formData, isEdit, type, user, branches, onSuccess]);

  // Keyboard shortcut Ctrl+Enter / Cmd+Enter to Save
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleInitiateSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleInitiateSave]);

  const handleDelete = async () => {
    if (!deleteReason || deleteReason.trim().length < 3) {
      setError('Deletion reason is mandatory for audit logging.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const userName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Super Admin';
      const userRole = user?.role_code || 'Super_Admin';

      if (type === 'branch') {
        await erpService.deleteBranch(record.branch_id, userName, userRole, deleteReason);
      } else if (type === 'category') {
        await erpService.deleteCategory(record.category_name, userName, userRole, deleteReason);
      } else if (type === 'department') {
        await erpService.deleteDepartment(
          record.department_code,
          record.department_name || record.department_code,
          userName,
          userRole,
          deleteReason
        );
      } else if (type === 'courier') {
        await erpService.deleteCourier(
          record.partner_code,
          record.partner_name || record.partner_code,
          userName,
          userRole,
          deleteReason
        );
      } else if (type === 'role') {
        if (record.is_system_role) {
          throw new Error('Core system roles (Super Admin, Manager, Cashier) cannot be deleted.');
        }
        await erpService.deleteRole(record.role_code, userName, userRole);
      } else if (type === 'user') {
        await erpService.deleteAppUser(
          record.id,
          record.username,
          userName,
          userRole,
          deleteReason
        );
      } else if (type === 'staff') {
        await erpService.deleteStaffMember(
          record.staff_code,
          `${record.first_name || ''} ${record.last_name || ''}`.trim() || record.staff_code,
          userName,
          userRole,
          deleteReason
        );
      }

      showToast({
        type: 'success',
        title: 'Record Removed',
        message: `Successfully deactivated ${type} entry.`,
      });

      onSuccess();
    } catch (err: any) {
      console.error('Delete error:', err);
      setError(err.message || 'Failed to delete record.');
      showToast({
        type: 'error',
        title: 'Deactivation Failed',
        message: err.message || 'Database error occurred.',
      });
    } finally {
      setLoading(false);
    }
  };

  
  const entityLabels: Record<MasterDrawerType, string> = {
    branch: 'Shop Branch',
    category: 'Expense Category',
    department: 'Shop Department',
    courier: 'Courier Partner',
    user: 'Login Account',
    staff: 'Staff Member',
    role: 'Role & Permissions',
  };

  const drawerTitle = (
    <div className="flex items-center gap-2 text-sm font-sans font-medium text-slate-900 dark:text-white">
      <span>{isEdit ? 'Edit' : 'Add'} {entityLabels[type]}</span>
    </div>
  );

  const drawerFooter = (
    <>
      <div className="flex items-center gap-2">
        {isEdit && isSuperAdmin && (
          <button
            type="button"
            onClick={() => setConfirmDelete(!confirmDelete)}
            className="p-2 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] hover:border-rose-300 dark:hover:border-rose-800 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-xs font-medium transition-colors cursor-pointer"
            title="Delete record permanently"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 h-10 min-h-[40px] px-4 rounded-[6px] border border-slate-300 dark:border-[#2e2e2e] bg-transparent hover:bg-slate-100 dark:hover:bg-[#222222] text-slate-800 dark:text-zinc-200 text-xs font-medium font-sans transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
          <span>Cancel</span>
        </button>
        <button
          type="button"
          onClick={() => handleInitiateSave()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-10 min-h-[40px] px-4 rounded-[6px] bg-[#3ecf8e] hover:bg-[#34b27b] text-[#171717] text-xs font-semibold font-sans transition-colors cursor-pointer shadow-xs"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{loading ? 'Saving...' : 'Save'}</span>
          <span className="font-mono text-[10px] text-[#171717]/80 bg-black/10 px-1 py-0.5 rounded leading-none">
            Ctrl ↵
          </span>
        </button>
      </div>
    </>
  );

  const inputStyles = "w-full h-10 min-h-[40px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] rounded-[6px] px-3.5 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 disabled:opacity-60 disabled:bg-slate-50 dark:disabled:bg-[#141414] font-sans text-xs transition-colors shadow-2xs";

  return (
    <SlideOverDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={drawerTitle}
      size="full"
      footer={drawerFooter}
    >
      <div className="w-full space-y-4 font-sans text-xs">
        {error && (
          <div className="p-3 rounded-[6px] bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs font-sans flex items-center gap-2 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleInitiateSave} className="space-y-4">
            {/* 1. Branch Form (master_branches) */}
            {type === 'branch' && (
              <div className="space-y-4">
                <SupabaseFieldRow columnName="id" dataType="uuid" isPrimaryKey description="Primary database identifier">
                  <input
                    type="text"
                    disabled
                    value={formData.branch_id || (isEdit ? record?.branch_id : 'Auto-assigned by system')}
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="branch_name" dataType="varchar" required>
                  <input
                    type="text"
                    required
                    value={formData.branch_name || ''}
                    onChange={(e) => handleChange('branch_name', e.target.value)}
                    placeholder="e.g. Asopalav - Satellite"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="branch_code" dataType="varchar" required>
                  <input
                    type="text"
                    required
                    disabled={isEdit}
                    value={formData.branch_code || ''}
                    onChange={(e) => handleChange('branch_code', e.target.value.toUpperCase())}
                    placeholder="ASI"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                {/* Optional Fields Divider */}
                <div className="pt-4 pb-1 border-t border-slate-200 dark:border-[#262626] space-y-0.5">
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white">Optional Details</h4>
                  <p className="text-[11px] text-slate-500 dark:text-[#707070]">Additional information (optional)</p>
                </div>

                <SupabaseFieldRow columnName="city" dataType="varchar">
                  <input
                    type="text"
                    value={formData.city || ''}
                    onChange={(e) => handleChange('city', e.target.value)}
                    placeholder="Ahmedabad"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="state" dataType="varchar">
                  <input
                    type="text"
                    value={formData.state || ''}
                    onChange={(e) => handleChange('state', e.target.value)}
                    placeholder="Gujarat"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="gstin" dataType="varchar">
                  <input
                    type="text"
                    value={formData.gstin || ''}
                    onChange={(e) => handleChange('gstin', e.target.value.toUpperCase())}
                    placeholder="24ABVFA8046N1ZQ"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="min_cash_threshold" dataType="numeric" description="Minimum cash float maintained in showroom drawer">
                  <input
                    type="number"
                    value={formData.min_cash_threshold ?? ''}
                    onChange={(e) => handleChange('min_cash_threshold', e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="e.g. 3000"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="max_cash_ceiling" dataType="numeric" description="Trigger for safe-drop to main vault">
                  <input
                    type="number"
                    value={formData.max_cash_ceiling ?? ''}
                    onChange={(e) => handleChange('max_cash_ceiling', e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="e.g. 25000"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="is_active" dataType="boolean">
                  <label className="flex items-center gap-2 cursor-pointer select-none py-1">
                    <input
                      type="checkbox"
                      checked={formData.is_active ?? true}
                      onChange={(e) => handleChange('is_active', e.target.checked)}
                      className="rounded text-[#3ecf8e] focus:ring-0 w-4 h-4 bg-[#181818] border-[#2e2e2e]"
                    />
                    <span className="text-slate-700 dark:text-zinc-300 font-sans text-xs font-medium">
                      {formData.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </label>
                </SupabaseFieldRow>
              </div>
            )}

            {/* 2. Category Form (expense_categories) */}
            {type === 'category' && (
              <div className="space-y-4">
                <SupabaseFieldRow columnName="id" dataType="uuid" isPrimaryKey description="Primary category key">
                  <input
                    type="text"
                    disabled
                    value={formData.id || (isEdit ? record?.category_name : 'Auto-assigned by system')}
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="category_name" dataType="varchar" required>
                  <input
                    type="text"
                    required
                    value={formData.category_name || ''}
                    onChange={(e) => handleChange('category_name', e.target.value)}
                    placeholder="e.g. Printing & Stationery"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                {/* Optional Fields Divider */}
                <div className="pt-4 pb-1 border-t border-slate-200 dark:border-[#262626] space-y-0.5">
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white">Optional Details</h4>
                  <p className="text-[11px] text-slate-500 dark:text-[#707070]">Additional information (optional)</p>
                </div>

                <SupabaseFieldRow columnName="color_theme" dataType="varchar" description="Tally Prime Ledger Mapping group">
                  <input
                    type="text"
                    value={formData.color_theme || ''}
                    onChange={(e) => handleChange('color_theme', e.target.value)}
                    placeholder="e.g. Administrative Expenses"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="is_active" dataType="boolean">
                  <label className="flex items-center gap-2 cursor-pointer select-none py-1">
                    <input
                      type="checkbox"
                      checked={formData.is_active ?? true}
                      onChange={(e) => handleChange('is_active', e.target.checked)}
                      className="rounded text-[#3ecf8e] focus:ring-0 w-4 h-4 bg-[#181818] border-[#2e2e2e]"
                    />
                    <span className="text-slate-700 dark:text-zinc-300 font-sans text-xs font-medium">
                      {formData.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </label>
                </SupabaseFieldRow>
              </div>
            )}

            {/* 3. Department Form (master_departments) */}
            {type === 'department' && (
              <div className="space-y-4">
                <SupabaseFieldRow columnName="id" dataType="uuid" isPrimaryKey description="Primary department ID">
                  <input
                    type="text"
                    disabled
                    value={formData.department_code || (isEdit ? record?.department_code : 'Auto-assigned by system')}
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="department_name" dataType="varchar" required>
                  <input
                    type="text"
                    required
                    value={formData.department_name || ''}
                    onChange={(e) => handleChange('department_name', e.target.value)}
                    placeholder="e.g. Bridal & Haute Couture"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="department_code" dataType="varchar" required>
                  <input
                    type="text"
                    required
                    disabled={isEdit}
                    value={formData.department_code || ''}
                    onChange={(e) => handleChange('department_code', e.target.value.toUpperCase())}
                    placeholder="BRIDAL"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                {/* Optional Fields Divider */}
                <div className="pt-4 pb-1 border-t border-slate-200 dark:border-[#262626] space-y-0.5">
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white">Optional Details</h4>
                  <p className="text-[11px] text-slate-500 dark:text-[#707070]">Additional information (optional)</p>
                </div>

                <SupabaseFieldRow columnName="is_active" dataType="boolean">
                  <label className="flex items-center gap-2 cursor-pointer select-none py-1">
                    <input
                      type="checkbox"
                      checked={formData.is_active ?? true}
                      onChange={(e) => handleChange('is_active', e.target.checked)}
                      className="rounded text-[#3ecf8e] focus:ring-0 w-4 h-4 bg-[#181818] border-[#2e2e2e]"
                    />
                    <span className="text-slate-700 dark:text-zinc-300 font-sans text-xs font-medium">
                      {formData.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </label>
                </SupabaseFieldRow>
              </div>
            )}

            {/* 4. Courier Form (master_couriers) */}
            {type === 'courier' && (
              <div className="space-y-4">
                <SupabaseFieldRow columnName="id" dataType="uuid" isPrimaryKey>
                  <input
                    type="text"
                    disabled
                    value={formData.partner_code || (isEdit ? record?.partner_code : 'Auto-assigned by system')}
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="partner_name" dataType="varchar" required>
                  <input
                    type="text"
                    required
                    value={formData.partner_name || ''}
                    onChange={(e) => handleChange('partner_name', e.target.value)}
                    placeholder="e.g. Blue Dart Express"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="partner_code" dataType="varchar" required>
                  <input
                    type="text"
                    required
                    disabled={isEdit}
                    value={formData.partner_code || ''}
                    onChange={(e) => handleChange('partner_code', e.target.value.toUpperCase())}
                    placeholder="BLUEDART"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                {/* Optional Fields Divider */}
                <div className="pt-4 pb-1 border-t border-slate-200 dark:border-[#262626] space-y-0.5">
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white">Optional Details</h4>
                  <p className="text-[11px] text-slate-500 dark:text-[#707070]">Additional information (optional)</p>
                </div>

                <SupabaseFieldRow columnName="contact_phone" dataType="varchar">
                  <input
                    type="text"
                    value={formData.contact_phone || ''}
                    onChange={(e) => handleChange('contact_phone', cleanIndianPhoneInput(e.target.value))}
                    placeholder="+91 98765 43210"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="is_active" dataType="boolean">
                  <label className="flex items-center gap-2 cursor-pointer select-none py-1">
                    <input
                      type="checkbox"
                      checked={formData.is_active ?? true}
                      onChange={(e) => handleChange('is_active', e.target.checked)}
                      className="rounded text-[#3ecf8e] focus:ring-0 w-4 h-4 bg-[#181818] border-[#2e2e2e]"
                    />
                    <span className="text-slate-700 dark:text-zinc-300 font-sans text-xs font-medium">
                      {formData.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </label>
                </SupabaseFieldRow>
              </div>
            )}

            {/* 5. User Form (users) */}
            {type === 'user' && (
              <div className="space-y-4">
                {/* Linked Staff Member Selector */}
                {(() => {
                  const isSuperAdminOrDev = formData.role_code === 'Super_Admin' || formData.role_code === 'Developer';
                  return (
                    <>
                      <SupabaseFieldRow
                        columnName="staff_code"
                        dataType="varchar"
                        required={!isEdit && formData.username !== 'aellpadmin' && !isSuperAdminOrDev}
                        description={
                          isSuperAdminOrDev
                            ? 'Optional for Super Admin & Developer root accounts (System Owner)'
                            : 'Required: Link this operational account to an active staff member profile'
                        }
                      >
                        <SearchableSelect
                          options={[
                            {
                              value: '',
                              label: isSuperAdminOrDev
                                ? '-- No Staff Profile (Super Admin / Dev Root) --'
                                : '-- Select Active Staff Member Profile --',
                            },
                            ...availableStaff.map((s) => ({
                              value: s.staff_code,
                              label: `${s.first_name} ${s.last_name !== '-' ? s.last_name : ''}`.trim(),
                              sublabel: `${s.staff_code} • ${s.designation || 'Staff'}`,
                              badge: s.branch_code || s.branch_id,
                            })),
                          ]}
                          value={formData.staff_code || ''}
                          onChange={(selectedCode) => {
                            const selectedStaff = availableStaff.find((s) => s.staff_code === selectedCode);
                            if (selectedStaff) {
                              const cleanFirst = selectedStaff.first_name || '';
                              const cleanLast = selectedStaff.last_name !== '-' ? selectedStaff.last_name : '';
                              const branchId = selectedStaff.branch_id || `Aellp-${selectedStaff.branch_code || 'ASI'}`;
                              const suggestedUsername = !formData.username || !isEdit
                                ? `${cleanFirst.toLowerCase().replace(/[^a-z0-9]/g, '')}.${selectedCode.toLowerCase().replace(/[^a-z0-9]/g, '')}`
                                : formData.username;

                              setFormData((prev: any) => ({
                                ...prev,
                                staff_code: selectedCode,
                                first_name: cleanFirst,
                                last_name: cleanLast,
                                assigned_branches: [branchId],
                                username: suggestedUsername,
                                email: prev.email || `${cleanFirst.toLowerCase()}@asopalav.com`,
                              }));
                            } else {
                              handleChange('staff_code', selectedCode);
                            }
                          }}
                          placeholder="Search active staff member profile..."
                          searchPlaceholder="Search by name, code or branch..."
                        />
                      </SupabaseFieldRow>

                      {isSuperAdminOrDev ? (
                        <div className="p-2.5 rounded-[6px] bg-slate-100 dark:bg-[#1f1f1f] border border-slate-200 dark:border-[#2e2e2e] text-[11px] text-slate-700 dark:text-zinc-300 space-y-1">
                          <div className="font-semibold flex items-center gap-1.5 font-sans text-emerald-600 dark:text-[#3ecf8e]">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>Super Admin / Developer Root Account</span>
                          </div>
                          <p className="text-[10.5px] leading-tight text-slate-500 dark:text-[#a1a1a1]">
                            Super Admin &amp; Developer accounts operate with system-wide root authority and do not need to be registered as branch floor staff.
                          </p>
                        </div>
                      ) : (
                        <div className="p-2.5 rounded-[6px] bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-800 dark:text-emerald-300 space-y-1">
                          <div className="font-semibold flex items-center gap-1.5 font-sans">
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#3ecf8e]" />
                            <span>Automatic Access Cutoff Policy</span>
                          </div>
                          <p className="text-[10.5px] leading-tight text-slate-600 dark:text-[#a1a1a1]">
                            If a staff member leaves or is marked <strong>Inactive / Resigned</strong>, their system login access and counter lock PIN are instantly and automatically revoked.
                          </p>
                        </div>
                      )}
                    </>
                  );
                })()}

                <SupabaseFieldRow columnName="id" dataType="uuid" isPrimaryKey>
                  <input
                    type="text"
                    disabled
                    value={formData.id || (isEdit ? record?.id : 'Auto-assigned by system')}
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="username" dataType="varchar" required>
                  <input
                    type="text"
                    required
                    disabled={isEdit}
                    value={formData.username || ''}
                    onChange={(e) => handleChange('username', e.target.value.toLowerCase())}
                    placeholder="rajesh.asi042"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="first_name" dataType="varchar" required>
                  <input
                    type="text"
                    required
                    value={formData.first_name || ''}
                    onChange={(e) => handleChange('first_name', e.target.value)}
                    placeholder="Rajesh"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="role_code" dataType="varchar" required>
                  <SearchableSelect
                    options={
                      availableRoles.length > 0
                        ? availableRoles.map((r) => ({
                            value: r.role_code,
                            label: `${r.role_title} (${r.role_code})`,
                            sublabel: r.description,
                            badge: r.role_code,
                          }))
                        : [
                            { value: 'Super_Admin', label: 'Super Administrator (HQ)' },
                            { value: 'Developer', label: 'Lead Developer' },
                            { value: 'Store_Manager', label: 'Store Operations Manager' },
                            { value: 'Cashier', label: 'Showroom Cashier' },
                            { value: 'Auditor', label: 'Internal Financial Auditor' },
                          ]
                    }
                    value={formData.role_code || 'Cashier'}
                    onChange={(val) => handleChange('role_code', val)}
                    placeholder="Select system role..."
                    searchPlaceholder="Search role..."
                    allowCustom={false}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow
                  columnName="password_hash"
                  dataType="varchar"
                  required={!isEdit}
                  description={isEdit ? 'Leave blank to keep current password' : 'Encrypted credential for staff login'}
                >
                  <input
                    type="password"
                    required={!isEdit}
                    value={formData.password_hash || ''}
                    onChange={(e) => handleChange('password_hash', e.target.value)}
                    placeholder={isEdit ? '••••••••••••' : 'Enter login password'}
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                {/* Optional Fields Divider */}
                <div className="pt-4 pb-1 border-t border-slate-200 dark:border-[#262626] space-y-0.5">
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white">Optional Details</h4>
                  <p className="text-[11px] text-slate-500 dark:text-[#707070]">Additional information (optional)</p>
                </div>

                <SupabaseFieldRow columnName="last_name" dataType="varchar">
                  <input
                    type="text"
                    value={formData.last_name || ''}
                    onChange={(e) => handleChange('last_name', e.target.value)}
                    placeholder="Patel"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="email" dataType="varchar">
                  <input
                    type="email"
                    value={formData.email || ''}
                    onChange={(e) => handleChange('email', e.target.value)}
                    placeholder="user@asopalav.com"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="lock_pin_hash" dataType="varchar" description="4-Digit Fast Screen Lock PIN">
                  <input
                    type="password"
                    maxLength={4}
                    value={formData.lock_pin_hash || ''}
                    onChange={(e) => handleChange('lock_pin_hash', e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="1234"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="is_active" dataType="boolean">
                  <label className="flex items-center gap-2 cursor-pointer select-none py-1">
                    <input
                      type="checkbox"
                      checked={formData.is_active ?? true}
                      onChange={(e) => handleChange('is_active', e.target.checked)}
                      className="rounded text-[#3ecf8e] focus:ring-0 w-4 h-4 bg-[#181818] border-[#2e2e2e]"
                    />
                    <span className="text-slate-700 dark:text-zinc-300 font-sans text-xs font-medium">
                      {formData.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </label>
                </SupabaseFieldRow>
              </div>
            )}

            {/* 6. Staff Form (master_staff) */}
            {type === 'staff' && (
              <div className="space-y-4">
                <SupabaseFieldRow
                  columnName="staff_code"
                  dataType="varchar"
                  required
                  isPrimaryKey
                  badge={
                    isSuperAdmin && !isEdit ? (
                      <button
                        type="button"
                        onClick={() => {
                          const nextState = !isCustomStaffCode;
                          setIsCustomStaffCode(nextState);
                          if (!nextState) {
                            const bId = formData.branch_id || branches[0]?.branch_id || 'Aellp-ASI';
                            const bObj = branches.find((b) => b.branch_id === bId);
                            const bCode = bObj?.branch_code || 'ASI';
                            erpService.generateNextStaffCode(bCode).then((code) => {
                              setFormData((prev: any) => ({ ...prev, staff_code: code }));
                            });
                          }
                        }}
                        className="text-[10px] font-mono text-[#3ecf8e] hover:underline cursor-pointer ml-2"
                      >
                        {isCustomStaffCode ? 'Auto Seq' : 'Custom'}
                      </button>
                    ) : undefined
                  }
                >
                  <input
                    type="text"
                    required
                    disabled={isEdit || (!isSuperAdmin && !isCustomStaffCode)}
                    value={formData.staff_code || ''}
                    onChange={(e) => handleChange('staff_code', e.target.value.toUpperCase())}
                    placeholder="ASI-042"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="first_name" dataType="varchar" required>
                  <input
                    type="text"
                    required
                    value={formData.first_name || ''}
                    onChange={(e) => handleChange('first_name', e.target.value)}
                    placeholder="Ramesh"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="branch_id" dataType="varchar" required>
                  <SearchableSelect
                    options={branches.map((b) => ({
                      value: b.branch_id,
                      label: b.branch_code,
                      sublabel: b.branch_name.replace(/^Asopalav\s*-\s*/i, ''),
                    }))}
                    value={formData.branch_id || ''}
                    onChange={async (bId) => {
                      const bObj = branches.find((b) => b.branch_id === bId);
                      const bCode = bObj?.branch_code || bId.replace(/^Aellp-/, '') || 'ASI';
                      setFormData((prev: any) => ({
                        ...prev,
                        branch_id: bId,
                        branch_code: bCode,
                      }));
                      if (!isEdit && !isCustomStaffCode) {
                        const nextCode = await erpService.generateNextStaffCode(bCode);
                        setFormData((prev: any) => ({ ...prev, staff_code: nextCode }));
                      }
                    }}
                    placeholder="Select showroom branch..."
                    searchPlaceholder="Search branch name or code..."
                    allowCustom={false}
                  />
                </SupabaseFieldRow>

                {/* Optional Fields Divider */}
                <div className="pt-4 pb-1 border-t border-slate-200 dark:border-[#262626] space-y-0.5">
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white">Optional Details</h4>
                  <p className="text-[11px] text-slate-500 dark:text-[#707070]">Additional information (optional)</p>
                </div>

                <SupabaseFieldRow columnName="last_name" dataType="varchar">
                  <input
                    type="text"
                    value={formData.last_name || ''}
                    onChange={(e) => handleChange('last_name', e.target.value)}
                    placeholder="Patel"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="department_name" dataType="varchar">
                  <SearchableSelect
                    options={[
                      { value: '', label: '-- No Department Selected --' },
                      ...availableDepartments.map((d) => ({
                        value: d.department_name,
                        label: d.department_name,
                        badge: d.department_code,
                      })),
                    ]}
                    value={formData.department_name || ''}
                    onChange={(deptName) => {
                      const matchedDept = availableDepartments.find((d) => d.department_name === deptName);
                      setFormData((prev: any) => ({
                        ...prev,
                        department_name: deptName,
                        department_code: matchedDept?.department_code || prev.department_code || null,
                      }));
                    }}
                    placeholder="Select department..."
                    searchPlaceholder="Search department..."
                    allowCustom={false}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="designation" dataType="varchar">
                  <input
                    type="text"
                    value={formData.designation || ''}
                    onChange={(e) => handleChange('designation', e.target.value)}
                    placeholder="Senior Sales Specialist"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="mobile_number" dataType="varchar">
                  <input
                    type="text"
                    value={formData.mobile_number || ''}
                    onChange={(e) => handleChange('mobile_number', cleanIndianPhoneInput(e.target.value))}
                    placeholder="+91 98765 43210"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="is_active" dataType="boolean">
                  <label className="flex items-center gap-2 cursor-pointer select-none py-1">
                    <input
                      type="checkbox"
                      checked={formData.is_active ?? true}
                      onChange={(e) => handleChange('is_active', e.target.checked)}
                      className="rounded text-[#3ecf8e] focus:ring-0 w-4 h-4 bg-[#181818] border-[#2e2e2e]"
                    />
                    <span className="text-slate-700 dark:text-zinc-300 font-sans text-xs font-medium">
                      {formData.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </label>
                </SupabaseFieldRow>
              </div>
            )}

            {/* 7. Role Form (roles) */}
            {type === 'role' && (
              <div className="space-y-4">
                <SupabaseFieldRow columnName="role_code" dataType="varchar" required isPrimaryKey>
                  <input
                    type="text"
                    required
                    disabled={isEdit}
                    value={formData.role_code || ''}
                    onChange={(e) => handleChange('role_code', e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
                    placeholder="Floor_Supervisor"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                <SupabaseFieldRow columnName="role_title" dataType="varchar" required>
                  <input
                    type="text"
                    required
                    value={formData.role_title || ''}
                    onChange={(e) => handleChange('role_title', e.target.value)}
                    placeholder="Floor Supervisor"
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                {/* Optional Fields Divider */}
                <div className="pt-4 pb-1 border-t border-slate-200 dark:border-[#262626] space-y-0.5">
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white">Optional Details</h4>
                  <p className="text-[11px] text-slate-500 dark:text-[#707070]">Additional information (optional)</p>
                </div>

                <SupabaseFieldRow columnName="description" dataType="text">
                  <input
                    type="text"
                    value={formData.description || ''}
                    onChange={(e) => handleChange('description', e.target.value)}
                    placeholder="Role permissions and operational authorization..."
                    className={inputStyles}
                  />
                </SupabaseFieldRow>

                {/* Granular Permissions Section */}
                <SupabaseFieldRow columnName="permissions" dataType="jsonb" description="Comprehensive RBAC page access & operational capabilities">
                  <div className="p-3.5 rounded-[6px] bg-slate-50 dark:bg-[#181818] border border-slate-200 dark:border-[#2e2e2e] space-y-4 font-sans">
                    {/* Page & Route Access */}
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-slate-800 dark:text-zinc-200 uppercase tracking-wider block font-sans">
                          Page & Route Access
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-[#707070]">Controls navigation, hotkeys & page routes</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                        <label className="flex items-start gap-2.5 p-2 rounded-[4px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#262626] hover:border-emerald-500/50 cursor-pointer select-none transition-colors">
                          <input
                            type="checkbox"
                            checked={formData.can_create_voucher ?? true}
                            onChange={(e) => handleChange('can_create_voucher', e.target.checked)}
                            className="mt-0.5 rounded text-[#3ecf8e] focus:ring-0 cursor-pointer"
                          />
                          <div>
                            <span className="font-medium text-slate-900 dark:text-zinc-100 block">Add Expense (F2)</span>
                            <span className="text-[11px] text-slate-500 dark:text-[#888]">New expense form, food split & courier</span>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 p-2 rounded-[4px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#262626] hover:border-emerald-500/50 cursor-pointer select-none transition-colors">
                          <input
                            type="checkbox"
                            checked={formData.can_inject_float ?? false}
                            onChange={(e) => handleChange('can_inject_float', e.target.checked)}
                            className="mt-0.5 rounded text-[#3ecf8e] focus:ring-0 cursor-pointer"
                          />
                          <div>
                            <span className="font-medium text-slate-900 dark:text-zinc-100 block">Cash Drawer & UPI (F4)</span>
                            <span className="text-[11px] text-slate-500 dark:text-[#888]">Treasury drawer till & float entry</span>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 p-2 rounded-[4px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#262626] hover:border-emerald-500/50 cursor-pointer select-none transition-colors">
                          <input
                            type="checkbox"
                            checked={formData.can_disburse_advance ?? false}
                            onChange={(e) => handleChange('can_disburse_advance', e.target.checked)}
                            className="mt-0.5 rounded text-[#3ecf8e] focus:ring-0 cursor-pointer"
                          />
                          <div>
                            <span className="font-medium text-slate-900 dark:text-zinc-100 block">Staff Advances (F7)</span>
                            <span className="text-[11px] text-slate-500 dark:text-[#888]">Disburse staff imprest & IOUs</span>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 p-2 rounded-[4px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#262626] hover:border-emerald-500/50 cursor-pointer select-none transition-colors">
                          <input
                            type="checkbox"
                            checked={formData.can_manage_users_roles ?? false}
                            onChange={(e) => handleChange('can_manage_users_roles', e.target.checked)}
                            className="mt-0.5 rounded text-[#3ecf8e] focus:ring-0 cursor-pointer"
                          />
                          <div>
                            <span className="font-medium text-slate-900 dark:text-zinc-100 block">Staff Directory (F6)</span>
                            <span className="text-[11px] text-slate-500 dark:text-[#888]">Staff roster, login PINs & accounts</span>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 p-2 rounded-[4px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#262626] hover:border-emerald-500/50 cursor-pointer select-none transition-colors">
                          <input
                            type="checkbox"
                            checked={formData.can_manage_periods ?? false}
                            onChange={(e) => handleChange('can_manage_periods', e.target.checked)}
                            className="mt-0.5 rounded text-[#3ecf8e] focus:ring-0 cursor-pointer"
                          />
                          <div>
                            <span className="font-medium text-slate-900 dark:text-zinc-100 block">Shop Settings (F12)</span>
                            <span className="text-[11px] text-slate-500 dark:text-[#888]">Master tables, roles, categories & branches</span>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 p-2 rounded-[4px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#262626] hover:border-emerald-500/50 cursor-pointer select-none transition-colors">
                          <input
                            type="checkbox"
                            checked={formData.can_view_audit_logs ?? false}
                            onChange={(e) => handleChange('can_view_audit_logs', e.target.checked)}
                            className="mt-0.5 rounded text-[#3ecf8e] focus:ring-0 cursor-pointer"
                          />
                          <div>
                            <span className="font-medium text-slate-900 dark:text-zinc-100 block">Security Audit (F8)</span>
                            <span className="text-[11px] text-slate-500 dark:text-[#888]">Audit trail, login logs & system logbook</span>
                          </div>
                        </label>
                      </div>
                    </div>

                    {/* Operational & Financial Capabilities */}
                    <div className="pt-3 border-t border-slate-200 dark:border-[#282828] space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-slate-800 dark:text-zinc-200 uppercase tracking-wider block font-sans">
                          Operational & Financial Rights
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-[#707070]">Granular action authorization</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                        <label className="flex items-start gap-2.5 p-2 rounded-[4px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#262626] hover:border-emerald-500/50 cursor-pointer select-none transition-colors">
                          <input
                            type="checkbox"
                            checked={formData.can_void_voucher ?? false}
                            onChange={(e) => handleChange('can_void_voucher', e.target.checked)}
                            className="mt-0.5 rounded text-[#3ecf8e] focus:ring-0 cursor-pointer"
                          />
                          <div>
                            <span className="font-medium text-slate-900 dark:text-zinc-100 block">Void Vouchers</span>
                            <span className="text-[11px] text-slate-500 dark:text-[#888]">Cancel or reverse posted expense vouchers</span>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 p-2 rounded-[4px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#262626] hover:border-emerald-500/50 cursor-pointer select-none transition-colors">
                          <input
                            type="checkbox"
                            checked={formData.can_backdate_voucher ?? false}
                            onChange={(e) => handleChange('can_backdate_voucher', e.target.checked)}
                            className="mt-0.5 rounded text-[#3ecf8e] focus:ring-0 cursor-pointer"
                          />
                          <div>
                            <span className="font-medium text-slate-900 dark:text-zinc-100 block">Backdate Transactions</span>
                            <span className="text-[11px] text-slate-500 dark:text-[#888]">Record vouchers with historical dates</span>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 p-2 rounded-[4px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#262626] hover:border-emerald-500/50 cursor-pointer select-none transition-colors">
                          <input
                            type="checkbox"
                            checked={formData.can_settle_advance ?? false}
                            onChange={(e) => handleChange('can_settle_advance', e.target.checked)}
                            className="mt-0.5 rounded text-[#3ecf8e] focus:ring-0 cursor-pointer"
                          />
                          <div>
                            <span className="font-medium text-slate-900 dark:text-zinc-100 block">Settle Staff Advances</span>
                            <span className="text-[11px] text-slate-500 dark:text-[#888]">Clear pending IOUs with bills or cash return</span>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 p-2 rounded-[4px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#262626] hover:border-emerald-500/50 cursor-pointer select-none transition-colors">
                          <input
                            type="checkbox"
                            checked={formData.can_export_tally ?? false}
                            onChange={(e) => handleChange('can_export_tally', e.target.checked)}
                            className="mt-0.5 rounded text-[#3ecf8e] focus:ring-0 cursor-pointer"
                          />
                          <div>
                            <span className="font-medium text-slate-900 dark:text-zinc-100 block">Export Tally / Excel</span>
                            <span className="text-[11px] text-slate-500 dark:text-[#888]">Download XML & CSV accounting exports</span>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 p-2 rounded-[4px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#262626] hover:border-emerald-500/50 cursor-pointer select-none transition-colors">
                          <input
                            type="checkbox"
                            checked={formData.can_view_all_branches ?? false}
                            onChange={(e) => handleChange('can_view_all_branches', e.target.checked)}
                            className="mt-0.5 rounded text-[#3ecf8e] focus:ring-0 cursor-pointer"
                          />
                          <div>
                            <span className="font-medium text-slate-900 dark:text-zinc-100 block">Multi-Branch View</span>
                            <span className="text-[11px] text-slate-500 dark:text-[#888]">Switch and view all showroom branches</span>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 p-2 rounded-[4px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#262626] hover:border-emerald-500/50 cursor-pointer select-none transition-colors">
                          <input
                            type="checkbox"
                            checked={formData.can_download_hr_payroll ?? false}
                            onChange={(e) => handleChange('can_download_hr_payroll', e.target.checked)}
                            className="mt-0.5 rounded text-[#3ecf8e] focus:ring-0 cursor-pointer"
                          />
                          <div>
                            <span className="font-medium text-slate-900 dark:text-zinc-100 block">HR & Payroll Reports</span>
                            <span className="text-[11px] text-slate-500 dark:text-[#888]">Export employee advance deductions</span>
                          </div>
                        </label>
                      </div>
                    </div>

                    {/* Disbursal Limit */}
                    <div className="pt-3 border-t border-slate-200 dark:border-[#282828] space-y-2">
                      <span className="text-[11px] font-semibold text-slate-800 dark:text-zinc-200 uppercase tracking-wider block font-sans">
                        Disbursal Limits
                      </span>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <label className="text-xs text-slate-600 dark:text-[#888] block mb-1">
                            Max Staff Advance Limit per Disbursal (₹)
                          </label>
                          <input
                            type="number"
                            value={formData.max_advance_limit ?? 5000}
                            onChange={(e) => handleChange('max_advance_limit', Number(e.target.value))}
                            className={inputStyles}
                            min={0}
                            step={500}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </SupabaseFieldRow>
              </div>
            )}

            {/* Delete Confirmation Box */}
            {confirmDelete && (
              <div className="p-3.5 bg-rose-50/80 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-[6px] space-y-2.5 font-sans">
                <span className="text-xs text-rose-800 dark:text-rose-400 font-medium block">
                  Confirm Permanent Deletion (Super Admin)
                </span>
                <input
                  type="text"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Mandatory reason for audit trail..."
                  className="w-full h-8 bg-white dark:bg-[#141414] border border-rose-300 dark:border-rose-800/60 rounded-[4px] px-2.5 text-xs text-slate-900 dark:text-white focus:outline-none font-sans"
                />
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={loading}
                  className="h-7 px-3 rounded-[4px] bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium transition-colors cursor-pointer"
                >
                  {loading ? 'Deleting...' : 'Delete Permanently'}
                </button>
              </div>
            )}
        </form>
      </div>

      {/* Pre-Commit Confirmation Preview Modal */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-60 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#2a2a2a] rounded-[12px] shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100 dark:border-[#242424]">
              <div className="w-8 h-8 rounded-[6px] bg-emerald-500/10 text-emerald-600 dark:text-[#3ecf8e] flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white font-sans">
                  {isEdit ? 'Confirm Update' : 'Confirm New Record'}
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-[#888888] font-sans">
                  Review details for {entityLabels[type]} before saving
                </p>
              </div>
            </div>

            {/* Key Summary Details Card */}
            <div className="p-3.5 rounded-[8px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#242424] space-y-2 text-xs font-mono">
              {type === 'staff' && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Staff ID:</span>
                    <span className="font-semibold text-emerald-600 dark:text-[#3ecf8e]">{formData.staff_code}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Full Name:</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{formData.first_name} {formData.middle_name || ''} {formData.last_name || ''}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Department:</span>
                    <span className="text-slate-900 dark:text-white">{formData.department_name || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Branch:</span>
                    <span className="text-slate-900 dark:text-white">{formData.branch_code || 'ASI'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Designation:</span>
                    <span className="text-slate-900 dark:text-white">{formData.designation || '—'}</span>
                  </div>
                  {formData.mobile_number && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 dark:text-[#707070]">Phone:</span>
                      <span className="text-slate-900 dark:text-white">{formData.mobile_number}</span>
                    </div>
                  )}
                </>
              )}

              {type === 'user' && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Username:</span>
                    <span className="font-semibold text-emerald-600 dark:text-[#3ecf8e]">@{formData.username}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Full Name:</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{formData.first_name} {formData.last_name || ''}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Role:</span>
                    <span className="text-slate-900 dark:text-white">{formData.role_code}</span>
                  </div>
                  {formData.staff_code && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 dark:text-[#707070]">Linked Staff:</span>
                      <span className="text-slate-900 dark:text-white">{formData.staff_code}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Branch Access:</span>
                    <span className="text-slate-900 dark:text-white">{(formData.assigned_branches || ['*']).join(', ')}</span>
                  </div>
                </>
              )}

              {type === 'branch' && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Branch Name:</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{formData.branch_name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Branch Code:</span>
                    <span className="font-semibold text-emerald-600 dark:text-[#3ecf8e]">{formData.branch_code}</span>
                  </div>
                  {formData.city && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 dark:text-[#707070]">City / State:</span>
                      <span className="text-slate-900 dark:text-white">{formData.city}, {formData.state || 'Gujarat'}</span>
                    </div>
                  )}
                </>
              )}

              {type === 'category' && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Category Name:</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{formData.category_name}</span>
                  </div>
                  {formData.color_theme && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 dark:text-[#707070]">Theme:</span>
                      <span className="text-slate-900 dark:text-white">{formData.color_theme}</span>
                    </div>
                  )}
                </>
              )}

              {type === 'department' && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Department Name:</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{formData.department_name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Code:</span>
                    <span className="font-semibold text-emerald-600 dark:text-[#3ecf8e]">{formData.department_code}</span>
                  </div>
                </>
              )}

              {type === 'courier' && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Partner Name:</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{formData.partner_name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Code:</span>
                    <span className="font-semibold text-emerald-600 dark:text-[#3ecf8e]">{formData.partner_code}</span>
                  </div>
                  {formData.contact_phone && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 dark:text-[#707070]">Phone:</span>
                      <span className="text-slate-900 dark:text-white">{formData.contact_phone}</span>
                    </div>
                  )}
                </>
              )}

              {type === 'role' && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Role Code:</span>
                    <span className="font-semibold text-emerald-600 dark:text-[#3ecf8e]">{formData.role_code}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-[#707070]">Role Title:</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{formData.role_title}</span>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                disabled={loading}
                className="flex-1 py-2 px-3 rounded-[6px] border border-slate-200 dark:border-[#282828] bg-slate-50 dark:bg-[#202020] text-slate-700 dark:text-[#EDEDED] font-medium transition-colors cursor-pointer hover:bg-slate-100 dark:hover:bg-[#262626]"
              >
                Back & Edit
              </button>
              <button
                type="button"
                onClick={handleFinalCommit}
                disabled={loading}
                className="flex-1 py-2 px-3 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50"
              >
                {loading ? (
                  <div className="w-3.5 h-3.5 border-2 border-[#171717] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                )}
                <span>Confirm & Save</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Name Change & Historical Cascade Confirmation Modal */}
      {renameCascadeModal && renameCascadeModal.open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[12px] p-6 max-w-lg w-full shadow-2xl space-y-5">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Rename Master Record
                </h3>
                <p className="text-xs text-slate-500 dark:text-[#a1a1a1]">
                  You are changing the name of this master entity from <span className="font-mono font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-[4px]">{renameCascadeModal.oldName}</span> to <span className="font-mono font-semibold text-emerald-600 dark:text-[#3ecf8e] bg-emerald-500/10 px-1.5 py-0.5 rounded-[4px]">{renameCascadeModal.newName}</span>.
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-[8px] bg-slate-50 dark:bg-[#1c1c1c] border border-slate-200 dark:border-[#2e2e2e] space-y-2 text-xs">
              <div className="font-medium text-slate-700 dark:text-zinc-200">
                How should existing vouchers, splits, and historical ledgers be handled?
              </div>
              <p className="text-[11px] text-slate-500 dark:text-[#888888] leading-relaxed">
                Choose whether you want to update all existing historical vouchers and reports to use the new name, or only use the new name for future vouchers while keeping old records unchanged.
              </p>
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => handleExecuteRename(true)}
                disabled={loading}
                className="w-full text-left p-3.5 rounded-[8px] bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 transition-colors cursor-pointer group"
              >
                <div className="flex items-center justify-between font-semibold text-xs text-emerald-950 dark:text-[#3ecf8e]">
                  <span>Update ALL Past &amp; Future Records (Recommended)</span>
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-500/20">Full Cascade</span>
                </div>
                <p className="text-[11px] text-emerald-900/70 dark:text-emerald-300/70 mt-1 leading-tight">
                  Renames all historical expense vouchers, split lines, advances, and registers. Logs a full audit trail of the rename.
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleExecuteRename(false)}
                disabled={loading}
                className="w-full text-left p-3.5 rounded-[8px] bg-slate-100 hover:bg-slate-200/80 dark:bg-[#202020] dark:hover:bg-[#262626] border border-slate-200 dark:border-[#333333] text-slate-800 dark:text-zinc-200 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between font-semibold text-xs">
                  <span>Only Apply to NEW Records</span>
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-[#333333]">Master Only</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-[#888888] mt-1 leading-tight">
                  Past vouchers keep the old name &quot;{renameCascadeModal.oldName}&quot;. Only vouchers created after this point will use the new name.
                </p>
              </button>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-[#262626]">
              <button
                type="button"
                onClick={() => setRenameCascadeModal(null)}
                disabled={loading}
                className="py-2 px-4 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#222222] text-xs font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </SlideOverDrawer>
  );
};
