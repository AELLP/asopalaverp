import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuthStore, isPrivilegedAdminRole } from '@/store/authStore';
import { useBranchStore } from '@/store/branchStore';
import { useUIStore } from '@/store/uiStore';
import { useVouchers } from '@/hooks/useVouchers';
import { erpService } from '@/lib/erpService';
import { AppUser, StaffMember } from '@/types/database';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { MasterDataDrawer, MasterDrawerType } from '@/components/settings/MasterDataDrawer';
import { SegmentedControl } from '@/components/ui';
import { showToast } from '@/components/ui/ToastContainer';
import { confirmDialog } from '@/store/dialogStore';
import bcrypt from 'bcryptjs';
import { logSecurityEvent } from '@/lib/audit';
import { UserAvatar } from '@/components/ui/UserAvatar';
import {
  UserPlus,
  FileSpreadsheet,
  Search,  Shield,
  ShieldCheck,  Users,
  Edit2,
  Plus,
  Check,
  UserCheck,
  UserX,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,  MoreVertical,  X,
  SlidersHorizontal,
  CheckSquare,
  Square,
  Sparkles,
  Phone,  Key,
  Lock,
  Unlock,  Eye,
  EyeOff,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { cn, formatIndianPhone } from '@/lib/utils';
import { EmptyState } from '@/components/ui/EmptyState';

type UserSortField = 'username' | 'name' | 'role' | 'status';
type StaffSortField = 'code' | 'name' | 'department' | 'branch' | 'designation';
type SortOrder = 'asc' | 'desc';
type TableDensity = 'compact' | 'normal' | 'relaxed';

type UserColumnKey = 'username' | 'staff_code' | 'name' | 'role' | 'branches' | 'status' | 'actions';
type StaffColumnKey = 'code' | 'name' | 'login_access' | 'department' | 'branch' | 'mobile' | 'designation' | 'actions';

const USER_COLUMNS: { key: UserColumnKey; label: string }[] = [
  { key: 'username', label: 'Username' },
  { key: 'staff_code', label: 'Linked Staff' },
  { key: 'name', label: 'Full Name' },
  { key: 'role', label: 'Role & Permissions' },
  { key: 'branches', label: 'Branch Access' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: 'Quick Tools' },
];

const STAFF_COLUMNS: { key: StaffColumnKey; label: string }[] = [
  { key: 'code', label: 'Staff ID' },
  { key: 'name', label: 'Full Name' },
  { key: 'login_access', label: 'Login Access' },
  { key: 'department', label: 'Department' },
  { key: 'branch', label: 'Branch' },
  { key: 'mobile', label: 'Phone' },
  { key: 'designation', label: 'Role / Title' },
  { key: 'actions', label: 'Actions' },
];

function downloadBlob(filename: string, content: string, mimeType: string) {
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

interface ResetUserPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: AppUser | null;
  onSuccess: () => void;
}

const ResetUserPasswordModal: React.FC<ResetUserPasswordModalProps> = ({
  isOpen,
  onClose,
  user,
  onSuccess,
}) => {
  const { user: currentUser } = useAuthStore();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pin, setPin] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successData, setSuccessData] = useState<{
    password: string;
    pin: string;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setNewPassword('');
      setConfirmPassword('');
      setPin('');
      setShowPassword(false);
      setShowConfirmPassword(false);
      setError('');
      setSuccessData(null);
      setIsPreviewOpen(false);
    }
  }, [isOpen, user]);

  if (!isOpen || !user) return null;

  const generateRandomPassword = () => {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const generatedPass = `Asopalav@${randomNum}`;
    const generatedPin = String(randomNum);
    setNewPassword(generatedPass);
    setConfirmPassword(generatedPass);
    setPin(generatedPin);
    setShowPassword(true);
    setShowConfirmPassword(true);
    setError('');
  };

  const setStandardDefault = () => {
    setNewPassword('Admin@123');
    setConfirmPassword('Admin@123');
    setPin('1234');
    setShowPassword(true);
    setShowConfirmPassword(true);
    setError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!newPassword && !pin) {
      setError('Please enter a new password or 4-digit PIN.');
      return;
    }

    if (newPassword) {
      if (newPassword.length < 6) {
        setError('Password must be at least 6 characters long.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('New password and confirmation password do not match.');
        return;
      }
    }

    if (pin && !/^\d{4}$/.test(pin)) {
      setError('PIN must be exactly 4 numbers (for example: 1234).');
      return;
    }

    // Open Pre-Commit Confirmation Preview
    setIsPreviewOpen(true);
  };

  const handleFinalCommit = async () => {
    setIsSubmitting(true);
    setError('');

    try {
      const updates: any = {
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role_code: user.role_code,
        assigned_branches: user.assigned_branches || ['*'],
        theme_preference: user.theme_preference || 'Dark',
        is_active: user.is_active ?? true,
      };

      if (newPassword) {
        updates.password_hash = bcrypt.hashSync(newPassword, 10);
      }

      if (pin) {
        updates.lock_pin_hash = bcrypt.hashSync(pin, 10);
        useAuthStore.getState().updateUserPin(user.id, pin);
      }

      const adminName = `${currentUser?.first_name || ''} ${currentUser?.last_name || ''}`.trim() || 'Super Admin';
      const adminRole = currentUser?.role_code || 'Super_Admin';

      await erpService.saveAppUser(updates, true, adminName, adminRole);

      logSecurityEvent({
        userName: adminName,
        userRole: adminRole as any,
        actionType: 'SuperAdmin_Override' as any,
        targetEntity: 'app_users',
        targetIdentifier: user.username,
        eventDescription: `Reset credentials for user @${user.username} (${user.role_code})`,
        justification: 'Manual password/PIN reset via Staff Directory',
      });

      setSuccessData({
        password: newPassword,
        pin: pin,
      });

      setIsPreviewOpen(false);

      showToast({
        type: 'success',
        title: 'Password Updated',
        message: `Credentials for @${user.username} have been updated successfully.`,
      });

      onSuccess();
    } catch (err: any) {
      console.error('Failed to reset password:', err);
      setError(err.message || 'Failed to update credentials.');
      setIsPreviewOpen(false);
      showToast({
        type: 'error',
        title: 'Update Failed',
        message: err.message || 'Could not update user credentials.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 selection:bg-[#3ecf8e]/20 selection:text-[#3ecf8e]">
      <div
        className="w-full max-w-md bg-white dark:bg-[#1c1c1e] border border-slate-200 dark:border-[#282828] rounded-[12px] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-modal-title"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-[#282828] bg-slate-50 dark:bg-[#171717]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[6px] bg-emerald-500/10 text-emerald-600 dark:text-[#3ecf8e] border border-emerald-500/20 flex items-center justify-center shrink-0">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h3 id="reset-modal-title" className="text-sm font-semibold text-slate-900 dark:text-white font-sans">
                Change Password & PIN
              </h3>
              <p className="text-xs text-slate-500 dark:text-[#888888] font-sans mt-0.5">
                Set a new password or 4-digit lock PIN for this user
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-[6px] bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-[#888888] hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs font-sans">
          {/* Target User Info Card */}
          <div className="flex items-center justify-between p-3 rounded-[8px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#282828]">
            <div className="flex items-center gap-3 min-w-0">
              <UserAvatar
                src={user.avatar_url}
                firstName={user.first_name}
                lastName={user.last_name}
                name={user.username}
                size={36}
                shape="square"
                className="border border-[#3ecf8e]/30 shrink-0"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900 dark:text-white truncate">
                    {user.first_name} {user.last_name}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-[4px] bg-slate-200 dark:bg-[#282828] text-slate-700 dark:text-[#EDEDED] font-medium">
                    {user.role_code}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-emerald-600 dark:text-[#3ecf8e] truncate mt-0.5">
                  @{user.username}
                  {user.staff_code && (
                    <span className="text-slate-400 dark:text-[#707070] ml-2">
                      • Staff ID: {user.staff_code}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Success State Card */}
          {successData ? (
            <div className="p-4 rounded-[8px] bg-emerald-500/10 border border-emerald-500/30 space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-[#3ecf8e] font-semibold">
                <Check className="w-4 h-4 stroke-[2.5]" />
                <span>Password & PIN Saved!</span>
              </div>
              <div className="p-3 rounded-[6px] bg-white dark:bg-[#141414] border border-emerald-500/20 font-mono text-xs space-y-1.5 text-slate-800 dark:text-[#EDEDED]">
                <div>
                  <span className="text-slate-400 dark:text-[#707070]">Username: </span>
                  <strong className="text-slate-900 dark:text-white">@{user.username}</strong>
                </div>
                {successData.password && (
                  <div>
                    <span className="text-slate-400 dark:text-[#707070]">New Password: </span>
                    <strong className="text-emerald-600 dark:text-[#3ecf8e]">{successData.password}</strong>
                  </div>
                )}
                {successData.pin && (
                  <div>
                    <span className="text-slate-400 dark:text-[#707070]">PIN: </span>
                    <strong className="text-emerald-600 dark:text-[#3ecf8e]">{successData.pin}</strong>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2 px-4 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-semibold transition-all cursor-pointer shadow-xs text-center"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Quick Preset Generator Toolbar */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={setStandardDefault}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-[6px] border border-slate-200 dark:border-[#282828] bg-slate-50 dark:bg-[#141414] hover:bg-slate-100 dark:hover:bg-[#202020] text-[11px] font-mono text-slate-700 dark:text-[#EDEDED] transition-all cursor-pointer shadow-xs"
                  title="Use default password"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>Use Default (Admin@123)</span>
                </button>
                <button
                  type="button"
                  onClick={generateRandomPassword}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-[6px] border border-slate-200 dark:border-[#282828] bg-slate-50 dark:bg-[#141414] hover:bg-slate-100 dark:hover:bg-[#202020] text-[11px] font-mono text-slate-700 dark:text-[#EDEDED] transition-all cursor-pointer shadow-xs"
                  title="Generate random password"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
                  <span>Generate Random</span>
                </button>
              </div>

              {/* Row 1: New Password */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-800 dark:text-[#EDEDED]">
                  New Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full h-10 min-h-[40px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[6px] pl-3 pr-9 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 transition-colors"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Row 2: Confirm Password */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-800 dark:text-[#EDEDED]">
                  Re-enter New Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Type password again"
                    className="w-full h-10 min-h-[40px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[6px] pl-3 pr-9 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {newPassword && confirmPassword && (
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] font-mono">
                    {newPassword === confirmPassword ? (
                      <span className="text-emerald-600 dark:text-[#3ecf8e] flex items-center gap-1 font-medium">
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                        <span>Passwords match</span>
                      </span>
                    ) : (
                      <span className="text-rose-500 dark:text-rose-400 flex items-center gap-1 font-medium">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Passwords do not match</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Row 3: 4-Digit Screen Lock PIN */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-800 dark:text-[#EDEDED]">
                    4-Digit Counter Lock PIN <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <span className="text-[10px] font-mono text-slate-400 dark:text-[#707070]">
                    Used for Quick PIN Lock
                  </span>
                </div>
                <input
                  type="password"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 1234"
                  className="w-36 h-10 min-h-[40px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[6px] px-3 text-xs font-mono font-semibold tracking-widest text-center text-slate-900 dark:text-white focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 transition-colors"
                />
              </div>

              {/* Error Message */}
              {error && (
                <div className="p-3 rounded-[6px] bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs flex items-center gap-2 font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Modal Footer Actions */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-[#282828]">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="px-3.5 py-2 rounded-[6px] border border-slate-200 dark:border-[#282828] hover:bg-slate-100 dark:hover:bg-[#242424] text-slate-700 dark:text-[#EDEDED] font-medium transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-4 py-2 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-semibold transition-all cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <Key className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Save Password & PIN</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Pre-Commit Confirmation Preview Modal */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-60 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#2a2a2a] rounded-[12px] shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100 dark:border-[#242424]">
              <div className="w-8 h-8 rounded-[6px] bg-emerald-500/10 text-emerald-600 dark:text-[#3ecf8e] flex items-center justify-center">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white font-sans">
                  Confirm Password Update
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-[#888888] font-sans">
                  Please review the details before saving
                </p>
              </div>
            </div>

            <div className="p-3 rounded-[8px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#242424] space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-[#707070]">User:</span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {user.first_name} {user.last_name} (@{user.username})
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-[#707070]">Role:</span>
                <span className="text-slate-900 dark:text-white">{user.role_code}</span>
              </div>
              {newPassword && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-[#707070]">New Password:</span>
                  <span className="text-emerald-600 dark:text-[#3ecf8e] font-semibold">{newPassword}</span>
                </div>
              )}
              {pin && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-[#707070]">PIN:</span>
                  <span className="text-emerald-600 dark:text-[#3ecf8e] font-semibold">{pin}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                disabled={isSubmitting}
                className="flex-1 py-2 px-3 rounded-[6px] border border-slate-200 dark:border-[#282828] bg-slate-50 dark:bg-[#202020] text-slate-700 dark:text-[#EDEDED] font-medium transition-colors cursor-pointer hover:bg-slate-100 dark:hover:bg-[#262626]"
              >
                Back & Edit
              </button>
              <button
                type="button"
                onClick={handleFinalCommit}
                disabled={isSubmitting}
                className="flex-1 py-2 px-3 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50"
              >
                {isSubmitting ? (
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
    </div>
  );
};

export const StaffDirectoryPage: React.FC = () => {
  const { user, can, getAllowedBranches } = useAuthStore();
    const { branches, selectedBranchId } = useBranchStore();
  const { setBulkImportOpen } = useUIStore();
  const { staff, refresh, loading } = useVouchers();

  const allowedBranches = getAllowedBranches(branches);
  const canViewAll = isPrivilegedAdminRole(user?.role_code) || can('can_view_all_branches');

  const [activeTab, setActiveTab] = useState<'logins' | 'staff'>('logins');
  const [search, setSearch] = useState('');
  const [staffBranchFilter, setStaffBranchFilter] = useState(canViewAll ? (selectedBranchId || 'ALL') : (allowedBranches[0]?.branch_id || 'Aellp-ASI'));
  const [usersList, setUsersList] = useState<AppUser[]>([]);
    
  // Sorting
  const [userSortField, setUserSortField] = useState<UserSortField>('username');
  const [userSortOrder, setUserSortOrder] = useState<SortOrder>('asc');
  const [staffSortField, setStaffSortField] = useState<StaffSortField>('code');
  const [staffSortOrder, setStaffSortOrder] = useState<SortOrder>('asc');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Pro Enterprise Controls
  const [density, setDensity] = useState<TableDensity>('normal');
    const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false);
  const [activeRowDropdownId, setActiveRowDropdownId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // Column Visibility
  const [visibleUserCols, setVisibleUserCols] = useState<Set<UserColumnKey>>(
    new Set(['username', 'staff_code', 'name', 'role', 'branches', 'status', 'actions'])
  );
  const [visibleStaffCols, setVisibleStaffCols] = useState<Set<StaffColumnKey>>(
    new Set(['code', 'name', 'login_access', 'department', 'branch', 'mobile', 'designation', 'actions'])
  );

  const searchInputRef = useRef<HTMLInputElement | null>(null);
    const columnPickerRef = useRef<HTMLDivElement | null>(null);

  // Drawer States
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerType, setDrawerType] = useState<MasterDrawerType>('user');
  const [selectedRecord, setSelectedRecord] = useState<any>(null);

  // Password Reset Modal State
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [resetTargetUser, setResetTargetUser] = useState<AppUser | null>(null);

  const handleOpenResetPassword = (u: AppUser) => {
    setResetTargetUser(u);
    setIsResetModalOpen(true);
    setActiveRowDropdownId(null);
  };

  const userMapByStaffCode = useMemo(() => {
    const map = new Map<string, AppUser>();
    usersList.forEach((u) => {
      if (u.staff_code) map.set(u.staff_code, u);
      map.set(u.id, u);
    });
    return map;
  }, [usersList]);

  const loadDirectory = async () => {
    try {
      const u = await erpService.getAppUsers();
      setUsersList(u);
    } catch (e) {
      console.error('Error loading staff directory:', e);
    }
  };

  useEffect(() => {
    loadDirectory();
    const handleUpdates = () => {
      loadDirectory();
    };
    window.addEventListener('asopalav:master-data-updated', handleUpdates);
    window.addEventListener('asopalav:users-roles-updated', handleUpdates);
    return () => {
      window.removeEventListener('asopalav:master-data-updated', handleUpdates);
      window.removeEventListener('asopalav:users-roles-updated', handleUpdates);
    };
  }, []);

  const handleGrantLoginForStaff = (s: StaffMember) => {
    const cleanFirst = s.first_name || '';
    const cleanLast = s.last_name !== '-' ? s.last_name : '';
    const branchId = s.branch_id || `Aellp-${s.branch_code || 'ASI'}`;
    const suggestedUsername = `${cleanFirst.toLowerCase().replace(/[^a-z0-9]/g, '')}.${s.staff_code.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

    setSelectedRecord({
      staff_code: s.staff_code,
      first_name: cleanFirst,
      last_name: cleanLast,
      username: suggestedUsername,
      role_code: s.designation?.toLowerCase().includes('manager') ? 'Store_Manager' : 'Cashier',
      assigned_branches: [branchId],
      email: `${cleanFirst.toLowerCase()}@asopalav.com`,
      is_active: true,
    });
    setDrawerType('user');
    setIsDrawerOpen(true);
  };

  const handleToggleStaffStatus = async (s: StaffMember, currentActive: boolean) => {
    const newActive = !currentActive;
    const actionDesc = newActive ? 'Reactivate' : 'Deactivate / Mark as Left Company';
    await confirmDialog({
      title: `${actionDesc} Staff Member`,
      message: `Are you sure you want to ${actionDesc.toLowerCase()} for ${s.first_name} ${s.last_name} (${s.staff_code})? ${!newActive ? 'This will immediately revoke all system login access.' : ''}`,
      confirmText: newActive ? 'Reactivate' : 'Deactivate Staff',
      variant: newActive ? 'primary' : 'danger',
      onConfirm: async () => {
        try {
          const userName = `${user?.first_name || 'Admin'} ${user?.last_name || ''}`.trim();
          const userRole = user?.role_code || 'Super_Admin';
          await erpService.toggleStaffActiveStatus(s.staff_code, newActive, `${s.first_name} ${s.last_name}`, userName, userRole);
          loadDirectory();
          refresh();
          showToast({
            type: 'success',
            title: newActive ? 'Staff Reactivated' : 'Staff Deactivated & Access Cut',
            message: newActive
              ? `Staff member ${s.first_name} is active.`
              : `Staff member ${s.first_name} deactivated and login access revoked.`,
          });
        } catch (err: any) {
          showToast({
            type: 'error',
            title: 'Action Failed',
            message: err.message || 'Could not update staff status.',
          });
        }
      },
    });
  };

  const handleRevokeLoginAccess = async (targetUser: AppUser) => {
    await confirmDialog({
      title: 'Revoke Login Access',
      message: `Cut and revoke login access for @${targetUser.username}? The user will be logged out immediately.`,
      confirmText: 'Revoke Access',
      variant: 'danger',
      onConfirm: async () => {
        try {
          const userName = `${user?.first_name || 'Admin'} ${user?.last_name || ''}`.trim();
          const userRole = user?.role_code || 'Super_Admin';
          await erpService.saveAppUser({ ...targetUser, is_active: false }, true, userName, userRole);
          loadDirectory();
          showToast({
            type: 'success',
            title: 'Login Access Revoked',
            message: `Login access for @${targetUser.username} is now deactivated.`,
          });
        } catch (err: any) {
          showToast({
            type: 'error',
            title: 'Revocation Failed',
            message: err.message || 'Could not revoke login access.',
          });
        }
      },
    });
  };

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
    setFocusedIndex(-1);
  }, [activeTab, search, staffBranchFilter, pageSize]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      
      if (columnPickerRef.current && !columnPickerRef.current.contains(e.target as Node)) {
        setIsColumnPickerOpen(false);
      }
      if (
        activeRowDropdownId &&
        !(e.target as HTMLElement).closest(`[data-dropdown-id="${activeRowDropdownId}"]`)
      ) {
        setActiveRowDropdownId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeRowDropdownId]);

  const handleOpenCreateUser = () => {
    setSelectedRecord(undefined);
    setDrawerType('user');
    setIsDrawerOpen(true);
  };

  const handleOpenEditUser = (u: AppUser) => {
    setSelectedRecord(u);
    setDrawerType('user');
    setIsDrawerOpen(true);
  };

  const handleOpenCreateStaff = () => {
    setSelectedRecord(undefined);
    setDrawerType('staff');
    setIsDrawerOpen(true);
  };

  const handleOpenEditStaff = (s: StaffMember) => {
    setSelectedRecord(s);
    setDrawerType('staff');
    setIsDrawerOpen(true);
  };

  const handleDrawerSuccess = () => {
    loadDirectory();
    refresh();
    setIsDrawerOpen(false);
  };

  const getBranchDisplay = (assigned: string[]): string => {
    if (!assigned || assigned.includes('*')) return 'All Outlets (HQ)';
    return assigned
      .map((id) => {
        const found = branches.find((b) => b.branch_id === id);
        return found ? found.branch_code : id;
      })
      .join(', ');
  };

  const filteredUsers = useMemo(() => {
    let list = usersList.filter((u) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        u.username.toLowerCase().includes(q) ||
        u.first_name.toLowerCase().includes(q) ||
        u.last_name.toLowerCase().includes(q) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        u.role_code.toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (userSortField === 'username') {
        cmp = a.username.localeCompare(b.username);
      } else if (userSortField === 'name') {
        cmp = `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
      } else if (userSortField === 'role') {
        cmp = a.role_code.localeCompare(b.role_code);
      } else if (userSortField === 'status') {
        cmp = Number(b.is_active !== false) - Number(a.is_active !== false);
      }
      return userSortOrder === 'desc' ? -cmp : cmp;
    });

    return list;
  }, [usersList, search, userSortField, userSortOrder]);

  const filteredStaff = useMemo(() => {
    let list = staff.filter((s) => {
      const matchBranch = staffBranchFilter === 'ALL' || s.branch_id === staffBranchFilter;
      if (!matchBranch) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        (s.first_name || '').toLowerCase().includes(q) ||
        (s.last_name || '').toLowerCase().includes(q) ||
        (s.staff_code || '').toLowerCase().includes(q) ||
        (s.department_name && s.department_name.toLowerCase().includes(q)) ||
        (s.mobile_number && s.mobile_number.includes(q))
      );
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (staffSortField === 'code') {
        cmp = (a.staff_code || '').localeCompare(b.staff_code || '');
      } else if (staffSortField === 'name') {
        cmp = `${a.first_name || ''} ${a.last_name || ''}`.localeCompare(`${b.first_name || ''} ${b.last_name || ''}`);
      } else if (staffSortField === 'department') {
        cmp = (a.department_name || '').localeCompare(b.department_name || '');
      } else if (staffSortField === 'branch') {
        cmp = (a.branch_code || '').localeCompare(b.branch_code || '');
      } else if (staffSortField === 'designation') {
        cmp = (a.designation || '').localeCompare(b.designation || '');
      }
      return staffSortOrder === 'desc' ? -cmp : cmp;
    });

    return list;
  }, [staff, search, staffBranchFilter, staffSortField, staffSortOrder]);

  const currentRecordsCount = activeTab === 'logins' ? filteredUsers.length : filteredStaff.length;
  const totalPages = Math.max(1, Math.ceil(currentRecordsCount / pageSize));

  const paginatedUsers = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize;
    return filteredUsers.slice(startIdx, startIdx + pageSize);
  }, [filteredUsers, currentPage, pageSize]);

  const paginatedStaff = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize;
    return filteredStaff.slice(startIdx, startIdx + pageSize);
  }, [filteredStaff, currentPage, pageSize]);

  // Current page records for batch select
  const currentDisplayedRecords = useMemo(() => {
    return activeTab === 'logins' ? paginatedUsers : paginatedStaff;
  }, [activeTab, paginatedUsers, paginatedStaff]);

  const allPageSelected = useMemo(() => {
    if (currentDisplayedRecords.length === 0) return false;
    return currentDisplayedRecords.every((r) =>
      selectedIds.has(activeTab === 'logins' ? (r as AppUser).id : (r as StaffMember).staff_code)
    );
  }, [currentDisplayedRecords, selectedIds, activeTab]);

  const toggleSelectAllPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const ids = currentDisplayedRecords.map((r) =>
        activeTab === 'logins' ? (r as AppUser).id : (r as StaffMember).staff_code
      );
      if (allPageSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleSelectRow = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Keyboard navigation ('/' to search, J/K focus, Space select, Enter edit)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput =
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT';

      if (e.key === '/' && !isInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (isInput) return;

      const records = currentDisplayedRecords;
      if (records.length === 0) return;

      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        setFocusedIndex((prev) => (prev < records.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : records.length - 1));
      } else if (e.key === ' ' && focusedIndex >= 0 && focusedIndex < records.length) {
        e.preventDefault();
        const target = records[focusedIndex];
        const id = activeTab === 'logins' ? (target as AppUser).id : (target as StaffMember).staff_code;
        toggleSelectRow(id);
      } else if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < records.length) {
        e.preventDefault();
        const target = records[focusedIndex];
        if (activeTab === 'logins') {
          handleOpenEditUser(target as AppUser);
        } else {
          handleOpenEditStaff(target as StaffMember);
        }
      } else if (e.key === 'Escape') {
        setSelectedIds(new Set());
        setFocusedIndex(-1);
        setActiveRowDropdownId(null);
        setIsColumnPickerOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentDisplayedRecords, focusedIndex, activeTab]);

    const densityStyles = {
    compact: { header: 'py-1.5 px-3 text-[11px]', cell: 'py-1.5 px-3 text-xs' },
    normal: { header: 'py-2.5 px-3.5 text-xs', cell: 'py-2.5 px-3.5 text-xs' },
    relaxed: { header: 'py-3.5 px-4 text-xs', cell: 'py-3.5 px-4 text-xs' },
  }[density];

  return (
    <div className="min-h-full flex-1 flex flex-col bg-white dark:bg-[#141414] text-slate-900 dark:text-[#EDEDED] font-sans antialiased selection:bg-[#3ecf8e]/20 selection:text-[#3ecf8e] select-none">
      {/* 1. Staff Directory Header */}
      <div className="px-4 lg:px-6 py-3.5 border-b border-slate-200 dark:border-[#282828] bg-white dark:bg-[#141414]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          {/* Left Layer: Title, Status Badges & Subtitle */}
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-medium tracking-tight text-slate-900 dark:text-[#EDEDED] font-sans flex items-center gap-2">
                <Users className="w-5 h-5 text-[#3ecf8e]" />
                <span>Staff Directory</span>
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] tabular-nums font-mono bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/20 font-medium">
                {activeTab === 'logins' ? filteredUsers.length : filteredStaff.length} accounts
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-[#888888] font-sans mt-0.5">
              Manage staff login accounts, passwords / PINs, roles, and shop floor team members.
            </p>
          </div>

          {/* Right Layer: Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setBulkImportOpen(true, 'staff')}
              className="h-8.5 px-3 py-1.5 rounded-[6px] border border-slate-200/80 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.06] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-[#EDEDED] hover:bg-black/[0.06] dark:hover:bg-white/[0.1] text-xs font-medium font-sans flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
              <span>Import CSV</span>
            </button>

            {/* Refresh */}
            <button
              type="button"
              onClick={() => {
                loadDirectory();
                refresh();
              }}
              className="h-8.5 w-8.5 flex items-center justify-center rounded-[6px] border border-slate-200/80 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.06] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-[#EDEDED] hover:bg-black/[0.06] dark:hover:bg-white/[0.1] transition-all cursor-pointer shadow-xs"
              title="Refresh Directory"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin text-[#3ecf8e]')} />
            </button>

            {/* Single Primary Emerald CTA */}
            {activeTab === 'logins' ? (
              <button
                type="button"
                onClick={handleOpenCreateUser}
                className="h-8.5 px-3.5 py-1.5 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] text-xs font-medium font-sans flex items-center gap-1.5 transition-all cursor-pointer shadow-xs select-none"
              >
                <UserPlus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Add New User</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleOpenCreateStaff}
                className="h-8.5 px-3.5 py-1.5 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] text-xs font-medium font-sans flex items-center gap-1.5 transition-all cursor-pointer shadow-xs select-none"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Add New Staff</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. Main Studio Content */}
      <main className="px-4 lg:px-6 py-4 space-y-4">
        {/* Studio Filter Controls Bar */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-slate-50 dark:bg-[#181818] p-3 rounded-[12px] border border-slate-200 dark:border-[#282828] shadow-xs">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            {/* Tabs: Cashier Logins / Floor Staff */}
            <SegmentedControl
              options={[
                { id: 'logins', label: `Login Accounts (${usersList.length})`, icon: <ShieldCheck className="w-3.5 h-3.5" /> },
                { id: 'staff', label: `All Staff (${staff.length})`, icon: <Users className="w-3.5 h-3.5" /> },
              ]}
              value={activeTab}
              onChange={(val) => setActiveTab(val as 'logins' | 'staff')}
              size="sm"
            />

            {/* Branch Filter for Staff */}
            {activeTab === 'staff' && (
              <div className="flex items-center gap-1.5 min-w-[200px]">
                <span className="text-slate-500 dark:text-[#707070] text-xs font-mono shrink-0">Branch:</span>
                <div className="flex-1 min-w-[160px]">
                  <SearchableSelect
                    size="sm"
                    options={[
                      ...(canViewAll ? [{ value: 'ALL', label: 'All Branches' }] : []),
                      ...allowedBranches.map((b) => ({
                        value: b.branch_id,
                        label: b.branch_code,
                        sublabel: b.branch_name.replace(/^Asopalav\s*-\s*/i, ''),
                      })),
                    ]}
                    value={staffBranchFilter}
                    onChange={setStaffBranchFilter}
                    placeholder="All Branches"
                    searchPlaceholder="Search branch..."
                    allowCustom={false}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Search and Column Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Box */}
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-[#707070]" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${activeTab === 'logins' ? 'logins' : 'staff'}...`}
                className="w-full h-10 min-h-[40px] pl-9 pr-12 rounded-[6px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] text-xs text-slate-900 dark:text-[#EDEDED] placeholder-slate-400 dark:placeholder-[#606060] focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 font-mono transition-colors shadow-2xs"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#707070] hover:text-slate-900 dark:hover:text-[#EDEDED] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : null}
            </div>

            {/* Density Controls */}
            <div className="hidden sm:inline-flex rounded-[6px] p-0.5 bg-slate-100 dark:bg-[#141414] border border-slate-200 dark:border-[#262626]">
              {(['compact', 'normal', 'relaxed'] as TableDensity[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDensity(d)}
                  title={`Density: ${d}`}
                  className={cn(
                    'px-2 py-1 rounded-[4px] text-[10px] font-mono capitalize transition-all cursor-pointer',
                    density === d
                      ? 'bg-white dark:bg-[#282828] text-slate-900 dark:text-white font-medium border border-slate-200 dark:border-[#383838] shadow-xs'
                      : 'text-slate-500 dark:text-[#707070] hover:text-slate-900 dark:hover:text-[#EDEDED]'
                  )}
                >
                  {d[0].toUpperCase()}
                </button>
              ))}
            </div>

            {/* Column Picker Popover */}
            <div className="hidden sm:block relative" ref={columnPickerRef}>
              <button
                type="button"
                onClick={() => setIsColumnPickerOpen(!isColumnPickerOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] bg-white dark:bg-[#141414] hover:bg-slate-100 dark:hover:bg-[#202020] text-xs font-medium text-slate-600 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-[#EDEDED] border border-slate-200 dark:border-[#262626] transition-colors cursor-pointer font-mono"
                title="Toggle Columns"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 dark:text-[#707070]" />
                <span>Columns</span>
              </button>

              {isColumnPickerOpen && (
                <div className="absolute right-0 mt-1.5 w-52 rounded-[8px] bg-white dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#262626] shadow-2xl p-2 z-40 space-y-1 text-xs font-mono">
                  <div className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-[#707070] px-2 py-1">
                    Visible Columns
                  </div>
                  {activeTab === 'logins'
                    ? USER_COLUMNS.map((col) => (
                        <label
                          key={col.key}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-[#222222] cursor-pointer select-none text-slate-900 dark:text-[#EDEDED]"
                        >
                          <input
                            type="checkbox"
                            checked={visibleUserCols.has(col.key)}
                            onChange={() => {
                              setVisibleUserCols((prev) => {
                                const next = new Set(prev);
                                if (next.has(col.key)) {
                                  if (next.size > 1) next.delete(col.key);
                                } else {
                                  next.add(col.key);
                                }
                                return next;
                              });
                            }}
                            className="rounded accent-[#3ecf8e] cursor-pointer"
                          />
                          <span>{col.label}</span>
                        </label>
                      ))
                    : STAFF_COLUMNS.map((col) => (
                        <label
                          key={col.key}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-[#222222] cursor-pointer select-none text-slate-900 dark:text-[#EDEDED]"
                        >
                          <input
                            type="checkbox"
                            checked={visibleStaffCols.has(col.key)}
                            onChange={() => {
                              setVisibleStaffCols((prev) => {
                                const next = new Set(prev);
                                if (next.has(col.key)) {
                                  if (next.size > 1) next.delete(col.key);
                                } else {
                                  next.add(col.key);
                                }
                                return next;
                              });
                            }}
                            className="rounded accent-[#3ecf8e] cursor-pointer"
                          />
                          <span>{col.label}</span>
                        </label>
                      ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 3. Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {activeTab === 'logins' ? (
            <>
              <div className="rounded-[12px] border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#171717] p-3.5 space-y-1 shadow-xs">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-[#707070]">Total Accounts</div>
                <div className="text-2xl font-mono tabular-nums font-medium text-slate-900 dark:text-white">{usersList.length}</div>
                <div className="text-[11px] font-mono text-emerald-600 dark:text-[#3ecf8e]">
                  Active system logins
                </div>
              </div>
              <div className="rounded-[12px] border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#171717] p-3.5 space-y-1 shadow-xs">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-[#707070]">Super Admins</div>
                <div className="text-2xl font-mono tabular-nums font-medium text-slate-900 dark:text-white">
                  {usersList.filter((u) => u.role_code === 'Super_Admin').length}
                </div>
                <div className="text-[11px] font-mono text-slate-500 dark:text-[#A1A1A1]">
                  Full access administrators
                </div>
              </div>
              <div className="rounded-[12px] border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#171717] p-3.5 space-y-1 shadow-xs">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-[#707070]">Cashiers & Managers</div>
                <div className="text-2xl font-mono tabular-nums font-medium text-slate-900 dark:text-white">
                  {usersList.filter((u) => u.role_code !== 'Super_Admin').length}
                </div>
                <div className="text-[11px] font-mono text-emerald-600 dark:text-[#3ecf8e]">
                  Showroom counter users
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-[12px] border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#171717] p-3.5 space-y-1 shadow-xs">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-[#707070]">Total Staff</div>
                <div className="text-2xl font-mono tabular-nums font-medium text-slate-900 dark:text-white">{staff.length}</div>
                <div className="text-[11px] font-mono text-emerald-600 dark:text-[#3ecf8e]">
                  Showroom team members
                </div>
              </div>
              <div className="rounded-[12px] border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#171717] p-3.5 space-y-1 shadow-xs">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-[#707070]">Matching Staff</div>
                <div className="text-2xl font-mono tabular-nums font-medium text-slate-900 dark:text-white">{filteredStaff.length}</div>
                <div className="text-[11px] font-mono text-slate-500 dark:text-[#A1A1A1]">
                  Showing {filteredStaff.length} of {staff.length} members
                </div>
              </div>
              <div className="rounded-[12px] border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#171717] p-3.5 space-y-1 shadow-xs">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-[#707070]">Branches</div>
                <div className="text-2xl font-mono tabular-nums font-medium text-slate-900 dark:text-white">{branches.length}</div>
                <div className="text-[11px] font-mono text-emerald-600 dark:text-[#3ecf8e]">
                  Showroom locations
                </div>
              </div>
            </>
          )}
        </div>

        {/* 4. Data Grid Container */}
        {activeTab === 'logins' ? (
          <div className="rounded-[12px] border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#141414] overflow-hidden shadow-xs">
            {/* Mobile Logins Cards (< lg) */}
            <div className="lg:hidden divide-y divide-slate-100 dark:divide-[#1f1f1f] p-3 space-y-3">
              {paginatedUsers.map((u) => {
                const isSelected = selectedIds.has(u.id);
                return (
                  <div
                    key={u.id}
                    className={cn(
                      "p-3.5 rounded-[10px] border transition-all space-y-2.5",
                      isSelected
                        ? "bg-[#3ecf8e]/10 border-[#3ecf8e]/40 ring-1 ring-[#3ecf8e]/20"
                        : "bg-slate-50 dark:bg-[#171717] border-slate-200 dark:border-[#242424]"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <UserAvatar
                          src={u.avatar_url}
                          firstName={u.first_name}
                          lastName={u.last_name}
                          name={u.username}
                          size={32}
                          shape="square"
                          className="border border-slate-300 dark:border-[#2e2e2e] shrink-0"
                        />
                        <div>
                          <h4 className="text-xs font-semibold text-slate-900 dark:text-white">
                            {u.first_name} {u.last_name}
                          </h4>
                          <span className="text-[11px] font-mono text-slate-500 dark:text-[#707070]">
                            @{u.username}
                          </span>
                        </div>
                      </div>

                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-[4px] text-[10px] font-mono font-medium border',
                          u.is_active !== false
                            ? 'bg-emerald-50 dark:bg-[#3ecf8e]/10 text-emerald-700 dark:text-[#3ecf8e] border-emerald-200 dark:border-[#3ecf8e]/20'
                            : 'bg-slate-100 dark:bg-[#252525] text-slate-500 dark:text-zinc-400 border-slate-200 dark:border-[#333]'
                        )}
                      >
                        {u.is_active !== false ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="px-2 py-0.5 rounded-[4px] bg-slate-100 dark:bg-[#222222] text-slate-600 dark:text-[#A1A1A1] border border-slate-200 dark:border-[#2e2e2e] font-mono font-medium">
                        {u.role_code}
                      </span>
                      <span className="text-slate-500 dark:text-[#707070] font-sans">
                        {getBranchDisplay(u.assigned_branches)}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-slate-200 dark:border-[#1f1f1f] flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => toggleSelectRow(u.id)}
                        className="text-xs font-medium text-slate-500 dark:text-[#707070] hover:text-slate-900 dark:hover:text-white flex items-center gap-1 cursor-pointer"
                      >
                        {isSelected ? <CheckSquare className="w-4 h-4 text-[#3ecf8e]" /> : <Square className="w-4 h-4" />}
                        <span>Select</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenEditUser(u)}
                        className="h-7 px-3 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#1a1a1a] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-[#222222] text-xs font-medium font-sans flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-emerald-600 dark:text-[#3ecf8e]" />
                        <span>Edit User</span>
                      </button>
                    </div>
                  </div>
                );
              })}

              {paginatedUsers.length === 0 && (
                <EmptyState
                  icon={Shield}
                  title="No user accounts found"
                  description={search ? `No accounts matching "${search}".` : 'No accounts created yet.'}
                  actionLabel="Add Cashier Login"
                  onAction={handleOpenCreateUser}
                  className="py-8"
                />
              )}
            </div>

            {/* Desktop Table (lg+) */}
            <div className="hidden lg:block overflow-x-auto min-h-[320px]">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-[#171717] border-b border-slate-200 dark:border-[#242424] text-slate-500 dark:text-[#707070] font-mono select-none">
                    {/* Select All Checkbox */}
                    <th className={cn("w-10 border-r border-slate-200 dark:border-[#242424] text-center", densityStyles.header)}>
                      <button
                        type="button"
                        onClick={toggleSelectAllPage}
                        className="text-slate-400 dark:text-[#707070] hover:text-[#3ecf8e] transition-colors cursor-pointer"
                        title={allPageSelected ? 'Deselect Page' : 'Select Page'}
                      >
                        {allPageSelected ? (
                          <CheckSquare className="w-4 h-4 text-[#3ecf8e]" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </th>

                    {visibleUserCols.has('username') && (
                      <th
                        onClick={() => {
                          if (userSortField === 'username') setUserSortOrder(userSortOrder === 'asc' ? 'desc' : 'asc');
                          else { setUserSortField('username'); setUserSortOrder('asc'); }
                        }}
                        className={cn("border-r border-slate-200 dark:border-[#242424] cursor-pointer hover:bg-slate-100 dark:hover:bg-[#202020] transition-colors", densityStyles.header)}
                      >
                        <div className="flex items-center gap-1.5">
                          <span>Username</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400 dark:text-[#707070] opacity-60 ml-auto" />
                        </div>
                      </th>
                    )}

                    {visibleUserCols.has('staff_code') && (
                      <th className={cn("border-r border-slate-200 dark:border-[#242424]", densityStyles.header)}>
                        <div className="flex items-center gap-1.5">
                          <span>Linked Staff</span>
                        </div>
                      </th>
                    )}

                    {visibleUserCols.has('name') && (
                      <th
                        onClick={() => {
                          if (userSortField === 'name') setUserSortOrder(userSortOrder === 'asc' ? 'desc' : 'asc');
                          else { setUserSortField('name'); setUserSortOrder('asc'); }
                        }}
                        className={cn("border-r border-slate-200 dark:border-[#242424] cursor-pointer hover:bg-slate-100 dark:hover:bg-[#202020] transition-colors", densityStyles.header)}
                      >
                        <div className="flex items-center gap-1.5">
                          <span>Full Name</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400 dark:text-[#707070] opacity-60 ml-auto" />
                        </div>
                      </th>
                    )}

                    {visibleUserCols.has('role') && (
                      <th
                        onClick={() => {
                          if (userSortField === 'role') setUserSortOrder(userSortOrder === 'asc' ? 'desc' : 'asc');
                          else { setUserSortField('role'); setUserSortOrder('asc'); }
                        }}
                        className={cn("border-r border-slate-200 dark:border-[#242424] cursor-pointer hover:bg-slate-100 dark:hover:bg-[#202020] transition-colors", densityStyles.header)}
                      >
                        <div className="flex items-center gap-1.5">
                          <span>Role</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400 dark:text-[#707070] opacity-60 ml-auto" />
                        </div>
                      </th>
                    )}

                    {visibleUserCols.has('branches') && (
                      <th className={cn("border-r border-slate-200 dark:border-[#242424]", densityStyles.header)}>
                        <div className="flex items-center gap-1.5">
                          <span>Branch Access</span>
                        </div>
                      </th>
                    )}

                    {visibleUserCols.has('status') && (
                      <th
                        onClick={() => {
                          if (userSortField === 'status') setUserSortOrder(userSortOrder === 'asc' ? 'desc' : 'asc');
                          else { setUserSortField('status'); setUserSortOrder('asc'); }
                        }}
                        className={cn("border-r border-slate-200 dark:border-[#242424] text-center cursor-pointer hover:bg-slate-100 dark:hover:bg-[#202020] transition-colors", densityStyles.header)}
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          <span>Status</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400 dark:text-[#707070] opacity-60" />
                        </div>
                      </th>
                    )}

                    {visibleUserCols.has('actions') && (
                      <th className={cn("text-right", densityStyles.header)}>
                        <div className="flex items-center justify-end gap-1.5">
                          <span>Actions</span>
                        </div>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#1f1f1f] font-mono">
                  {paginatedUsers.map((u, idx) => {
                    const isSelected = selectedIds.has(u.id);
                    const isFocused = focusedIndex === idx;

                    return (
                      <tr
                        key={u.id}
                        onClick={() => setFocusedIndex(idx)}
                        onDoubleClick={() => handleOpenEditUser(u)}
                        className={cn(
                          "transition-colors group",
                          isSelected ? "bg-emerald-50 dark:bg-[#3ecf8e]/10" : isFocused ? "bg-slate-100 dark:bg-[#242424]" : "hover:bg-slate-50/80 dark:hover:bg-[#1a1a1a]"
                        )}
                      >
                        {/* Checkbox */}
                        <td className={cn("border-r border-slate-100 dark:border-[#1f1f1f] text-center", densityStyles.cell)}>
                          <button
                            type="button"
                            onClick={(e) => toggleSelectRow(u.id, e)}
                            className="text-slate-400 dark:text-[#707070] hover:text-[#3ecf8e] transition-colors cursor-pointer"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-[#3ecf8e]" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        </td>

                        {visibleUserCols.has('username') && (
                          <td className={cn("border-r border-slate-100 dark:border-[#1f1f1f] font-mono text-slate-900 dark:text-white font-medium", densityStyles.cell)}>
                            <div className="flex items-center gap-1.5">
                              <span className="text-emerald-600 dark:text-[#3ecf8e]">@{u.username}</span>
                            </div>
                          </td>
                        )}

                        {visibleUserCols.has('staff_code') && (
                          <td className={cn("border-r border-slate-100 dark:border-[#1f1f1f] font-mono text-[11px]", densityStyles.cell)}>
                            {u.staff_code ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-500/20 text-[10px]">
                                <UserCheck className="w-3 h-3" />
                                {u.staff_code}
                              </span>
                            ) : (
                              <span className="text-slate-400 dark:text-[#666] text-[10px] italic">Master / HQ</span>
                            )}
                          </td>
                        )}

                        {visibleUserCols.has('name') && (
                          <td className={cn("border-r border-slate-100 dark:border-[#1f1f1f] text-slate-900 dark:text-[#EDEDED]", densityStyles.cell)}>
                            {u.first_name} {u.last_name}
                          </td>
                        )}

                        {visibleUserCols.has('role') && (
                          <td className={cn("border-r border-slate-100 dark:border-[#1f1f1f] font-mono text-[11px]", densityStyles.cell)}>
                            <span className="px-2 py-0.5 rounded-[4px] bg-slate-100 dark:bg-[#222222] text-slate-700 dark:text-[#A1A1A1] border border-slate-200 dark:border-[#2e2e2e]">
                              {u.role_code}
                            </span>
                          </td>
                        )}

                        {visibleUserCols.has('branches') && (
                          <td className={cn("border-r border-slate-100 dark:border-[#1f1f1f] text-slate-600 dark:text-[#A1A1A1] text-xs", densityStyles.cell)}>
                            {getBranchDisplay(u.assigned_branches)}
                          </td>
                        )}

                        {visibleUserCols.has('status') && (
                          <td className={cn("border-r border-slate-100 dark:border-[#1f1f1f] text-center font-mono", densityStyles.cell)}>
                            <span
                              className={cn(
                                'inline-flex items-center px-2 py-0.5 rounded-[4px] text-[10px] font-medium border',
                                u.is_active !== false
                                  ? 'bg-emerald-50 dark:bg-[#3ecf8e]/10 text-emerald-700 dark:text-[#3ecf8e] border-emerald-200 dark:border-[#3ecf8e]/20'
                                  : 'bg-slate-100 dark:bg-[#252525] text-slate-500 dark:text-zinc-400 border-slate-200 dark:border-[#333]'
                              )}
                            >
                              {u.is_active !== false ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                        )}

                        {visibleUserCols.has('actions') && (
                          <td className={cn("text-right relative", densityStyles.cell)}>
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenResetPassword(u)}
                                className="px-2.5 py-1 rounded-[6px] border border-amber-300/80 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-xs font-mono transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                                title={`Reset Password & PIN for @${u.username}`}
                              >
                                <Key className="w-3 h-3 text-amber-600 dark:text-amber-400 stroke-[2.5]" />
                                <span>Reset Pass</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleOpenEditUser(u)}
                                className="px-2.5 py-1 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#1a1a1a] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-[#222222] text-xs font-mono transition-colors cursor-pointer"
                              >
                                Edit
                              </button>

                              {/* Context Popover */}
                              <div className="relative" data-dropdown-id={`user-menu-${u.id}`}>
                                <button
                                  type="button"
                                  onClick={() => setActiveRowDropdownId(activeRowDropdownId === `user-menu-${u.id}` ? null : `user-menu-${u.id}`)}
                                  className="p-1 rounded-[4px] hover:bg-slate-100 dark:hover:bg-[#282828] text-slate-400 dark:text-[#707070] hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                  title="Tools"
                                >
                                  <MoreVertical className="w-3.5 h-3.5" />
                                </button>

                                {activeRowDropdownId === `user-menu-${u.id}` && (
                                  <div
                                    className={cn(
                                      "absolute right-0 w-48 rounded-[8px] bg-white dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#262626] shadow-2xl p-1.5 z-40 space-y-1 text-xs font-mono text-left",
                                      idx >= Math.max(1, paginatedUsers.length - 2) ? 'bottom-8' : 'top-8'
                                    )}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => handleOpenResetPassword(u)}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-amber-50 dark:hover:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                                    >
                                      <Key className="w-3.5 h-3.5 text-amber-500" />
                                      <span>Reset Password & PIN</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}

                  {paginatedUsers.length === 0 && (
                    <tr>
                      <td colSpan={visibleUserCols.size + 1} className="p-0 border-none">
                        <EmptyState
                          icon={Shield}
                          title="No user accounts found"
                          description={
                            search
                              ? `No user login accounts matching "${search}".`
                              : 'No user accounts created yet.'
                          }
                          actionLabel="Add Cashier Login"
                          onAction={handleOpenCreateUser}
                          secondaryActionLabel={search ? 'Clear Search' : undefined}
                          onSecondaryAction={search ? () => setSearch('') : undefined}
                          className="py-12"
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* Floor Staff Table & Mobile Cards */
          <div className="rounded-[12px] border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#141414] overflow-hidden shadow-xs">
            {/* Mobile Staff Cards (< lg) */}
            <div className="lg:hidden divide-y divide-slate-100 dark:divide-[#1f1f1f] p-3 space-y-2.5">
              {paginatedStaff.map((s) => {
                const isSelected = selectedIds.has(s.staff_code);
                const initials = `${s.first_name?.[0] || ''}${s.last_name?.[0] || ''}`.toUpperCase() || 'ST';
                return (
                  <div
                    key={s.staff_code}
                    className={cn(
                      "p-3.5 rounded-[12px] border transition-all space-y-3",
                      isSelected
                        ? "bg-[#3ecf8e]/10 border-[#3ecf8e]/40 ring-1 ring-[#3ecf8e]/20"
                        : "bg-slate-50 dark:bg-[#171717] border-slate-200 dark:border-[#242424]"
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative shrink-0">
                          <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-[#242424] text-emerald-700 dark:text-[#3ecf8e] border border-slate-300 dark:border-[#333] font-mono font-bold text-xs flex items-center justify-center">
                            {initials}
                          </div>
                          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#3ecf8e] border-2 border-white dark:border-[#171717]" />
                        </div>

                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h4 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                              {s.first_name} {s.middle_name || ''} {s.last_name}
                            </h4>
                            <span className="px-1.5 py-0.2 rounded-[4px] bg-slate-200 dark:bg-[#242424] text-slate-800 dark:text-[#EDEDED] border border-slate-300 dark:border-[#2e2e2e] font-mono text-[10px]">
                              {s.staff_code}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-[#707070] font-sans">
                            <span className="truncate">{s.designation || '—'}</span>
                            <span>•</span>
                            <span className="truncate">{s.department_name || '—'}</span>
                          </div>
                        </div>
                      </div>

                      <span className="px-2 py-0.5 rounded-[4px] bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-[10px] font-mono font-bold shrink-0">
                        {s.branch_code}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-slate-200 dark:border-[#1f1f1f] flex items-center justify-between gap-2">
                      {s.mobile_number ? (
                        <a
                          href={`tel:${s.mobile_number}`}
                          className="h-7 px-2.5 rounded-[6px] bg-emerald-50 dark:bg-[#3ecf8e]/10 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-200 dark:border-[#3ecf8e]/25 text-xs font-mono flex items-center gap-1.5"
                        >
                          <Phone className="w-3 h-3" />
                          <span>{formatIndianPhone(s.mobile_number)}</span>
                        </a>
                      ) : (
                        <span className="text-[11px] text-slate-400 dark:text-[#606060] font-mono italic">No phone</span>
                      )}

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleSelectRow(s.staff_code)}
                          className="p-1.5 text-slate-400 dark:text-[#707070] hover:text-[#3ecf8e] transition-colors cursor-pointer"
                          title={isSelected ? 'Deselect' : 'Select'}
                        >
                          {isSelected ? <CheckSquare className="w-4 h-4 text-[#3ecf8e]" /> : <Square className="w-4 h-4" />}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleOpenEditStaff(s)}
                          className="h-7 px-3 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#1a1a1a] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-white text-xs font-medium font-sans flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5 text-emerald-600 dark:text-[#3ecf8e]" />
                          <span>Edit</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {paginatedStaff.length === 0 && (
                <EmptyState
                  icon={Users}
                  title="No staff members found"
                  description={search || staffBranchFilter !== 'ALL' ? 'No staff matching active filters.' : 'No staff created yet.'}
                  actionLabel="Add Team Member"
                  onAction={handleOpenCreateStaff}
                  className="py-8"
                />
              )}
            </div>

            {/* Desktop Staff Table (lg+) */}
            <div className="hidden lg:block overflow-x-auto min-h-[320px]">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-[#171717] border-b border-slate-200 dark:border-[#242424] text-slate-500 dark:text-[#707070] font-mono select-none">
                    {/* Select All Checkbox */}
                    <th className={cn("w-10 border-r border-slate-200 dark:border-[#242424] text-center", densityStyles.header)}>
                      <button
                        type="button"
                        onClick={toggleSelectAllPage}
                        className="text-slate-400 dark:text-[#707070] hover:text-[#3ecf8e] transition-colors cursor-pointer"
                        title={allPageSelected ? 'Deselect Page' : 'Select Page'}
                      >
                        {allPageSelected ? (
                          <CheckSquare className="w-4 h-4 text-[#3ecf8e]" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </th>

                    {visibleStaffCols.has('code') && (
                      <th
                        onClick={() => {
                          if (staffSortField === 'code') setStaffSortOrder(staffSortOrder === 'asc' ? 'desc' : 'asc');
                          else { setStaffSortField('code'); setStaffSortOrder('asc'); }
                        }}
                        className={cn("border-r border-slate-200 dark:border-[#242424] cursor-pointer hover:bg-slate-100 dark:hover:bg-[#202020] transition-colors min-w-[100px]", densityStyles.header)}
                      >
                        <div className="flex items-center gap-1.5">
                          <span>Staff ID</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400 dark:text-[#707070] opacity-60 ml-auto" />
                        </div>
                      </th>
                    )}

                    {visibleStaffCols.has('name') && (
                      <th
                        onClick={() => {
                          if (staffSortField === 'name') setStaffSortOrder(staffSortOrder === 'asc' ? 'desc' : 'asc');
                          else { setStaffSortField('name'); setStaffSortOrder('asc'); }
                        }}
                        className={cn("border-r border-slate-200 dark:border-[#242424] cursor-pointer hover:bg-slate-100 dark:hover:bg-[#202020] transition-colors min-w-[170px]", densityStyles.header)}
                      >
                        <div className="flex items-center gap-1.5">
                          <span>Full Name</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400 dark:text-[#707070] opacity-60 ml-auto" />
                        </div>
                      </th>
                    )}

                    {visibleStaffCols.has('login_access') && (
                      <th className={cn("border-r border-slate-200 dark:border-[#242424] min-w-[150px]", densityStyles.header)}>
                        <div className="flex items-center gap-1.5">
                          <span>Login Access</span>
                        </div>
                      </th>
                    )}

                    {visibleStaffCols.has('department') && (
                      <th
                        onClick={() => {
                          if (staffSortField === 'department') setStaffSortOrder(staffSortOrder === 'asc' ? 'desc' : 'asc');
                          else { setStaffSortField('department'); setStaffSortOrder('asc'); }
                        }}
                        className={cn("border-r border-slate-200 dark:border-[#242424] cursor-pointer hover:bg-slate-100 dark:hover:bg-[#202020] transition-colors min-w-[140px]", densityStyles.header)}
                      >
                        <div className="flex items-center gap-1.5">
                          <span>Department</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400 dark:text-[#707070] opacity-60 ml-auto" />
                        </div>
                      </th>
                    )}

                    {visibleStaffCols.has('branch') && (
                      <th
                        onClick={() => {
                          if (staffSortField === 'branch') setStaffSortOrder(staffSortOrder === 'asc' ? 'desc' : 'asc');
                          else { setStaffSortField('branch'); setStaffSortOrder('asc'); }
                        }}
                        className={cn("border-r border-slate-200 dark:border-[#242424] cursor-pointer hover:bg-slate-100 dark:hover:bg-[#202020] transition-colors min-w-[80px]", densityStyles.header)}
                      >
                        <div className="flex items-center gap-1.5">
                          <span>Branch</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400 dark:text-[#707070] opacity-60 ml-auto" />
                        </div>
                      </th>
                    )}

                    {visibleStaffCols.has('mobile') && (
                      <th className={cn("border-r border-slate-200 dark:border-[#242424] min-w-[120px]", densityStyles.header)}>
                        <div className="flex items-center gap-1.5">
                          <span>Phone</span>
                        </div>
                      </th>
                    )}

                    {visibleStaffCols.has('designation') && (
                      <th
                        onClick={() => {
                          if (staffSortField === 'designation') setStaffSortOrder(staffSortOrder === 'asc' ? 'desc' : 'asc');
                          else { setStaffSortField('designation'); setStaffSortOrder('asc'); }
                        }}
                        className={cn("border-r border-slate-200 dark:border-[#242424] text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-[#202020] transition-colors min-w-[110px]", densityStyles.header)}
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <span>Designation</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400 dark:text-[#707070] opacity-60 ml-auto" />
                        </div>
                      </th>
                    )}

                    {visibleStaffCols.has('actions') && (
                      <th className={cn("text-right min-w-[90px]", densityStyles.header)}>
                        <div className="flex items-center justify-end gap-1.5">
                          <span>Actions</span>
                        </div>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#1f1f1f] font-mono">
                  {paginatedStaff.map((s, idx) => {
                    const isSelected = selectedIds.has(s.staff_code);
                    const isFocused = focusedIndex === idx;

                    return (
                      <tr
                        key={s.staff_code}
                        onClick={() => setFocusedIndex(idx)}
                        onDoubleClick={() => handleOpenEditStaff(s)}
                        className={cn(
                          "transition-colors group",
                          isSelected ? "bg-emerald-50 dark:bg-[#3ecf8e]/10" : isFocused ? "bg-slate-100 dark:bg-[#242424]" : "hover:bg-slate-50/80 dark:hover:bg-[#1a1a1a]"
                        )}
                      >
                        {/* Checkbox */}
                        <td className={cn("border-r border-slate-100 dark:border-[#1f1f1f] text-center", densityStyles.cell)}>
                          <button
                            type="button"
                            onClick={(e) => toggleSelectRow(s.staff_code, e)}
                            className="text-slate-400 dark:text-[#707070] hover:text-[#3ecf8e] transition-colors cursor-pointer"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-[#3ecf8e]" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        </td>

                        {visibleStaffCols.has('code') && (
                          <td className={cn("border-r border-slate-100 dark:border-[#1f1f1f] font-mono text-slate-900 dark:text-white font-medium", densityStyles.cell)}>
                            {s.staff_code}
                          </td>
                        )}

                        {visibleStaffCols.has('name') && (
                          <td className={cn("border-r border-slate-100 dark:border-[#1f1f1f] text-slate-900 dark:text-[#EDEDED]", densityStyles.cell)}>
                            {s.first_name} {s.last_name}
                          </td>
                        )}

                        {visibleStaffCols.has('login_access') && (
                          <td className={cn("border-r border-slate-100 dark:border-[#1f1f1f] font-mono", densityStyles.cell)}>
                            {(() => {
                              const linkedUser = userMapByStaffCode.get(s.staff_code);
                              if (linkedUser) {
                                if (linkedUser.is_active && s.is_active) {
                                  return (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[10px] bg-emerald-50 dark:bg-[#3ecf8e]/10 text-emerald-700 dark:text-[#3ecf8e] border border-emerald-200 dark:border-[#3ecf8e]/20">
                                      <Key className="w-3 h-3" />
                                      <span>@{linkedUser.username}</span>
                                    </span>
                                  );
                                } else {
                                  return (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[10px] bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20">
                                      <Lock className="w-3 h-3" />
                                      <span>Access Revoked</span>
                                    </span>
                                  );
                                }
                              }
                              return (
                                <button
                                  type="button"
                                  onClick={() => handleGrantLoginForStaff(s)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[10px] bg-slate-100 dark:bg-[#202020] text-slate-600 dark:text-[#a1a1a1] hover:text-emerald-700 dark:hover:text-[#3ecf8e] hover:bg-emerald-50 dark:hover:bg-[#3ecf8e]/10 border border-slate-200 dark:border-[#2e2e2e] transition-colors cursor-pointer"
                                >
                                  <Plus className="w-3 h-3" />
                                  <span>Grant Login</span>
                                </button>
                              );
                            })()}
                          </td>
                        )}

                        {visibleStaffCols.has('department') && (
                          <td className={cn("border-r border-slate-100 dark:border-[#1f1f1f] text-slate-600 dark:text-[#A1A1A1]", densityStyles.cell)}>
                            {s.department_name || '—'}
                          </td>
                        )}

                        {visibleStaffCols.has('branch') && (
                          <td className={cn("border-r border-slate-100 dark:border-[#1f1f1f] font-mono", densityStyles.cell)}>
                            <span className="px-1.5 py-0.5 rounded-[4px] bg-slate-100 dark:bg-[#222222] text-slate-700 dark:text-[#A1A1A1] border border-slate-200 dark:border-[#2e2e2e] text-[10px]">
                              {s.branch_code}
                            </span>
                          </td>
                        )}

                        {visibleStaffCols.has('mobile') && (
                          <td className={cn("border-r border-slate-100 dark:border-[#1f1f1f] font-mono text-slate-600 dark:text-[#A1A1A1]", densityStyles.cell)}>
                            {formatIndianPhone(s.mobile_number)}
                          </td>
                        )}

                        {visibleStaffCols.has('designation') && (
                          <td className={cn("border-r border-slate-100 dark:border-[#1f1f1f] text-right font-mono text-slate-900 dark:text-white", densityStyles.cell)}>
                            {s.designation || '—'}
                          </td>
                        )}

                        {visibleStaffCols.has('actions') && (
                          <td className={cn("text-right relative", densityStyles.cell)}>
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenEditStaff(s)}
                                className="px-2.5 py-1 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#1a1a1a] text-slate-700 dark:text-[#A1A1A1] hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-[#222222] text-xs font-mono transition-colors cursor-pointer"
                              >
                                Edit
                              </button>

                              {/* Developer Context Popover */}
                              <div className="relative" data-dropdown-id={`staff-menu-${s.staff_code}`}>
                                <button
                                  type="button"
                                  onClick={() => setActiveRowDropdownId(activeRowDropdownId === `staff-menu-${s.staff_code}` ? null : `staff-menu-${s.staff_code}`)}
                                  className="p-1 rounded-[4px] hover:bg-slate-100 dark:hover:bg-[#282828] text-slate-400 dark:text-[#707070] hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                  title="Tools"
                                >
                                  <MoreVertical className="w-3.5 h-3.5" />
                                </button>

                                {activeRowDropdownId === `staff-menu-${s.staff_code}` && (
                                  <div
                                    className={cn(
                                      "absolute right-0 w-48 rounded-[8px] bg-white dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#262626] shadow-2xl p-1.5 z-40 space-y-1 text-xs font-mono text-left",
                                      idx >= Math.max(1, paginatedStaff.length - 2) ? 'bottom-8' : 'top-8'
                                    )}
                                  >
                                    {(() => {
                                      const matchedUser = userMapByStaffCode.get(s.staff_code);
                                      if (!matchedUser) {
                                        return (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              handleGrantLoginForStaff(s);
                                              setActiveRowDropdownId(null);
                                            }}
                                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-emerald-50 dark:hover:bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e]"
                                          >
                                            <Key className="w-3.5 h-3.5" />
                                            <span>+ Grant Login Access</span>
                                          </button>
                                        );
                                      } else if (matchedUser.is_active) {
                                        return (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              handleRevokeLoginAccess(matchedUser);
                                              setActiveRowDropdownId(null);
                                            }}
                                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-rose-50 dark:hover:bg-rose-500/10 text-rose-600 dark:text-rose-400"
                                          >
                                            <Lock className="w-3.5 h-3.5" />
                                            <span>Cut / Revoke Login</span>
                                          </button>
                                        );
                                      } else {
                                        return (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              handleOpenEditUser(matchedUser);
                                              setActiveRowDropdownId(null);
                                            }}
                                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-emerald-50 dark:hover:bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e]"
                                          >
                                            <Unlock className="w-3.5 h-3.5" />
                                            <span>Re-enable Login</span>
                                          </button>
                                        );
                                      }
                                    })()}

                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleToggleStaffStatus(s, s.is_active);
                                        setActiveRowDropdownId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-amber-50 dark:hover:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-t border-slate-100 dark:border-[#242424] pt-1.5"
                                    >
                                      {s.is_active ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                                      <span>{s.is_active ? 'Mark Resigned / Left' : 'Reactivate Staff'}</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}

                  {paginatedStaff.length === 0 && (
                    <tr>
                      <td colSpan={visibleStaffCols.size + 1} className="p-0 border-none">
                        <EmptyState
                          icon={Users}
                          title="No showroom staff members found"
                          description={
                            search || staffBranchFilter !== 'ALL'
                              ? `No showroom staff members matching your active filters or search.`
                              : 'No showroom staff members registered for this branch yet.'
                          }
                          actionLabel="Add Staff Member"
                          onAction={handleOpenCreateStaff}
                          secondaryActionLabel={search || staffBranchFilter !== 'ALL' ? 'Reset Filters' : undefined}
                          onSecondaryAction={
                            search || staffBranchFilter !== 'ALL'
                              ? () => {
                                  setSearch('');
                                  setStaffBranchFilter('ALL');
                                }
                              : undefined
                          }
                          className="py-12"
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Floating Batch Actions Dock (When Rows Selected) */}
        {selectedIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 px-4 py-2.5 rounded-[12px] bg-white dark:bg-[#1a1a1a] text-slate-900 dark:text-white shadow-2xl border border-slate-200 dark:border-[#2e2e2e] flex items-center gap-3 animate-in fade-in slide-in-from-bottom-3 duration-200">
            <div className="flex items-center gap-2 pr-3">
              <span className="w-2 h-2 rounded-full bg-[#3ecf8e] animate-pulse" />
              <span className="font-mono font-semibold text-xs tabular-nums text-slate-900 dark:text-white">
                {selectedIds.size} Selected
              </span>
            </div>

            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="p-1 rounded-[4px] hover:bg-slate-100 dark:hover:bg-[#282828] text-slate-400 dark:text-[#707070] hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
              title="Deselect all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Pro Enterprise Pagination Footer */}
        <div className="bg-slate-50 dark:bg-[#171717] border border-slate-200 dark:border-[#242424] rounded-[12px] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono shadow-xs">
          <div className="flex flex-wrap items-center gap-4 text-slate-500 dark:text-[#707070] font-mono text-xs">
            <span>
              Showing <strong className="text-slate-900 dark:text-white">{currentRecordsCount > 0 ? (currentPage - 1) * pageSize + 1 : 0}</strong> to{' '}
              <strong className="text-slate-900 dark:text-white">{Math.min(currentPage * pageSize, currentRecordsCount)}</strong> of{' '}
              <strong className="text-slate-900 dark:text-white">{currentRecordsCount}</strong> records
            </span>

            <div className="flex items-center gap-1.5 w-24">
              <span>Rows:</span>
              <div className="flex-1">
                <SearchableSelect
                  size="sm"
                  placement="top"
                  options={[
                    { value: '10', label: '10' },
                    { value: '25', label: '25' },
                    { value: '50', label: '50' },
                    { value: '100', label: '100' },
                  ]}
                  value={String(pageSize)}
                  onChange={(val) => {
                    setPageSize(Number(val));
                    setCurrentPage(1);
                  }}
                  allowCustom={false}
                  popupClassName="min-w-[76px]"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded-[4px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#262626] hover:border-[#3ecf8e] text-slate-700 dark:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 font-mono text-xs text-slate-600 dark:text-[#A1A1A1]">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded-[4px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#262626] hover:border-[#3ecf8e] text-slate-700 dark:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Master Data Slide-Over Drawer */}
        <MasterDataDrawer
          isOpen={isDrawerOpen}
          onClose={() => setIsDrawerOpen(false)}
          type={drawerType}
          record={selectedRecord}
          onSuccess={handleDrawerSuccess}
        />

        {/* Dedicated Fast Password & PIN Reset Modal */}
        <ResetUserPasswordModal
          isOpen={isResetModalOpen}
          user={resetTargetUser}
          onClose={() => {
            setIsResetModalOpen(false);
            setResetTargetUser(null);
          }}
          onSuccess={() => {
            loadDirectory();
            refresh();
          }}
        />
      </main>
    </div>
  );
};

