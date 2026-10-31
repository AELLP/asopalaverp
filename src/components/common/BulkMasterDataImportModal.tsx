import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useAuthStore } from '@/store/authStore';
import { useBranchStore } from '@/store/branchStore';
import { useVouchers } from '@/hooks/useVouchers';
import { erpService } from '@/lib/erpService';
import { supabase } from '@/lib/supabase';
import { SlideOverDrawer } from '@/components/ui/SlideOverDrawer';
import {  Tag,
  Layers,
  Truck,
  Users,
  Building2,  CheckCircle2,
  AlertTriangle,
  UploadCloud,
  Check,  Sparkles,
  HelpCircle,
  FileText,
  AlertOctagon,
  Database,
  AlertCircle,
} from 'lucide-react';
import { showToast } from '@/components/ui/ToastContainer';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

export type MasterClassification =
  | 'categories'
  | 'departments'
  | 'couriers'
  | 'staff'
  | 'branches';

interface ClassificationConfig {
  id: MasterClassification;
  label: string;
  singularLabel: string;
  icon: React.ElementType;
  sampleRows: string[];
  placeholderExample: string;
  columns: string[];
  getUniqueKey: (data: any) => string;
  parseRow: (line: string, index: number, defaultBranch: string) => {
    name: string;
    extra?: string;
    data: any;
    valid: boolean;
    error?: string;
  };
}

function parseCsvTokens(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if ((char === ',' || char === '\t' || char === ';' || char === '|') && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

const CLASSIFICATION_CONFIGS: Record<MasterClassification, ClassificationConfig> = {
  categories: {
    id: 'categories',
    label: 'Expense Categories',
    singularLabel: 'Expense Category',
    icon: Tag,
    columns: ['Category Name', 'Theme / Department Tag'],
    getUniqueKey: (data: any) => (data?.category_name || '').trim().toLowerCase(),
    sampleRows: [
      'Tea & Refreshments, General Expenses',
      'Showroom Lighting & Electricals, Maintenance',
      'Printing & Stationery, Office Supplies',
      'Customer Courier & Packing, Logistics',
      'Tailoring & Alteration Supplies, Production',
      'Security & Housekeeping Consumables, Facility',
    ],
    placeholderExample:
      'Tea & Refreshments, General Expenses\nShowroom Lighting & Electricals, Maintenance\nPrinting & Stationery, Office Supplies',
    parseRow: (line: string) => {
      const parts = parseCsvTokens(line);
      const name = parts[0] || '';
      return {
        name,
        extra: parts[1] || name,
        data: { category_name: name, color_theme: parts[1] || name, is_active: true },
        valid: name.length > 0,
        error: name.length === 0 ? 'Category name cannot be empty' : undefined,
      };
    },
  },
  departments: {
    id: 'departments',
    label: 'Showroom Departments',
    singularLabel: 'Department',
    icon: Layers,
    columns: ['Department Name', 'Code Identifier'],
    getUniqueKey: (data: any) => (data?.department_code || data?.department_name || '').trim().toUpperCase(),
    sampleRows: [
      'CASH COUNTER, CASH_COUNTER',
      'HOUSEKEEPING, HK',
      'CUSTOMER CARE, CC',
      'MENS WEAR, MENS',
      'BRIDAL SAREE, BRIDAL',
      'FANCY SAREE, FANCY',
    ],
    placeholderExample: 'CASH COUNTER, CASH_COUNTER\nHOUSEKEEPING, HK\nCUSTOMER CARE, CC',
    parseRow: (line: string) => {
      const parts = parseCsvTokens(line);
      const name = parts[0] || '';
      const code = parts[1] || name.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 20);
      return {
        name,
        extra: code,
        data: { department_name: name, department_code: code },
        valid: name.length > 0,
        error: name.length === 0 ? 'Department name cannot be empty' : undefined,
      };
    },
  },
  couriers: {
    id: 'couriers',
    label: 'Courier Partners',
    singularLabel: 'Courier Partner',
    icon: Truck,
    columns: ['Courier Partner Name', 'Partner Code', 'Contact Phone'],
    getUniqueKey: (data: any) => (data?.partner_code || data?.partner_name || '').trim().toUpperCase(),
    sampleRows: [
      'BlueDart Express, BLUEDART, 9876543210',
      'DTDC Courier, DTDC, 9822334455',
      'Maruti Air Courier, MARUTI, 9988776655',
      'Tirupati Courier, TIRUPATI, 9825123456',
    ],
    placeholderExample: 'BlueDart Express, BLUEDART, 9876543210\nDTDC Courier, DTDC, 9822334455',
    parseRow: (line: string) => {
      const parts = parseCsvTokens(line);
      const name = parts[0] || '';
      const code = parts[1] || name.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 15);
      const rawPhone = parts[2] ? parts[2].trim() : '';
      let phone: string | null = null;
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
        name,
        extra: `${code}${phone ? ` • ${phone}` : ''}`,
        data: { partner_name: name, partner_code: code, contact_phone: phone, is_active: true },
        valid: name.length > 0,
        error: name.length === 0 ? 'Courier name cannot be empty' : undefined,
      };
    },
  },
  staff: {
    id: 'staff',
    label: 'Showroom Staff',
    singularLabel: 'Staff Member',
    icon: Users,
    columns: ['Staff Code', 'First Name', 'Middle Name', 'Last Name', 'Mobile Number', 'Department', 'Designation'],
    getUniqueKey: (data: any) => (data?.staff_code || '').trim().toUpperCase(),
    sampleRows: [
      'ASI001, Rajesh, Kumar, Patel, 9825100001, Bridal Saree, Senior Sales Executive',
      'ASI002, Priya, , Shah, 9825100002, Cash Counter, Head Cashier',
      'ASI003, Hitesh, Ranchhodbhai, Soni, , Mens Wear, Sales Associate',
      'ASI004, Meera, , Dave, 9825100004, , ',
      'ASI005, Arvind, Kantilal, Vyas, 9825100005, Security, Guard',
    ],
    placeholderExample:
      'ASI001, Rajesh, Kumar, Patel, 9825100001, Bridal Saree, Senior Sales Executive\nASI002, Priya, , Shah, 9825100002, Cash Counter, Head Cashier\nASI003, Hitesh, , Soni, 9825100003, , ',
    parseRow: (line: string, index: number, defaultBranch: string) => {
      const parts = parseCsvTokens(line);
      
      // Header row detection
      const lineLower = line.toLowerCase();
      if (
        (lineLower.includes('staff code') || lineLower.includes('staff_code')) &&
        (lineLower.includes('first') || lineLower.includes('name') || lineLower.includes('mobile') || lineLower.includes('department'))
      ) {
        return {
          name: 'CSV Header Row (Ignored)',
          extra: line,
          data: null,
          valid: false,
          error: 'Header row detected — will be skipped during import',
        };
      }

      const code = (parts[0] || '').trim().toUpperCase();
      const first = (parts[1] || '').trim();
      
      const rawMiddle = parts[2] ? parts[2].trim() : '';
      const middle = rawMiddle && rawMiddle !== '-' && rawMiddle.toLowerCase() !== 'null' && rawMiddle.toLowerCase() !== 'na'
        ? rawMiddle
        : null;

      const rawLast = parts[3] ? parts[3].trim() : '';
      const last = rawLast && rawLast !== '-' && rawLast.toLowerCase() !== 'null' && rawLast.toLowerCase() !== 'na'
        ? rawLast
        : null;

      const rawMobile = parts[4] ? parts[4].trim() : '';
      let phone: string | null = null;
      if (rawMobile && rawMobile !== '-' && rawMobile !== '+91' && rawMobile.toLowerCase() !== 'null' && rawMobile.toLowerCase() !== 'na') {
        const digits = rawMobile.replace(/[^0-9]/g, '');
        if (digits.length >= 10) {
          const clean10 = digits.startsWith('91') && digits.length > 10 ? digits.slice(2, 12) : digits.slice(0, 10);
          phone = `+91 ${clean10.slice(0, 5)} ${clean10.slice(5, 10)}`;
        } else if (digits.length > 0) {
          phone = rawMobile;
        }
      }

      const rawDept = parts[5] ? parts[5].trim() : '';
      const dept = rawDept && rawDept !== '-' && rawDept.toLowerCase() !== 'null' && rawDept.toLowerCase() !== 'na'
        ? rawDept
        : null;

      const rawDesig = parts[6] ? parts[6].trim() : '';
      const designation = rawDesig && rawDesig !== '-' && rawDesig.toLowerCase() !== 'null' && rawDesig.toLowerCase() !== 'na'
        ? rawDesig
        : null;

      const valid = Boolean(code && first);
      let errorMsg: string | undefined;
      if (!code && !first) {
        errorMsg = 'Staff code and first name are required';
      } else if (!code) {
        errorMsg = 'Staff code is required';
      } else if (!first) {
        errorMsg = 'First name is required';
      }

      const nameParts = [first, middle, last].filter(Boolean);
      const fullName = nameParts.length > 0 ? nameParts.join(' ') : code;
      const metadataParts = [code, dept, designation, phone].filter(Boolean);

      return {
        name: fullName || 'Unnamed Staff',
        extra: metadataParts.length > 0 ? metadataParts.join(' • ') : '—',
        data: {
          staff_code: code,
          first_name: first,
          middle_name: middle,
          last_name: last,
          mobile_number: phone,
          department_name: dept,
          designation: designation,
          branch_id: defaultBranch,
          is_active: true,
        },
        valid,
        error: errorMsg,
      };
    },
  },
  branches: {
    id: 'branches',
    label: 'Showroom Branches',
    singularLabel: 'Branch',
    icon: Building2,
    columns: ['Branch Name', 'Branch Code', 'City', 'State', 'GSTIN'],
    getUniqueKey: (data: any) => (data?.branch_code || data?.branch_id || '').trim().toUpperCase(),
    sampleRows: [
      'Asopalav - Satellite Flagship, ASI, Ahmedabad, Gujarat, 24ABVFA8046N1ZQ',
      'Asopalav - C.G. Road Heritage, CGR, Ahmedabad, Gujarat, 24ABVFA8046N1ZQ',
      'Asopalav - Ashram Road Showroom, ASM, Ahmedabad, Gujarat, 24ABVFA8046N1ZQ',
      'Asopalav - Apparel Park Platinum, AP, Ahmedabad, Gujarat, 24ABVFA8046N1ZQ',
    ],
    placeholderExample:
      'Asopalav - Satellite Flagship, ASI, Ahmedabad, Gujarat, 24ABVFA8046N1ZQ\nAsopalav - C.G. Road Heritage, CGR, Ahmedabad, Gujarat, 24ABVFA8046N1ZQ',
    parseRow: (line: string) => {
      const parts = parseCsvTokens(line);
      const name = parts[0] || '';
      const code = parts[1] || name.slice(0, 3).toUpperCase();
      const city = parts[2] || 'Ahmedabad';
      const state = parts[3] || 'Gujarat';
      const gstin = parts[4] || '24ABVFA8046N1ZQ';
      return {
        name,
        extra: `${code} • ${city}`,
        data: {
          branch_name: name,
          branch_code: code,
          city,
          state,
          gstin,
          is_active: true,
          min_cash_threshold: 3000,
          max_cash_ceiling: 25000,
          max_upi_ceiling: 50000,
        },
        valid: name.length > 0 && code.length > 0,
        error: name.length === 0 ? 'Branch name cannot be empty' : undefined,
      };
    },
  },
};

export const BulkMasterDataImportModal: React.FC = () => {
  const { isBulkImportOpen, setBulkImportOpen, bulkImportDefaultType } = useUIStore();
  const { user } = useAuthStore();
  const { branches, selectedBranchId, fetchBranchesAndWallets } = useBranchStore();
  const { refresh } = useVouchers();

  const [activeType, setActiveType] = useState<MasterClassification>(
    (bulkImportDefaultType && CLASSIFICATION_CONFIGS[bulkImportDefaultType as MasterClassification])
      ? (bulkImportDefaultType as MasterClassification)
      : 'categories'
  );
  const [targetBranch, setTargetBranch] = useState(
    selectedBranchId || (branches && branches.length > 0 ? branches[0].branch_id : 'Aellp-ASI')
  );
  const [rawText, setRawText] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [resultMessage, setResultMessage] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);
  const [existingDbKeys, setExistingDbKeys] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync activeType and targetBranch on modal open
  useEffect(() => {
    if (isBulkImportOpen) {
      if (bulkImportDefaultType && CLASSIFICATION_CONFIGS[bulkImportDefaultType as MasterClassification]) {
        setActiveType(bulkImportDefaultType as MasterClassification);
      }
      if (selectedBranchId) {
        setTargetBranch(selectedBranchId);
      } else if (branches && branches.length > 0 && !targetBranch) {
        setTargetBranch(branches[0].branch_id);
      }
      setShowDiscardConfirm(false);
      setIsPreviewOpen(false);
      setResultMessage(null);
    }
  }, [isBulkImportOpen, bulkImportDefaultType, selectedBranchId, branches]);

  // Load draft from localStorage on open or type change
  useEffect(() => {
    if (isBulkImportOpen) {
      const savedDraft = localStorage.getItem(`asopalav_bulk_draft_${activeType}`) || '';
      setRawText(savedDraft);
      setResultMessage(null);
      setShowDiscardConfirm(false);
    }
  }, [isBulkImportOpen, activeType]);

  // Autosave draft to localStorage
  useEffect(() => {
    if (isBulkImportOpen) {
      if (rawText.trim()) {
        localStorage.setItem(`asopalav_bulk_draft_${activeType}`, rawText);
      } else {
        localStorage.removeItem(`asopalav_bulk_draft_${activeType}`);
      }
    }
  }, [rawText, activeType, isBulkImportOpen]);

  // Fetch existing master keys from database to detect duplicates in real time
  useEffect(() => {
    if (!isBulkImportOpen) return;
    let isCancelled = false;

    const fetchExisting = async () => {
      try {
        const keys = new Set<string>();
        if (activeType === 'categories') {
          const { data } = await supabase.from('expense_categories').select('category_name');
          (data || []).forEach((c: any) => {
            if (c?.category_name) keys.add(c.category_name.trim().toLowerCase());
          });
        } else if (activeType === 'departments') {
          const { data } = await supabase.from('departments').select('department_code, department_name');
          (data || []).forEach((d: any) => {
            if (d?.department_code) keys.add(d.department_code.trim().toUpperCase());
            if (d?.department_name) keys.add(d.department_name.trim().toUpperCase());
          });
        } else if (activeType === 'couriers') {
          const { data } = await supabase.from('courier_partners').select('partner_code, partner_name');
          (data || []).forEach((c: any) => {
            if (c?.partner_code) keys.add(c.partner_code.trim().toUpperCase());
            if (c?.partner_name) keys.add(c.partner_name.trim().toUpperCase());
          });
        } else if (activeType === 'staff') {
          const { data } = await supabase.from('staff_members').select('staff_code');
          (data || []).forEach((s: any) => {
            if (s?.staff_code) keys.add(s.staff_code.trim().toUpperCase());
          });
        } else if (activeType === 'branches') {
          const { data } = await supabase.from('branches').select('branch_code, branch_id');
          (data || []).forEach((b: any) => {
            if (b?.branch_code) keys.add(b.branch_code.trim().toUpperCase());
            if (b?.branch_id) keys.add(b.branch_id.trim().toUpperCase());
          });
        }
        if (!isCancelled) {
          setExistingDbKeys(keys);
        }
      } catch (err) {
        console.warn('Could not query existing master keys:', err);
      }
    };

    fetchExisting();
    return () => {
      isCancelled = true;
    };
  }, [isBulkImportOpen, activeType]);

  const currentConfig = CLASSIFICATION_CONFIGS[activeType] || CLASSIFICATION_CONFIGS.categories;

  // Parse lines into structured rows with smart duplicate tagging
  const parsedItems = useMemo(() => {
    if (!rawText.trim() || !currentConfig) return [];
    const lines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));

    const seenBatch = new Set<string>();

    return lines.map((line, idx) => {
      const parsed = currentConfig.parseRow
        ? currentConfig.parseRow(line, idx, targetBranch || 'Aellp-ASI')
        : { name: line, valid: false, error: 'Parser unavailable', data: null };

      if (!parsed || !parsed.valid || !parsed.data) {
        return {
          ...parsed,
          isNew: false,
          isExistingDb: false,
          isBatchDuplicate: false,
        };
      }

      const key = currentConfig.getUniqueKey ? currentConfig.getUniqueKey(parsed.data) : '';

      if (key && existingDbKeys.has(key)) {
        return {
          ...parsed,
          isNew: false,
          isExistingDb: true,
          isBatchDuplicate: false,
          error: 'Already exists in database (Skipped)',
        };
      }

      if (key && seenBatch.has(key)) {
        return {
          ...parsed,
          isNew: false,
          isExistingDb: false,
          isBatchDuplicate: true,
          error: 'Duplicate row in file (Skipped)',
        };
      }

      if (key) {
        seenBatch.add(key);
      }

      return {
        ...parsed,
        isNew: true,
        isExistingDb: false,
        isBatchDuplicate: false,
      };
    });
  }, [rawText, currentConfig, targetBranch, existingDbKeys]);

  const newCount = parsedItems.filter((i) => i.valid && i.isNew).length;
  const existingDbCount = parsedItems.filter((i) => i.valid && i.isExistingDb).length;
  const batchDupCount = parsedItems.filter((i) => i.valid && i.isBatchDuplicate).length;
  const invalidCount = parsedItems.filter((i) => !i.valid).length;
  
  const handleSafeClose = () => {
    if (rawText.trim().length > 0 && parsedItems.length > 0) {
      setShowDiscardConfirm(true);
    } else {
      closeDrawer();
    }
  };

  const closeDrawer = () => {
    setShowDiscardConfirm(false);
    setBulkImportOpen(false);
  };

  const handleDiscardAndClose = () => {
    localStorage.removeItem(`asopalav_bulk_draft_${activeType}`);
    setRawText('');
    closeDrawer();
  };

  const handleApplySample = () => {
    setRawText(currentConfig.sampleRows.join('\n'));
    setResultMessage(null);
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
        setRawText(text);
        setResultMessage(null);
        showToast({
          type: 'info',
          title: 'File Loaded',
          message: `Loaded ${file.name} successfully.`,
        });
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleInitiateImport = () => {
    if (newCount === 0) {
      if (existingDbCount > 0 || batchDupCount > 0) {
        const dupMsg = `Duplicate Import: All ${existingDbCount + batchDupCount} record(s) already exist in database or input.`;
        setResultMessage({
          type: 'error',
          message: dupMsg,
        });
        showToast({
          type: 'error',
          title: 'Already in Database',
          message: dupMsg,
        });
        return;
      }

      const msg = parsedItems.length === 0 
        ? 'Please enter or paste at least one record.'
        : `Cannot import: all ${parsedItems.length} records contain errors.`;
      setResultMessage({
        type: 'error',
        message: msg,
      });
      showToast({
        type: 'error',
        title: 'Validation Error',
        message: msg,
      });
      return;
    }

    setIsPreviewOpen(true);
  };

  const handleExecuteImport = async () => {
    setImporting(true);
    setResultMessage(null);

    try {
      const validNewPayloads = parsedItems.filter((i) => i.valid && i.isNew && i.data).map((i) => i.data);
      if (validNewPayloads.length === 0) {
        throw new Error('No new record payloads found to import.');
      }

      const res = await erpService.bulkImportMasterData(
        activeType,
        validNewPayloads,
        `${user?.first_name} ${user?.last_name}`,
        user?.role_code || 'Super_Admin'
      );

      if (!res.success) {
        setResultMessage({
          type: 'error',
          message: res.message || 'Database error occurred during import. No records were saved.',
        });
        showToast({
          type: 'error',
          title: 'Import Failed',
          message: res.message || 'Failed to complete bulk import.',
        });
        return;
      }

      fetchBranchesAndWallets(true);
      refresh();

      // Update existing keys state immediately
      const updatedKeys = new Set(existingDbKeys);
      validNewPayloads.forEach((p) => {
        const k = currentConfig.getUniqueKey(p);
        if (k) updatedKeys.add(k);
      });
      setExistingDbKeys(updatedKeys);

      const skippedCount = existingDbCount + batchDupCount;

      if (skippedCount > 0 || invalidCount > 0) {
        // Partial import with errors
        showToast({
          type: 'warning',
          title: 'Smart Import Completed',
          message: `Saved ${res.insertedCount} new ${currentConfig.label}.${skippedCount > 0 ? ` ${skippedCount} duplicate(s) were skipped.` : ''}${invalidCount > 0 ? ` ${invalidCount} invalid row(s) were skipped.` : ''}`,
        });

        setResultMessage({
          type: 'warning',
          message: `Smart Import: ${res.insertedCount} new records saved successfully.${skippedCount > 0 ? ` ${skippedCount} already-existing items were skipped.` : ''}${invalidCount > 0 ? ` ${invalidCount} invalid rows were skipped.` : ''}`,
        });
      } else {
        // 100% clean import
        showToast({
          type: 'success',
          title: 'Bulk Import Completed',
          message: `Successfully imported all ${res.insertedCount} new ${currentConfig.label}!`,
        });

        setResultMessage({
          type: 'success',
          message: `Successfully imported all ${res.insertedCount} new ${currentConfig.label}!`,
        });

        localStorage.removeItem(`asopalav_bulk_draft_${activeType}`);

        setTimeout(() => {
          closeDrawer();
        }, 1200);
      }
    } catch (err: any) {
      console.error('Bulk import error:', err);
      showToast({
        type: 'error',
        title: 'Import Failed',
        message: err.message || 'Failed to complete import.',
      });
      setResultMessage({
        type: 'error',
        message: err.message || 'Failed to complete import.',
      });
    } finally {
      setImporting(false);
    }
  };

  if (!isBulkImportOpen) return null;

  const drawerBadge = (
    <span className="px-2 py-0.5 rounded-[4px] bg-slate-100 dark:bg-[#202020] text-slate-600 dark:text-zinc-400 font-mono text-[10px] font-medium border border-slate-200 dark:border-[#282828]">
      CSV / TSV / Excel
    </span>
  );

  const drawerFooter = (
    <div className="w-full flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap text-xs font-mono">
        <span className="text-slate-500 dark:text-zinc-400 text-[11px] font-sans">Summary:</span>
        <span className="px-2 py-0.5 rounded-[4px] bg-slate-100 dark:bg-[#202020] text-slate-900 dark:text-white font-medium border border-slate-200 dark:border-[#282828] tabular-nums text-[11px]">
          {parsedItems.length} Total
        </span>
        <span className="px-2 py-0.5 rounded-[4px] bg-emerald-500/10 text-emerald-600 dark:text-[#3ecf8e] font-medium border border-emerald-500/20 tabular-nums text-[11px]">
          {newCount} New
        </span>
        {existingDbCount > 0 && (
          <span className="px-2 py-0.5 rounded-[4px] bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium border border-amber-500/20 tabular-nums text-[11px]">
            {existingDbCount} In DB
          </span>
        )}
        {batchDupCount > 0 && (
          <span className="px-2 py-0.5 rounded-[4px] bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium border border-amber-500/20 tabular-nums text-[11px]">
            {batchDupCount} Dupes
          </span>
        )}
        {invalidCount > 0 && (
          <span className="px-2 py-0.5 rounded-[4px] bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium border border-rose-500/20 tabular-nums text-[11px]">
            {invalidCount} Invalid
          </span>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 shrink-0">
        {rawText && (
          <button
            type="button"
            onClick={() => setRawText('')}
            className="px-3 py-1.5 rounded-[6px] text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 text-xs font-medium font-sans transition-colors cursor-pointer"
          >
            Reset
          </button>
        )}
        <button
          type="button"
          onClick={handleSafeClose}
          className="h-10 min-h-[40px] px-4 rounded-[6px] border border-slate-300 dark:border-[#2e2e2e] bg-transparent hover:bg-slate-100 dark:hover:bg-[#222222] text-slate-800 dark:text-zinc-200 text-xs font-medium font-sans cursor-pointer transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={newCount === 0 || importing}
          onClick={handleInitiateImport}
          className="inline-flex items-center justify-center gap-1.5 h-10 min-h-[40px] px-4 rounded-[6px] bg-[#3ecf8e] hover:bg-[#34b27b] text-[#171717] font-semibold text-xs font-sans transition-colors cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed shadow-xs whitespace-nowrap"
        >
          <Check className="w-3.5 h-3.5 text-[#171717] stroke-[2.5] shrink-0" />
          <span>
            {importing
              ? 'Importing Data...'
              : newCount === 0 && (existingDbCount > 0 || batchDupCount > 0)
              ? `0 New (${existingDbCount + batchDupCount} in DB)`
              : `Import ${newCount} New ${currentConfig.label}`}
          </span>
        </button>
      </div>
    </div>
  );

  return (
    <SlideOverDrawer
      isOpen={isBulkImportOpen}
      onClose={handleSafeClose}
      title="Bulk Data Import"
      subtitle="Paste tabular CSV/TSV data or drop spreadsheet files to batch populate master records"
      badge={drawerBadge}
      size="2xl"
      footer={drawerFooter}
    >
      <div className="space-y-4 font-sans text-xs">
        {/* Supabase Classification Selector Tab Strip */}
        <div className="bg-slate-50 dark:bg-[#181818] p-2 rounded-[8px] border border-slate-200 dark:border-[#262626] space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
            {(Object.keys(CLASSIFICATION_CONFIGS) as MasterClassification[]).map((key) => {
              const cfg = CLASSIFICATION_CONFIGS[key];
              const Icon = cfg.icon;
              const isActive = activeType === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setActiveType(key);
                    const savedDraft = localStorage.getItem(`asopalav_bulk_draft_${key}`) || '';
                    setRawText(savedDraft);
                    setResultMessage(null);
                  }}
                  className={`inline-flex items-center justify-center gap-2 px-3 py-2 rounded-[6px] text-xs font-medium transition-all cursor-pointer select-none ${
                    isActive
                      ? 'bg-white dark:bg-[#282828] text-slate-900 dark:text-white shadow-xs font-semibold border border-slate-300/80 dark:border-[#383838]'
                      : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 hover:bg-slate-200/50 dark:hover:bg-[#202020] border border-transparent'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#3ecf8e]' : 'text-slate-400'}`} />
                  <span className="truncate">{cfg.label}</span>
                </button>
              );
            })}
          </div>

          {/* Showroom Target Branch Filter (for staff records) */}
          {activeType === 'staff' && (
            <div className="pt-2 border-t border-slate-200/80 dark:border-[#262626] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-zinc-300 font-medium">
                <Building2 className="w-3.5 h-3.5 text-[#3ecf8e] shrink-0" />
                <span>Assign Target Branch for Imported Staff:</span>
              </div>
              <div className="w-full sm:w-64">
                <SearchableSelect
                  size="sm"
                  options={(branches || []).map((b) => ({
                    value: b?.branch_id || '',
                    label: b?.branch_code || b?.branch_id || '',
                    sublabel: (b?.branch_name || '').replace(/^Asopalav\s*-\s*/i, ''),
                  }))}
                  value={targetBranch}
                  onChange={setTargetBranch}
                  placeholder="Select branch..."
                  searchPlaceholder="Search branch..."
                  allowCustom={false}
                />
              </div>
            </div>
          )}
        </div>

        {/* 2-Column Split Interface */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left Column (5 cols): File Upload & Raw Text Editor */}
          <div className="lg:col-span-5 space-y-3 flex flex-col">
            {/* Guide & Sample Auto-fill */}
            <div className="p-3 bg-slate-50 dark:bg-[#181818] border border-slate-200 dark:border-[#262626] rounded-[8px] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-slate-800 dark:text-zinc-200 font-medium">
                  <HelpCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>Expected Columns ({currentConfig.columns.length})</span>
                </div>
                <button
                  type="button"
                  onClick={handleApplySample}
                  className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-[#3ecf8e] hover:underline font-medium cursor-pointer"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Fill Sample Data</span>
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5 items-center">
                {currentConfig.columns.map((col, cIdx) => (
                  <span
                    key={cIdx}
                    className="inline-flex items-center px-2 py-0.5 rounded-[4px] bg-slate-200/70 dark:bg-[#252525] text-slate-800 dark:text-zinc-200 font-mono text-[11px] font-medium border border-slate-300/60 dark:border-[#333333]"
                  >
                    {col}
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 dark:text-zinc-400">
                Supports comma (<code className="font-mono text-[10px] bg-slate-200/60 dark:bg-[#242424] px-1 rounded">,</code>), tab (<code className="font-mono text-[10px] bg-slate-200/60 dark:bg-[#242424] px-1 rounded">\t</code>), semicolon (<code className="font-mono text-[10px] bg-slate-200/60 dark:bg-[#242424] px-1 rounded">;</code>), or pipe (<code className="font-mono text-[10px] bg-slate-200/60 dark:bg-[#242424] px-1 rounded">|</code>). One record per line.
              </p>
            </div>

            {/* File Drag-and-Drop Area */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`p-4 border border-dashed rounded-[6px] text-center cursor-pointer transition-colors ${
                isDragOver
                  ? 'border-[#3ecf8e] bg-emerald-500/10'
                  : 'border-slate-200 dark:border-[#2e2e2e] bg-slate-50/50 dark:bg-[#161616] hover:border-slate-300 dark:hover:border-[#383838]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
              />
              <UploadCloud className="w-5 h-5 text-slate-400 mx-auto mb-1" />
              <p className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                Click to browse or drop CSV / TSV file
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">Supports .csv, .tsv, .txt UTF-8 encoded files</p>
            </div>

            {/* Textarea Input */}
            <div className="flex-1 flex flex-col min-h-[160px]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">Or Paste Raw Text Rows:</span>
                <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                  {rawText.split('\n').filter(Boolean).length} lines
                </span>
              </div>
              <textarea
                value={rawText}
                onChange={(e) => {
                  setRawText(e.target.value);
                  setResultMessage(null);
                }}
                placeholder={currentConfig.placeholderExample}
                rows={9}
                className="w-full flex-1 p-3 bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#2e2e2e] rounded-[6px] font-mono text-xs text-slate-900 dark:text-zinc-200 placeholder:text-slate-400 focus:outline-none focus:border-[#3ecf8e] resize-none leading-relaxed"
              />
            </div>
          </div>

          {/* Right Column (7 cols): Parsed Table Preview */}
          <div className="lg:col-span-7 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                Parsed Data Preview & Validation
              </span>
              <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                {newCount} new to insert{existingDbCount > 0 ? ` • ${existingDbCount} in database` : ''}
              </span>
            </div>

            {/* Preview Table Container */}
            <div className="border border-slate-200 dark:border-[#262626] rounded-[6px] bg-white dark:bg-[#141414] overflow-hidden max-h-[380px] overflow-y-auto">
              {parsedItems.length === 0 ? (
                <div className="p-8 text-center text-slate-400 dark:text-zinc-500">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-xs">No records parsed yet.</p>
                  <p className="text-[11px] mt-0.5">Paste CSV rows or click "Fill Sample Data" on the left.</p>
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-[#171717] border-b border-slate-200 dark:border-[#262626] text-[10px] font-mono uppercase text-slate-500 dark:text-zinc-400">
                    <tr>
                      <th className="py-2 px-3 w-10 text-center">#</th>
                      <th className="py-2 px-3">Record Name</th>
                      <th className="py-2 px-3">Metadata / Code</th>
                      <th className="py-2 px-3 w-28 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#1f1f1f] font-mono">
                    {parsedItems.map((item, idx) => (
                      <tr
                        key={idx}
                        className={
                          !item.valid
                            ? 'bg-rose-500/5 hover:bg-rose-500/10'
                            : item.isExistingDb || item.isBatchDuplicate
                            ? 'bg-amber-500/5 hover:bg-amber-500/10'
                            : 'hover:bg-slate-50/80 dark:hover:bg-[#181818]'
                        }
                      >
                        <td className="py-2 px-3 text-center text-slate-400 text-[11px]">{idx + 1}</td>
                        <td className="py-2 px-3 font-sans font-medium text-slate-900 dark:text-zinc-100">
                          {item.name || <span className="text-rose-500 italic">Empty</span>}
                        </td>
                        <td className="py-2 px-3 text-[11px]">
                          {!item.valid ? (
                            <span className="text-rose-600 dark:text-rose-400 font-sans font-medium flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
                              <span>{item.error || 'Invalid record'}</span>
                            </span>
                          ) : item.isExistingDb ? (
                            <span className="text-amber-600 dark:text-amber-400 font-sans font-medium flex items-center gap-1">
                              <Database className="w-3 h-3 text-amber-500 shrink-0" />
                              <span>Already exists in database (Will be skipped)</span>
                            </span>
                          ) : item.isBatchDuplicate ? (
                            <span className="text-amber-600 dark:text-amber-400 font-sans font-medium flex items-center gap-1">
                              <Layers className="w-3 h-3 text-amber-500 shrink-0" />
                              <span>Duplicate row in file (Will be skipped)</span>
                            </span>
                          ) : (
                            <span className="text-slate-500 dark:text-zinc-400">{item.extra || '—'}</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right">
                          {!item.valid ? (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] text-rose-500 cursor-help"
                              title={item.error}
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>Error</span>
                            </span>
                          ) : item.isExistingDb ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                              <AlertCircle className="w-3.5 h-3.5" />
                              <span>In DB</span>
                            </span>
                          ) : item.isBatchDuplicate ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                              <Layers className="w-3.5 h-3.5" />
                              <span>Duplicate</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-[#3ecf8e] font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>New</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {resultMessage && (
              <div
                className={`p-3 rounded-[6px] text-xs flex items-center gap-2 border font-sans ${
                  resultMessage.type === 'success'
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border-emerald-500/20'
                    : resultMessage.type === 'warning'
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'
                    : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20'
                }`}
              >
                {resultMessage.type === 'success' && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-[#3ecf8e] shrink-0" />
                )}
                {resultMessage.type === 'warning' && (
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                )}
                {resultMessage.type === 'error' && (
                  <AlertOctagon className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                )}
                <span className="font-medium">{resultMessage.message}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Discard Confirmation Modal Overlay */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 animate-fade-in font-sans">
          <div className="w-full max-w-md bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#262626] rounded-[8px] p-5 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
                <AlertOctagon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-slate-900 dark:text-white">
                  Discard Unsaved Import Draft?
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
                  You have <span className="font-mono font-medium">{parsedItems.length} records</span> entered in
                  this drawer. Closing will retain your draft in local browser cache, or you can discard it completely.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#262626]">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="px-3.5 py-1.5 rounded-[6px] bg-slate-100 dark:bg-[#222222] text-slate-700 dark:text-zinc-200 text-xs font-medium hover:bg-slate-200 dark:hover:bg-[#282828] transition-colors cursor-pointer"
              >
                Continue Editing
              </button>
              <button
                type="button"
                onClick={closeDrawer}
                className="px-3.5 py-1.5 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#202020] text-slate-700 dark:text-zinc-300 text-xs font-medium hover:bg-slate-50 dark:hover:bg-[#282828] transition-colors cursor-pointer"
              >
                Keep Draft & Close
              </button>
              <button
                type="button"
                onClick={handleDiscardAndClose}
                className="px-3.5 py-1.5 rounded-[6px] bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium transition-colors cursor-pointer"
              >
                Discard Draft
              </button>
            </div>
          </div>
        </div>
      )}
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
                  Confirm Bulk Import
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-[#888888] font-sans">
                  Review the summary before importing records
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-[8px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#242424] space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-[#707070]">Category / Type:</span>
                <span className="font-semibold text-slate-900 dark:text-white">{currentConfig.label}</span>
              </div>
              {activeType === 'staff' && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-[#707070]">Target Branch:</span>
                  <span className="text-slate-900 dark:text-white">{targetBranch}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-[#707070]">New Records:</span>
                <span className="font-semibold text-emerald-600 dark:text-[#3ecf8e]">{newCount} rows to save</span>
              </div>
              {existingDbCount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-[#707070]">Already in Database:</span>
                  <span className="text-amber-600 dark:text-amber-400">{existingDbCount} rows (will skip)</span>
                </div>
              )}
              {batchDupCount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-[#707070]">Duplicate in File:</span>
                  <span className="text-amber-600 dark:text-amber-400">{batchDupCount} rows (will skip)</span>
                </div>
              )}
              {invalidCount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-[#707070]">Invalid Rows:</span>
                  <span className="text-rose-600 dark:text-rose-400">{invalidCount} rows (will skip)</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                disabled={importing}
                className="flex-1 py-2 px-3 rounded-[6px] border border-slate-200 dark:border-[#282828] bg-slate-50 dark:bg-[#202020] text-slate-700 dark:text-[#EDEDED] font-medium transition-colors cursor-pointer hover:bg-slate-100 dark:hover:bg-[#262626]"
              >
                Back & Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsPreviewOpen(false);
                  handleExecuteImport();
                }}
                disabled={importing}
                className="flex-1 py-2 px-3 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50"
              >
                {importing ? (
                  <div className="w-3.5 h-3.5 border-2 border-[#171717] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                )}
                <span>Confirm & Import</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </SlideOverDrawer>
  );
};
