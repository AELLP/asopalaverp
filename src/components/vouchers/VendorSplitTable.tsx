import React from 'react';
import { ExpenseCategory, Department, VendorSplitItem } from '@/types/database';
import { Plus, Trash2, Store, Calculator } from 'lucide-react';
import { formatINR } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

interface VendorSplitTableProps {
  splits: VendorSplitItem[];
  categories: ExpenseCategory[];
  departments: Department[];
  targetAmount?: number;
  onChange: (splits: VendorSplitItem[]) => void;
}

export const VendorSplitTable: React.FC<VendorSplitTableProps> = ({
  splits,
  categories,
  departments,
  targetAmount,
  onChange,
}) => {
  const handleAddRow = () => {
    const newRow: VendorSplitItem = {
      vendor_name: '',
      category_name: '',
      department_name: '',
      bill_number: '',
      description: '',
      amount: 0,
    };
    onChange([...splits, newRow]);
  };

  const handleRemoveRow = (index: number) => {
    onChange(splits.filter((_, idx) => idx !== index));
  };

  const handleUpdateRow = (index: number, field: keyof VendorSplitItem, value: any) => {
    const updated = [...splits];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const handleSplitEvenly = () => {
    if (splits.length === 0) return;
    const baseTotal = targetAmount || splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    if (baseTotal <= 0) return;

    const perVendor = Math.floor(baseTotal / splits.length);
    const remainder = baseTotal - perVendor * splits.length;

    const updated = splits.map((item, idx) => ({
      ...item,
      amount: idx === 0 ? perVendor + remainder : perVendor,
    }));
    onChange(updated);
  };

  const totalSplitAmount = splits.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

  return (
    <div className="space-y-3.5 font-sans">
      {/* Top Banner & Control Bar */}
      <div className="p-3.5 sm:p-4 rounded-[12px] bg-slate-50/60 dark:bg-[#141414] border border-slate-200 dark:border-[#262626] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-[6px] bg-[#3ecf8e]/10 text-emerald-600 dark:text-[#3ecf8e] border border-[#3ecf8e]/25 flex items-center justify-center shrink-0">
            <Store className="w-4 h-4 stroke-[2.2]" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-slate-900 dark:text-white font-sans tracking-tight">
              Multi-Vendor &amp; Itemized Expense Breakdown
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-sans mt-0.5">
              Combine multiple shop vendor bills &amp; items under this single payment voucher with separate billing line items.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {splits.length > 1 && (
            <button
              type="button"
              onClick={handleSplitEvenly}
              className="h-10 min-h-[40px] px-3.5 rounded-[6px] bg-white dark:bg-[#1f1f1f] text-slate-700 dark:text-[#EDEDED] hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-[#2e2e2e] hover:border-slate-300 dark:hover:border-[#383838] text-xs font-medium font-sans flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              title="Distribute amount evenly across all added vendors"
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
            <span>Vendor / Item</span>
          </button>
        </div>
      </div>

      {/* Multi-Vendor Table Container */}
      <div className="rounded-[12px] border border-slate-200 dark:border-[#262626] bg-white dark:bg-[#161616] overflow-visible shadow-xs">
        {/* Desktop Column Header */}
        <div className="hidden sm:grid grid-cols-12 gap-2 text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-[#a1a1a1] bg-slate-50/80 dark:bg-[#141414] px-4 py-2.5 border-b border-slate-200 dark:border-[#262626] rounded-t-[12px]">
          <div className="col-span-1">#</div>
          <div className="col-span-3">Vendor / Shop Name *</div>
          <div className="col-span-2">Category *</div>
          <div className="col-span-2">Department *</div>
          <div className="col-span-2">Bill No. / Particulars</div>
          <div className="col-span-2 text-right">Amount (₹) *</div>
        </div>

        {/* Desktop Rows (sm+) */}
        <div className="hidden sm:block">
          {splits.map((row, idx) => {
            return (
              <div
                key={idx}
                className="relative focus-within:z-50 hover:z-20 grid grid-cols-12 gap-2 items-center px-4 py-2.5 hover:bg-slate-50/70 dark:hover:bg-[#1c1c1c] transition-colors border-b border-slate-100 dark:border-[#222222] last:border-b-0"
              >
                <div className="col-span-1 text-xs font-mono font-medium text-slate-400 dark:text-zinc-500 tabular-nums">
                  #{idx + 1}
                </div>

                {/* Vendor / Shop Name */}
                <div className="col-span-3">
                  <input
                    type="text"
                    required
                    value={row.vendor_name}
                    onChange={(e) => handleUpdateRow(idx, 'vendor_name', e.target.value)}
                    placeholder="e.g. Ramesh Chai / Shrinathji Sweets"
                    className="w-full bg-slate-50/60 dark:bg-[#121212] border border-slate-200 dark:border-[#262626] rounded-[6px] px-2.5 py-1.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 font-sans"
                  />
                </div>

                {/* Expense Category */}
                <div className="col-span-2">
                  <SearchableSelect
                    value={row.category_name}
                    onChange={(val) => handleUpdateRow(idx, 'category_name', val)}
                    options={categories.map((c) => ({
                      value: c.category_name,
                      label: c.category_name,
                    }))}
                    placeholder="Category..."
                    allowCustom={false}
                  />
                </div>

                {/* Department */}
                <div className="col-span-2">
                  <SearchableSelect
                    value={row.department_name}
                    onChange={(val) => handleUpdateRow(idx, 'department_name', val)}
                    options={departments.map((d) => ({
                      value: d.department_name,
                      label: d.department_name,
                    }))}
                    placeholder="Dept..."
                    allowCustom={false}
                  />
                </div>

                {/* Bill No / Description */}
                <div className="col-span-2">
                  <input
                    type="text"
                    value={row.bill_number || row.description || ''}
                    onChange={(e) => handleUpdateRow(idx, 'bill_number', e.target.value)}
                    placeholder="Bill / memo no. (opt)"
                    className="w-full bg-slate-50/60 dark:bg-[#121212] border border-slate-200 dark:border-[#262626] rounded-[6px] px-2.5 py-1.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 font-mono text-[11px]"
                  />
                </div>

                {/* Amount */}
                <div className="col-span-2 flex items-center gap-1.5 justify-end">
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
                      className="w-full h-10 min-h-[40px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[6px] pl-6 pr-2 text-xs font-mono tabular-nums font-semibold text-right text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-[#3ecf8e] dark:focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 shadow-2xs"
                    />
                  </div>
                  {splits.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(idx)}
                      className="p-1.5 rounded-[4px] hover:bg-rose-50 dark:hover:bg-rose-500/10 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer shrink-0"
                      title="Remove vendor line"
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
                  <span className="text-xs font-mono font-medium text-slate-600 dark:text-zinc-400 flex items-center gap-1.5">
                    <Store className="w-3.5 h-3.5 text-emerald-600 dark:text-[#3ecf8e]" />
                    <span>Vendor #{idx + 1}</span>
                  </span>
                  {splits.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(idx)}
                      className="p-1 rounded-[4px] hover:bg-rose-50 dark:hover:bg-rose-500/10 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                      title="Remove vendor line"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-slate-700 dark:text-zinc-300">
                    Vendor / Shop Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={row.vendor_name}
                    onChange={(e) => handleUpdateRow(idx, 'vendor_name', e.target.value)}
                    placeholder="e.g. Ramesh Chai / Shrinathji Sweets"
                    className="w-full h-10 min-h-[40px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[6px] px-3 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 font-sans shadow-2xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-zinc-300">
                      Category *
                    </label>
                    <SearchableSelect
                      value={row.category_name}
                      onChange={(val) => handleUpdateRow(idx, 'category_name', val)}
                      options={categories.map((c) => ({
                        value: c.category_name,
                        label: c.category_name,
                      }))}
                      placeholder="Category..."
                      allowCustom={false}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-zinc-300">
                      Department *
                    </label>
                    <SearchableSelect
                      value={row.department_name}
                      onChange={(val) => handleUpdateRow(idx, 'department_name', val)}
                      options={departments.map((d) => ({
                        value: d.department_name,
                        label: d.department_name,
                      }))}
                      placeholder="Dept..."
                      allowCustom={false}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-zinc-300">
                      Bill No. / Memo
                    </label>
                    <input
                      type="text"
                      value={row.bill_number || ''}
                      onChange={(e) => handleUpdateRow(idx, 'bill_number', e.target.value)}
                      placeholder="Optional"
                      className="w-full h-10 min-h-[40px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[6px] px-3 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 font-mono focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 shadow-2xs"
                    />
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
                        className="w-full h-10 min-h-[40px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-[6px] pl-7 pr-3 text-xs font-mono tabular-nums font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 shadow-2xs"
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {splits.length === 0 && (
          <div className="py-10 text-center text-xs font-sans text-slate-500 dark:text-zinc-400">
            No vendor items added yet. Click &ldquo;+ Vendor / Item&rdquo; above to start itemized bill entry.
          </div>
        )}

        {/* Summary Footer */}
        <div className="px-4 py-3 bg-slate-50/80 dark:bg-[#141414] border-t border-slate-200 dark:border-[#262626] rounded-b-[12px] flex items-center justify-between text-xs font-sans">
          <span className="text-slate-500 dark:text-zinc-400 font-mono text-[11px]">
            Vendors / Items:{' '}
            <span className="font-semibold text-slate-800 dark:text-zinc-200">
              {splits.length} {splits.length === 1 ? 'item' : 'items'}
            </span>
          </span>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 dark:text-zinc-400 font-medium font-sans">Total Payout:</span>
            <span className="px-2.5 py-1 rounded-[4px] bg-white dark:bg-[#1f1f1f] border border-slate-200 dark:border-[#2e2e2e] text-xs font-semibold font-mono tabular-nums text-emerald-600 dark:text-[#3ecf8e]">
              {formatINR(totalSplitAmount)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
