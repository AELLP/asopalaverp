export interface CurrencyDenomination {
  denomination_value: number;
  display_label: string;
  is_coin: boolean;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
}

export interface AccountingPeriod {
  period_key: string; // '2026-09'
  start_date: string;
  end_date: string;
  is_locked: boolean;
  locked_at?: string | null;
  locked_by_name?: string | null;
  lock_reason?: string | null;
  created_at?: string;
}

export interface Branch {
  branch_id: string; // 'Aellp-ASI'
  branch_code: string; // 'ASI'
  branch_name: string; // 'Asopalav - Satellite'
  short_name: string; // 'Satellite'
  entity_company_name: string;
  pan_number?: string | null;
  gstin?: string | null;
  accountant_name: string;
  contact_phone: string;
  contact_email: string;
  city: string;
  state: string;
  address: string;
  min_cash_threshold: number;
  max_cash_ceiling?: number;
  max_upi_ceiling?: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AppRole {
  role_code: 'Super_Admin' | 'Developer' | 'Store_Manager' | 'Cashier' | 'Auditor' | string;
  role_title: string;
  description?: string | null;
  is_system_role: boolean;
  created_at?: string;
}

export interface RolePermissions {
  role_code: string;
  can_create_voucher: boolean;
  can_void_voucher: boolean;
  can_backdate_voucher: boolean;
  can_disburse_advance: boolean;
  can_settle_advance: boolean;
  max_advance_limit: number;
  can_inject_float: boolean;
  can_verify_f9_closing: boolean;
  can_export_tally: boolean;
  can_download_hr_payroll: boolean;
  can_view_all_branches: boolean;
  can_view_audit_logs: boolean;
  can_manage_users_roles: boolean;
  can_manage_periods: boolean;
  updated_at?: string;
}

export interface AppUser {
  id: string; // 'USR-ADMIN'
  username: string; // 'aellpadmin'
  staff_code?: string | null; // Linked Staff Member ID e.g. 'ASI-001'
  first_name: string;
  last_name: string;
  email?: string | null;
  role_code: string;
  assigned_branches: string[];
  avatar_url?: string | null;
  avatar_initials?: string;
  theme_preference: 'Light' | 'Dark' | 'System';
  is_active: boolean;
  lock_pin_hash?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ExpenseCategory {
  category_name: string;
  color_theme: string;
  is_active: boolean;
  created_at?: string;
}

export interface Department {
  department_code: string;
  department_name: string;
  is_active: boolean;
  created_at?: string;
}

export interface CourierPartner {
  partner_code: string;
  partner_name: string;
  contact_phone?: string | null;
  is_active: boolean;
  created_at?: string;
}

export interface PaymentMethod {
  method_name: string;
  is_active: boolean;
  created_at?: string;
}

export interface StaffMember {
  staff_code: string; // 'ASI-001'
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  avatar_url?: string | null;
  mobile_number: string;
  branch_id: string;
  branch_code: string;
  department_code?: string | null;
  department_name?: string | null;
  designation: string;
  is_active: boolean;
  created_at?: string;
}

export interface BranchWallet {
  branch_id: string;
  cash_balance: number;
  upi_balance: number;
  updated_at?: string;
}

export interface DrawerSession {
  id: string;
  session_number: string;
  branch_id: string;
  branch_code: string;
  cashier_name: string;
  cashier_user_id?: string | null;
  opened_at: string;
  opening_cash: number;
  closed_at?: string | null;
  expected_closing?: number | null;
  actual_closing?: number | null;
  variance?: number | null;
  denominations_breakdown?: Record<string, number> | null;
  verified_by_name?: string | null;
  status: 'Open' | 'Closed' | 'Handed_Over';
  created_at?: string;
}

export interface WalletLedger {
  id: string;
  ledger_sequence: number;
  branch_id: string;
  branch_code: string;
  wallet_type: 'Cash' | 'UPI';
  transaction_type: 'Float_Topup' | 'Expense_Voucher' | 'Advance_Out' | 'Advance_Return_In' | 'Adjustment' | 'Safe_Drop';
  reference_number: string;
  debit_amount: number;
  credit_amount: number;
  running_balance: number;
  remarks?: string | null;
  cashier_name: string;
  authorized_by_name?: string | null;
  created_at: string;
}

export interface FloatAllocation {
  id: string;
  allocation_number: string;
  branch_id: string;
  branch_code: string;
  wallet_type: 'Cash' | 'UPI';
  amount: number;
  reference_notes?: string | null;
  authorized_by_name: string;
  received_by_name: string;
  status: 'Pending' | 'Verified' | 'Reversed';
  created_at: string;
}

export interface VendorSplitItem {
  vendor_name: string;
  category_name: string;
  department_name: string;
  bill_number?: string | null;
  description?: string | null;
  amount: number;
}

export interface ExpenseVoucher {
  id: string;
  voucher_number: string; // 'ASI-2026-00001'
  branch_id: string;
  branch_code: string;
  payment_date: string;
  payment_type: 'Shop_Vendor' | 'Staff_Split' | 'Courier' | 'Advance_Settlement';
  payment_method: 'Physical_Cash' | 'Online_UPI';
  bank_utr_number?: string | null;
  total_amount: number;
  recipient_name: string;
  category_name: string;
  department_name?: string | null;
  department_code?: string | null;
  courier_partner_name?: string | null;
  requested_by_staff_code?: string | null;
  requested_by_staff_name?: string | null;
  vendor_splits?: VendorSplitItem[] | null;
  remarks: string;
  bill_number?: string | null;
  bill_photo_urls: string[];
  created_by_name: string;
  is_high_value?: boolean;
  // Optional GST Breakdown for B2B Vendor Invoices
  is_gst_invoice?: boolean;
  vendor_gstin?: string | null;
  taxable_amount?: number | null;
  gst_rate?: number | null;
  cgst_amount?: number | null;
  sgst_amount?: number | null;
  igst_amount?: number | null;
  approved_by_name?: string | null;
  approved_at?: string | null;
  status: 'Approved' | 'Pending_Approval' | 'Voided';
  void_reason?: string | null;
  voided_by_name?: string | null;
  created_at: string;
}

export interface VoucherSplit {
  id: string;
  voucher_number: string;
  branch_id: string;
  branch_code: string;
  staff_code: string;
  staff_name: string;
  department_name: string;
  category_name: string;
  amount: number;
  created_at?: string;
}

export interface StaffAdvance {
  id: string;
  receipt_number: string;
  advance_date: string;
  branch_id: string;
  branch_code: string;
  staff_code: string;
  staff_name: string;
  department_name?: string | null;
  designation: string;
  payment_method: 'Physical_Cash' | 'Online_UPI';
  bank_utr_number?: string | null;
  advance_amount: number;
  purpose: string;
  signature_image_url: string;
  bills_submitted_amount: number;
  cash_returned_amount: number;
  unsettled_balance: number;
  settlement_proofs: string[];
  disbursed_by_name: string;
  status: 'Active_Unsettled' | 'Settled_Bills' | 'Settled_Cash' | 'Flagged_Salary_Deduction' | 'Cleared_Salary_Deduction';
  salary_deduction_month?: string | null;
  salary_deducted_at?: string | null;
  salary_deducted_by_name?: string | null;
  created_at: string;
  is_direct_voucher_advance?: boolean;
  source_category?: string;
}

export interface CashClosing {
  id: string;
  closing_date: string;
  branch_id: string;
  branch_code: string;
  opening_cash: number;
  cash_inflow: number;
  cash_outflow: number;
  expected_cash: number;
  actual_cash: number;
  variance: number;
  variance_disposition?: 'Cashier_Charge' | 'Expense_Writeoff' | 'Excess_Income' | 'Unresolved' | string | null;
  charge_staff_code?: string | null;
  charge_staff_name?: string | null;
  denominations_detail: string;
  denominations_breakdown: Record<string, number>;
  closing_notes?: string | null;
  cashier_name: string;
  verified_by_name: string;
  created_at: string;
}

export interface ERPNotification {
  id: string;
  title: string;
  message: string;
  type:
    | 'high_value_voucher'
    | 'safe_drop'
    | 'closing_variance'
    | 'period_lock'
    | 'approval_request'
    | 'sec40a3_warning'
    | 'offline_sync'
    | 'system';
  target_roles: string[]; // ['Store_Manager', 'Super_Admin', 'Cashier', 'Auditor']
  branch_id?: string;
  reference_id?: string;
  amount?: number;
  created_at: string;
  read_by: string[]; // list of usernames who marked as read
}

export interface SecurityAuditLog {
  id: string;
  audit_number: string;
  user_name: string;
  user_role: string;
  action_type:
    | 'Float_Topup'
    | 'Create_Voucher'
    | 'Update_Voucher'
    | 'Void_Voucher'
    | 'Delete_Voucher'
    | 'Disburse_Advance'
    | 'Settle_Advance'
    | 'Update_Advance'
    | 'Waive_Advance'
    | 'Delete_Advance'
    | 'Daily_F9_Lock'
    | 'Daily_F9_Unlock'
    | 'Update_Cash_Closing'
    | 'Salary_Deduction_Tag'
    | 'Lock_Period'
    | 'Unlock_Period'
    | 'Create_Branch'
    | 'Update_Branch'
    | 'Delete_Branch'
    | 'Create_Category'
    | 'Update_Category'
    | 'Delete_Category'
    | 'Create_Department'
    | 'Update_Department'
    | 'Delete_Department'
    | 'Create_Courier'
    | 'Update_Courier'
    | 'Delete_Courier'
    | 'Create_Denomination'
    | 'Update_Denomination'
    | 'Delete_Denomination'
    | 'Create_User'
    | 'Update_User'
    | 'Delete_User'
    | 'Update_Permissions'
    | 'SuperAdmin_Override'
    | string;
  target_entity: string;
  target_identifier: string;
  event_description: string;
  justification: string;
  ip_address?: string | null;
  tamper_proof_signature: string;
  created_at: string;
}

export type VoucherMode = 'Shop_Vendor' | 'Staff_Split' | 'Courier';

export interface EodTillLockRecord {
  id?: string;
  branch_id: string;
  lock_date: string; // YYYY-MM-DD
  slip_id: string;
  system_cash_balance: number;
  physical_counted_cash: number;
  cash_variance: number;
  is_balanced: boolean;
  denominations: Record<string, number>;
  cashier_name: string;
  supervisor_name: string;
  notes?: string;
  locked_at?: string;
  created_at?: string;
}

export interface GstTaxRate {
  id: string;
  rate_percent: number;
  rate_label: string;
  is_active: boolean;
  display_order: number;
  created_at?: string;
  updated_at?: string;
}

