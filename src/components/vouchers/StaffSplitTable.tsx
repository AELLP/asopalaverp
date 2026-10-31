import React from 'react';
import { StaffMember, ExpenseCategory, Department } from '@/types/database';
import { Plus, Trash2, Users, Calculator } from 'lucide-react';
import { formatINR } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

export interface SplitItem {
  staffCode: string;
  staffName: string;
  departmentName: string;
  categoryName: string;
  amount: number;
}

interface StaffSplitTableProps {
  splits: SplitItem[];
  staffList: StaffMember[];
  categories: ExpenseCategory[];
  departments: Department[];
  targetAmount?: number;
  onChange: (splits: SplitItem[]) => void;
}

export const StaffSplitTable: React.FC<StaffSplitTableProps> = ({
  splits,
  staffList,
  categories,
  departments,
  targetAmount,
  onChange,
}) => {
  const handleAddRow = () => {
    const newRow: SplitItem = {
      staffCode: '',
      staffName: '',
      departmentName: '',
      categoryName: '',
      amount: 0,
    };
    onChange([...splits, newRow]);
  };

  const handleRemoveRow = (index: number) => {
    onChange(splits.filter((_, idx) => idx !== index));
  };

  const handleUpdateRow = (index: number, field: keyof SplitItem, value: any) => {
    const updated = [...splits];
    if (field === 'staffCode') {
      const selected = staffList.find(
        (s) =>
          s.staff_code === value ||
          `${s.first_name} ${s.last_name}`.trim().toLowerCase() === value.trim().toLowerCase()
      );
      if (selected) {
        updated[index] = {
          ...updated[index],
          staffCode: selected.staff_code,
          staffName: `${selected.first_name} ${selected.last_name}`.trim(),
          departmentName: selected.department_name || updated[index].departmentName || '',
        };
      } else {
        updated[index] = {
          ...updated[index],
          staffCode: '',
          staffName: '',
        };
      }
    } else {
      updated[index] = { ...updated[index], [field]: value };
    }
    onChange(updated);
  };

  const handleSplitEvenly = () => {
    if (splits.length === 0) return;
    const baseTotal = targetAmount || splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    if (baseTotal <= 0) return;

    const perPerson = Math.floor(baseTotal / splits.length);
    const remainder = baseTotal - perPerson * splits.length;

    const updated = splits.map((item, idx) => ({
      ...item,
      amount: idx === 0 ? perPerson + remainder : perPerson,
    }));
    onChange(updated);
  };

  const totalSplitAmount = splits.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

  return (
    <div className="space-y-3.5 font-sans">
      {/* Top Staff Allocation Sub-Header Banner */}
      <div className="p-3.5 sm:p-4 rounded-[12px] bg-slate-50/60 dark:bg-[#141414] border border-slate-200 dark:border-[#262626] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-[6px] bg-[#3ecf8e]/10 text-emerald-600 dark:text-[#3ecf8e] border border-[#3ecf8e]/25 flex items-center justify-center shrink-0">
            <Users className="w-4 h-4 stroke-[2.2]" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-slate-900 dark:text-white font-sans tracking-tight">
              Staff / Multi-Employee Expense Allocation
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-sans mt-0.5">
              Distribute total payout across staff members with category and department attribution.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {splits.length > 1 && (
            <button
              type="button"
              onClick={handleSplitEvenly}
              className="h-10 min-h-[40px] px-3.5 rounded-[6px] bg-white dark:bg-[#1f1f1f] text-slate-700 dark:text-[#EDEDED] hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-[#2e2e2e] hover:border-slate-300 dark:hover:border-[#383838] text-xs font-medium font-sans flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              title="Distribute amount evenly across all added staff"
            >
              <Calculator className="w-3.5 h-3.5 text-emerald-600 dark:text-[#3ecf8e]" />
              <span>Split Equally</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleAddRow}
            className="h-10 min-h-[40px] px-3.5 rounded-[6px] bg-white dark:bg-[#1f1f1f] hover:bg-emerald-50 dark:hover:bg-[#3ecf8e]/10 text-slate-800 dark:text-zinc-100 hover:text-emerald-700 dark:hover:text-[#3ecf8e] border border-slate-200 dark:border-[#2e2e2e] hover:border-emerald-500/40 dark:hover:border-[#3ecf8e]/40 text-xs font-medium font-sans flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5] text-emerald-600 dark:text-[#3ecf8e]" />
            <span>Staff Member</span>
          </button>
        </div>
      </div>

      {/* Split Rows Table Container (Desktop + Mobile) */}
      <div className="rounded-[12px] border border-slate-200 dark:border-[#262626] bg-white dark:bg-[#161616] overflow-visible shadow-xs">
        {/* Desktop Column Header */}
        <div className="hidden sm:grid grid-cols-12 gap-2.5 text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-[#a1a1a1] bg-slate-50/80 dark:bg-[#141414] px-4 py-2.5 border-b border-slate-200 dark:border-[#262626] rounded-t-[12px]">
          <div className="col-span-1">#</div>
          <div className="col-span-4 flex items-center gap-1">
            <span>Staff Member *</span>
          </div>
          <div className="col-span-3 flex items-center gap-1">
            <span>Department *</span>
          </div>
          <div className="col-span-2 flex items-center gap-1">
            <span>Category *</span>
          </div>
          <div className="col-span-2 text-right">
            <span>Amount (₹) *</span>
          </div>
        </div>

        {/* Desktop Rows (sm+) */}
        <div className="hidden sm:block">
          {splits.map((row, idx) => {
            return (
              <div
                key={idx}
                className="relative focus-within:z-50 hover:z-20 grid grid-cols-12 gap-2.5 items-center px-4 py-2.5 hover:bg-slate-50/70 dark:hover:bg-[#1c1c1c] transition-colors border-b border-slate-100 dark:border-[#222222] last:border-b-0"
              >
                <div className="col-span-1 text-xs font-mono font-medium text-slate-400 dark:text-zinc-500 tabular-nums">
                  #{idx + 1}
                </div>

                <div className="col-span-4">
                  <SearchableSelect
                    value={row.staffCode}
                    onChange={(val) => handleUpdateRow(idx, 'staffCode', val)}
                    options={staffList.map((s) => ({
                      value: s.staff_code,
                      label: `${s.first_name} ${s.last_name}`.trim(),
                      subLabel: s.department_name || undefined,
                    }))}
                    placeholder="Select staff member..."
                    allowCustom={false}
                  />
                </div>

                <div className="col-span-3">
                  <SearchableSelect
                    value={row.departmentName}
                    onChange={(val) => handleUpdateRow(idx, 'departmentName', val)}
                    options={departments.map((d) => ({
                      value: d.department_name,
                      label: d.department_name,
                    }))}
                    placeholder="Select department..."
                    allowCustom={false}
                  />
                </div>

                <div className="col-span-2">
                  <SearchableSelect
                    value={row.categoryName}
                    onChange={(val) => handleUpdateRow(idx, 'categoryName', val)}
                    options={categories.map((c) => ({
                      value: c.category_name,
                      label: c.category_name,
                    }))}
                    placeholder="Select category..."
                    allowCustom={false}
                  />
                </div>

                <div className="col-span-2 flex items-center gap-2 justify-end">
                  <div className="relative flex items-center w-full min-w-[90px]">
                    <span className="absolute left-2.5 text-xs font-mono text-slate-400 dark:text-zinc-500">₹</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={row.amount || ''}
                      onChange={(e) =>
                        handleUpdateRow(idx, 'amount', Math.max(0, parseFloat(e.target.value) || 0))
                      }
                      placeholder="0.00"
                      className="w-full h-10 min-h-[40px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[6px] pl-6 pr-2.5 text-xs font-mono tabular-nums font-semibold text-right text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-[#3ecf8e] dark:focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 shadow-2xs"
                    />
                  </div>
                  {splits.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(idx)}
                      className="p-1.5 rounded-[4px] hover:bg-rose-50 dark:hover:bg-rose-500/10 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer shrink-0"
                      title="Remove staff row"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Mobile Allocation Cards (< sm) */}
        <div className="block sm:hidden p-3 space-y-3">
          {splits.map((row, idx) => {
            return (
              <div
                key={idx}
                className="relative focus-within:z-50 hover:z-20 p-3.5 rounded-[8px] bg-slate-50/60 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#262626] space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-medium text-slate-600 dark:text-zinc-400">
                    #{idx + 1} Staff Allocation
                  </span>
                  {splits.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(idx)}
                      className="p-1 rounded-[4px] hover:bg-rose-50 dark:hover:bg-rose-500/10 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                      title="Remove staff row"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-slate-700 dark:text-zinc-300">
                    Staff Member *
                  </label>
                  <SearchableSelect
                    value={row.staffCode}
                    onChange={(val) => handleUpdateRow(idx, 'staffCode', val)}
                    options={staffList.map((s) => ({
                      value: s.staff_code,
                      label: `${s.first_name} ${s.last_name}`.trim(),
                      subLabel: s.department_name || undefined,
                    }))}
                    placeholder="Select staff member..."
                    allowCustom={false}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-zinc-300">
                      Department *
                    </label>
                    <SearchableSelect
                      value={row.departmentName}
                      onChange={(val) => handleUpdateRow(idx, 'departmentName', val)}
                      options={departments.map((d) => ({
                        value: d.department_name,
                        label: d.department_name,
                      }))}
                      placeholder="Select dept..."
                      allowCustom={false}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-zinc-300">
                      Category *
                    </label>
                    <SearchableSelect
                      value={row.categoryName}
                      onChange={(val) => handleUpdateRow(idx, 'categoryName', val)}
                      options={categories.map((c) => ({
                        value: c.category_name,
                        label: c.category_name,
                      }))}
                      placeholder="Select cat..."
                      allowCustom={false}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-slate-700 dark:text-zinc-300">
                    Amount (₹) *
                  </label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-xs font-mono text-slate-400 dark:text-zinc-500">₹</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={row.amount || ''}
                      onChange={(e) =>
                        handleUpdateRow(idx, 'amount', Math.max(0, parseFloat(e.target.value) || 0))
                      }
                      placeholder="0.00"
                      className="w-full h-10 min-h-[40px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[6px] pl-7 pr-3 text-xs font-mono tabular-nums font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-[#3ecf8e] dark:focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 shadow-2xs"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {splits.length === 0 && (
          <div className="py-10 text-center text-xs font-sans text-slate-500 dark:text-zinc-400">
            No staff members added yet. Click &ldquo;+ Staff Member&rdquo; above to allocate expenses.
          </div>
        )}

        {/* Table Footer / Summary */}
        <div className="px-4 py-3 bg-slate-50/80 dark:bg-[#141414] border-t border-slate-200 dark:border-[#262626] rounded-b-[12px] flex items-center justify-between text-xs font-sans">
          <span className="text-slate-500 dark:text-zinc-400 font-mono text-[11px]">
            Staff Allocated:{' '}
            <span className="font-semibold text-slate-800 dark:text-zinc-200">
              {splits.length} {splits.length === 1 ? 'member' : 'members'}
            </span>
          </span>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 dark:text-zinc-400 font-medium font-sans">Split Total:</span>
            <span className="px-2.5 py-1 rounded-[4px] bg-white dark:bg-[#1f1f1f] border border-slate-200 dark:border-[#2e2e2e] text-xs font-semibold font-mono tabular-nums text-emerald-600 dark:text-[#3ecf8e]">
              {formatINR(totalSplitAmount)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
