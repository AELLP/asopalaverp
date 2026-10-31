import React, { useMemo, useState } from 'react';
import { ExpenseVoucher } from '@/types/database';
import { formatINR, cn, triggerHaptic } from '@/lib/utils';
import { Clock, Flame, Info, ChevronDown, ChevronUp } from 'lucide-react';

interface HourlyHeatmapWidgetProps {
  vouchers: ExpenseVoucher[];
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Showroom active operational hours: 10:00 AM to 9:00 PM (10 to 21, exactly 12 hours)
const HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

const HOUR_LABELS: Record<number, string> = {
  10: '10a',
  11: '11a',
  12: '12p',
  13: '1p',
  14: '2p',
  15: '3p',
  16: '4p',
  17: '5p',
  18: '6p',
  19: '7p',
  20: '8p',
  21: '9p',
};

export const HourlyHeatmapWidget: React.FC<HourlyHeatmapWidgetProps> = ({ vouchers }) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const { grid, maxCount, peakSlot, totalActiveBills } = useMemo(() => {
    // 7 rows (0 = Monday, 6 = Sunday), 12 cols (10 to 21)
    const matrix: Array<Array<{ count: number; amount: number }>> = Array.from({ length: 7 }, () =>
      Array.from({ length: HOURS.length }, () => ({ count: 0, amount: 0 }))
    );

    let max = 0;
    let totalBills = 0;
    let peak = { day: 'Saturday', hour: 11, count: 0, amount: 0 };

    vouchers.forEach((v) => {
      if (
        v.status === 'Voided' ||
        v.status === 'Pending_Approval' ||
        v.payment_type === 'Advance_Settlement'
      ) {
        return;
      }

      const timestamp = v.created_at || v.payment_date;
      if (!timestamp) return;

      const dateObj = new Date(timestamp);
      if (isNaN(dateObj.getTime())) return;

      const jsDay = dateObj.getDay();
      const dayIndex = jsDay === 0 ? 6 : jsDay - 1; // Mon = 0, Sun = 6

      const hour = dateObj.getHours();
      const normalizedHour = Math.max(10, Math.min(21, hour));
      const hourIndex = HOURS.indexOf(normalizedHour);

      if (hourIndex !== -1 && dayIndex >= 0 && dayIndex < 7) {
        const cell = matrix[dayIndex][hourIndex];
        cell.count += 1;
        cell.amount += Number(v.total_amount) || 0;
        totalBills += 1;

        if (cell.count > max) {
          max = cell.count;
        }

        if (cell.amount > peak.amount) {
          peak = {
            day: DAYS[dayIndex],
            hour: normalizedHour,
            count: cell.count,
            amount: cell.amount,
          };
        }
      }
    });

    return { grid: matrix, maxCount: max, peakSlot: peak, totalActiveBills: totalBills };
  }, [vouchers]);

  // Color generator based on intensity
  const getCellColor = (count: number) => {
    if (count === 0) return 'bg-slate-100/60 dark:bg-[#181818] border-slate-200/40 dark:border-[#222222] text-transparent';
    if (!maxCount || maxCount <= 1) return 'bg-[#3ecf8e]/25 border-[#3ecf8e]/40 text-emerald-800 dark:text-[#3ecf8e]';

    const ratio = count / maxCount;
    if (ratio < 0.25) return 'bg-[#3ecf8e]/20 border-[#3ecf8e]/35 text-emerald-800 dark:text-[#3ecf8e] font-medium';
    if (ratio < 0.5) return 'bg-[#3ecf8e]/40 border-[#3ecf8e]/55 text-emerald-950 dark:text-emerald-100 font-bold';
    if (ratio < 0.75) return 'bg-[#3ecf8e]/70 border-[#3ecf8e]/80 text-slate-950 font-bold shadow-xs';
    return 'bg-[#3ecf8e] text-slate-950 font-black border-[#2fb379] shadow-xs';
  };

  const formatHourDisplay = (h: number) => {
    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h > 12 ? h - 12 : h;
    return `${displayH}:00 ${period}`;
  };

  return (
    <div className="p-4 sm:p-5 bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424] rounded-[12px] space-y-3 shadow-sm h-full flex flex-col justify-between">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-100 dark:border-[#242424]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-[6px] bg-slate-100 dark:bg-[#1f1f1f] border border-slate-200 dark:border-[#2e2e2e] text-slate-600 dark:text-[#A1A1A1] flex items-center justify-center shrink-0">
            <Clock className="w-4 h-4 text-[#3ecf8e]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-medium tracking-tight text-slate-900 dark:text-white font-sans truncate">
                Disbursement Peak Hour Heatmap
              </h3>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] shrink-0 font-medium">
                10 AM – 9 PM
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-[#A1A1A1] truncate">
              Peak cash rush slots across {totalActiveBills} showroom bills
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {peakSlot.count > 0 && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-[11px] font-mono font-medium">
              <Flame className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>
                Peak: {peakSlot.day} @ {formatHourDisplay(peakSlot.hour)} ({formatINR(peakSlot.amount)})
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              triggerHaptic('light');
              setIsExpanded(!isExpanded);
            }}
            className="p-1 rounded-[6px] text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#202020] transition-colors cursor-pointer"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Heatmap Grid Content */}
      {isExpanded && (
        <div className="space-y-2 flex-1 flex flex-col justify-center">
          <div className="overflow-x-auto scrollbar-none">
            <div className="min-w-[420px] space-y-1">
              {/* Header Hours Labels */}
              <div className="flex items-center text-[10px] font-mono text-slate-400 dark:text-zinc-500 pb-0.5">
                <span className="w-8 shrink-0 text-left font-sans text-[10px]">Day</span>
                <div
                  className="flex-1 grid gap-1 text-center"
                  style={{ gridTemplateColumns: 'repeat(12, minmax(0, 1fr))' }}
                >
                  {HOURS.map((h) => (
                    <span key={h} className="truncate text-[9.5px]">
                      {HOUR_LABELS[h]}
                    </span>
                  ))}
                </div>
              </div>

              {/* Matrix Rows (7 Days) */}
              {DAYS.map((dayName, dayIdx) => (
                <div key={dayName} className="flex items-center text-xs">
                  <span className="w-8 shrink-0 text-[10.5px] font-mono font-medium text-slate-500 dark:text-zinc-400">
                    {dayName}
                  </span>
                  <div
                    className="flex-1 grid gap-1"
                    style={{ gridTemplateColumns: 'repeat(12, minmax(0, 1fr))' }}
                  >
                    {HOURS.map((hour, hourIdx) => {
                      const cell = grid[dayIdx][hourIdx];
                      const hasData = cell && cell.count > 0;
                      return (
                        <div
                          key={hour}
                          title={`${dayName} @ ${formatHourDisplay(hour)}: ${cell.count} ${cell.count === 1 ? 'bill' : 'bills'} (${formatINR(cell.amount)})`}
                          className={cn(
                            'h-5.5 sm:h-6 rounded-[3px] border flex items-center justify-center text-[9.5px] font-mono transition-all cursor-default select-none group relative',
                            getCellColor(cell.count)
                          )}
                        >
                          {hasData ? (
                            <span>{cell.count}</span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Heatmap Legend */}
          <div className="pt-2 border-t border-slate-100 dark:border-[#242424] flex items-center justify-between gap-2 text-[10.5px] font-sans text-slate-500 dark:text-zinc-400">
            <div className="flex items-center gap-1.5 truncate">
              <Info className="w-3.5 h-3.5 text-[#3ecf8e] shrink-0" />
              <span className="truncate">Darker green indicates heavier disbursement frequency</span>
            </div>
            <div className="flex items-center gap-1 font-mono text-[9.5px] shrink-0">
              <span className="hidden sm:inline">0</span>
              <span className="w-2.5 h-2.5 rounded-[2px] bg-slate-100 dark:bg-[#181818] border border-slate-200/50 dark:border-[#222]" />
              <span className="w-2.5 h-2.5 rounded-[2px] bg-[#3ecf8e]/25 border border-[#3ecf8e]/40" />
              <span className="w-2.5 h-2.5 rounded-[2px] bg-[#3ecf8e]/50 border border-[#3ecf8e]/60" />
              <span className="w-2.5 h-2.5 rounded-[2px] bg-[#3ecf8e] border border-[#2fb379]" />
              <span className="hidden sm:inline">Rush</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
