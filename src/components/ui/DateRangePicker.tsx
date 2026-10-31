import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  format,
  parseISO,
  isValid,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,  isToday,
  addMonths,
  subMonths,
  subDays,
} from 'date-fns';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,  X,
  Check,} from 'lucide-react';
import { cn, triggerHaptic } from '@/lib/utils';

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export interface DateRangePreset {
  id: string;
  label: string;
  getRange: () => DateRange;
}

export interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onChange: (range: DateRange) => void;
  presets?: DateRangePreset[];
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  align?: 'left' | 'right';
  disabled?: boolean;
}

export const DEFAULT_PRESETS: DateRangePreset[] = [
  {
    id: 'today',
    label: 'Today',
    getRange: () => {
      const now = format(new Date(), 'yyyy-MM-dd');
      return { startDate: now, endDate: now };
    },
  },
  {
    id: 'yesterday',
    label: 'Yesterday',
    getRange: () => {
      const y = format(subDays(new Date(), 1), 'yyyy-MM-dd');
      return { startDate: y, endDate: y };
    },
  },
  {
    id: 'last_7_days',
    label: '7 Days',
    getRange: () => {
      const now = new Date();
      return {
        startDate: format(subDays(now, 6), 'yyyy-MM-dd'),
        endDate: format(now, 'yyyy-MM-dd'),
      };
    },
  },
  {
    id: 'this_month',
    label: 'This Month',
    getRange: () => {
      const now = new Date();
      return {
        startDate: format(startOfMonth(now), 'yyyy-MM-dd'),
        endDate: format(now, 'yyyy-MM-dd'),
      };
    },
  },
  {
    id: 'last_month',
    label: 'Last Month',
    getRange: () => {
      const prev = subMonths(new Date(), 1);
      return {
        startDate: format(startOfMonth(prev), 'yyyy-MM-dd'),
        endDate: format(endOfMonth(prev), 'yyyy-MM-dd'),
      };
    },
  },
  {
    id: 'all_time',
    label: 'All Time',
    getRange: () => {
      const now = new Date();
      return {
        startDate: '2024-01-01',
        endDate: format(now, 'yyyy-MM-dd'),
      };
    },
  },
];

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  startDate,
  endDate,
  onChange,
  presets = DEFAULT_PRESETS,
  placeholder = 'Select date range...',
  className,
  size = 'md',
  align = 'left',
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Temporary selection state while interacting with the calendar
  const [tempStart, setTempStart] = useState<string>(startDate);
  const [tempEnd, setTempEnd] = useState<string>(endDate);
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  // Active view month (single clean calendar)
  const initialMonth = useMemo(() => {
    if (startDate && isValid(parseISO(startDate))) {
      return parseISO(startDate);
    }
    return new Date();
  }, [startDate]);

  const [viewMonth, setViewMonth] = useState<Date>(initialMonth);

  // Synchronize internal state when props change
  useEffect(() => {
    setTempStart(startDate);
    setTempEnd(endDate);
    if (startDate && isValid(parseISO(startDate))) {
      setViewMonth(parseISO(startDate));
    }
  }, [startDate, endDate]);

  // Handle outside click & escape key
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleOpen = () => {
    if (disabled) return;
    setTempStart(startDate);
    setTempEnd(endDate);
    setHoverDate(null);
    if (startDate && isValid(parseISO(startDate))) {
      setViewMonth(parseISO(startDate));
    }
    setIsOpen(!isOpen);
    triggerHaptic('light');
  };

  const nextMonth = () => {
    setViewMonth((prev) => addMonths(prev, 1));
    triggerHaptic('selection');
  };

  const prevMonth = () => {
    setViewMonth((prev) => subMonths(prev, 1));
    triggerHaptic('selection');
  };

  // Click on a calendar day
  const handleDateClick = (dateStr: string) => {
    triggerHaptic('selection');

    // Case 1: Starting fresh or already had a full range selected
    if (!tempStart || (tempStart && tempEnd)) {
      setTempStart(dateStr);
      setTempEnd('');
      setHoverDate(null);
      return;
    }

    // Case 2: User has start date, now selecting end date
    if (tempStart && !tempEnd) {
      if (dateStr < tempStart) {
        // If clicked earlier than start date, treat clicked date as new start date
        setTempStart(dateStr);
        setTempEnd('');
      } else {
        // Valid end date
        setTempEnd(dateStr);
        setHoverDate(null);
      }
    }
  };

  // Quick Preset Selection (instant apply)
  const handleApplyPreset = (preset: DateRangePreset) => {
    triggerHaptic('success');
    const range = preset.getRange();
    setTempStart(range.startDate);
    setTempEnd(range.endDate);
    if (isValid(parseISO(range.startDate))) {
      setViewMonth(parseISO(range.startDate));
    }
    onChange(range);
    setIsOpen(false);
  };

  // Final apply
  const handleApply = () => {
    triggerHaptic('success');
    if (!tempStart) return;
    const finalEnd = tempEnd || tempStart;
    onChange({
      startDate: tempStart,
      endDate: finalEnd,
    });
    setIsOpen(false);
  };

  // Clear / Reset to today
  const handleClear = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    triggerHaptic('light');
    const today = format(new Date(), 'yyyy-MM-dd');
    setTempStart(today);
    setTempEnd(today);
    setViewMonth(new Date());
    onChange({ startDate: today, endDate: today });
  };

  // Determine active preset label (if matches any preset)
  const activePresetLabel = useMemo(() => {
    if (!startDate || !endDate) return null;
    for (const p of presets) {
      const r = p.getRange();
      if (r.startDate === startDate && r.endDate === endDate) {
        return p.label;
      }
    }
    return null;
  }, [startDate, endDate, presets]);

  // Format trigger label
  const triggerDisplay = useMemo(() => {
    if (!startDate) return placeholder;

    const startObj = parseISO(startDate);
    const endObj = endDate ? parseISO(endDate) : null;

    if (!isValid(startObj)) return placeholder;

    const sFmt = format(startObj, 'dd MMM yyyy');
    if (!endDate || startDate === endDate) {
      return sFmt;
    }

    if (endObj && isValid(endObj)) {
      const eFmt = format(endObj, 'dd MMM yyyy');
      return `${sFmt}  →  ${eFmt}`;
    }

    return sFmt;
  }, [startDate, endDate, placeholder]);

  // Days Count Helper
  const selectedDaysCount = useMemo(() => {
    if (!tempStart) return 0;
    const end = tempEnd || hoverDate || tempStart;
    if (!end) return 1;
    const s = parseISO(tempStart);
    const e = parseISO(end);
    if (!isValid(s) || !isValid(e)) return 0;
    const diff = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(1, diff + 1);
  }, [tempStart, tempEnd, hoverDate]);

  // Render Month Days (Single Calendar)
  const renderCalendar = () => {
    const monthStart = startOfMonth(viewMonth);
    const monthEnd = endOfMonth(viewMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 }); // Monday start
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: calStart, end: calEnd });

    const effectiveEnd = tempEnd || (hoverDate && hoverDate >= tempStart ? hoverDate : '');

    return (
      <div className="space-y-1">
        {/* Day of Week Header */}
        <div className="grid grid-cols-7 gap-1 text-center font-mono text-[10px] text-[#707070] font-semibold mb-1">
          {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar Day Cells */}
        <div className="grid grid-cols-7 gap-y-1 gap-x-0">
          {days.map((day) => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const isCurrentMonth = isSameMonth(day, viewMonth);
            const isStart = tempStart === dateStr;
            const isEnd = effectiveEnd === dateStr;
            const isCurrentToday = isToday(day);

            // Inside selected or hovered range
            const inRange = Boolean(
              tempStart &&
              effectiveEnd &&
              dateStr > tempStart &&
              dateStr < effectiveEnd
            );

            return (
              <div
                key={dateStr}
                className={cn(
                  'relative h-8 flex items-center justify-center',
                  inRange && 'bg-[#3ecf8e]/15 dark:bg-[#3ecf8e]/20',
                  isStart && effectiveEnd && isStart !== isEnd && 'bg-gradient-to-r from-transparent to-[#3ecf8e]/15 dark:to-[#3ecf8e]/20',
                  isEnd && tempStart && isStart !== isEnd && 'bg-gradient-to-l from-transparent to-[#3ecf8e]/15 dark:to-[#3ecf8e]/20'
                )}
                onMouseEnter={() => {
                  if (tempStart && !tempEnd) {
                    setHoverDate(dateStr);
                  }
                }}
              >
                <button
                  type="button"
                  onClick={() => handleDateClick(dateStr)}
                  className={cn(
                    'w-7 h-7 flex items-center justify-center font-mono tabular-nums text-xs rounded-[6px] transition-colors cursor-pointer select-none',
                    // Start or End Date Selected (Emerald with near-black #171717 text per erpskill.md)
                    (isStart || isEnd) &&
                      'bg-[#3ecf8e] text-[#171717] font-semibold shadow-xs z-10 hover:bg-[#24b47e]',
                    // Middle of range
                    inRange &&
                      !isStart &&
                      !isEnd &&
                      'text-[#171717] dark:text-[#ededed] font-medium hover:bg-[#3ecf8e]/30 rounded-none',
                    // Normal cell (not selected)
                    !isStart &&
                      !isEnd &&
                      !inRange && [
                        isCurrentMonth
                          ? 'text-[#171717] dark:text-[#ededed] hover:bg-[#f4f4f5] dark:hover:bg-[#202020]'
                          : 'text-[#b2b2b2] dark:text-[#525252] hover:bg-[#f4f4f5] dark:hover:bg-[#202020]',
                        isCurrentToday &&
                          'font-semibold underline decoration-[#3ecf8e] decoration-2 underline-offset-4',
                      ]
                  )}
                >
                  {format(day, 'd')}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div ref={containerRef} className={cn('relative inline-block text-left font-sans', className)}>
      {/* 1. COMPACT TRIGGER BUTTON (Supabase Studio Ergonomics) */}
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={cn(
          'group flex items-center gap-2 rounded-[6px] border transition-all cursor-pointer select-none text-left font-sans',
          size === 'sm' && 'h-[32px] px-2.5 text-xs',
          size === 'md' && 'h-[36px] px-3 text-xs',
          size === 'lg' && 'h-[40px] px-3.5 text-sm',
          isOpen
            ? 'border-[#3ecf8e] ring-1 ring-[#3ecf8e]/30 bg-white dark:bg-[#171717]'
            : 'border-[#dfdfdf] dark:border-[#282828] bg-white dark:bg-[#141414] hover:border-[#c7c7c7] dark:hover:border-[#383838] text-[#171717] dark:text-[#ededed]',
          disabled && 'opacity-50 cursor-not-allowed pointer-events-none'
        )}
      >
        <CalendarIcon className="w-3.5 h-3.5 text-[#3ecf8e] shrink-0" />

        <div className="flex items-center gap-1.5 font-mono tabular-nums">
          <span className="font-medium text-[#171717] dark:text-[#ededed]">
            {triggerDisplay}
          </span>
          {activePresetLabel && (
            <span className="px-1.5 py-0.5 rounded-[4px] bg-[#3ecf8e]/10 text-[#24b47e] dark:text-[#3ecf8e] border border-[#3ecf8e]/20 text-[10px] font-sans font-medium tracking-tight">
              {activePresetLabel}
            </span>
          )}
        </div>

        {startDate && (
          <span
            onClick={handleClear}
            className="ml-auto p-0.5 rounded-[4px] hover:bg-[#f4f4f5] dark:hover:bg-[#202020] text-[#707070] hover:text-[#171717] dark:hover:text-[#ffffff] transition-colors"
            title="Reset to Today"
          >
            <X className="w-3 h-3" />
          </span>
        )}
      </button>

      {/* 2. COMPACT SINGLE-CALENDAR POPOVER (erpskill.md 12px Container) */}
      {isOpen && (
        <div
          className={cn(
            'absolute top-full mt-1.5 z-50 w-[310px] sm:w-[320px] rounded-[12px] bg-white dark:bg-[#141414] border border-[#dfdfdf] dark:border-[#282828] shadow-2xl p-3 flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-100 select-none',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {/* Top Quick Presets Chips Bar */}
          <div className="flex flex-wrap gap-1 pb-2 border-b border-[#ededed] dark:border-[#242424]">
            {presets.map((preset) => {
              const r = preset.getRange();
              const isSelected = r.startDate === tempStart && r.endDate === (tempEnd || tempStart);
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleApplyPreset(preset)}
                  className={cn(
                    'px-2 py-1 text-[11px] font-medium rounded-[6px] transition-colors cursor-pointer font-sans',
                    isSelected
                      ? 'bg-[#3ecf8e]/15 text-[#171717] dark:text-[#3ecf8e] font-semibold border border-[#3ecf8e]/30'
                      : 'text-[#707070] dark:text-[#a1a1a1] hover:bg-[#f4f4f5] dark:hover:bg-[#202020] hover:text-[#171717] dark:hover:text-white border border-[#ededed] dark:border-[#282828]'
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          {/* Month Header Navigation */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-mono font-medium text-[#171717] dark:text-[#ededed]">
              {format(viewMonth, 'MMMM yyyy')}
            </span>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={prevMonth}
                className="p-1 rounded-[6px] hover:bg-[#f4f4f5] dark:hover:bg-[#202020] text-[#707070] dark:text-[#a1a1a1] transition-colors"
                title="Previous Month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={nextMonth}
                className="p-1 rounded-[6px] hover:bg-[#f4f4f5] dark:hover:bg-[#202020] text-[#707070] dark:text-[#a1a1a1] transition-colors"
                title="Next Month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Calendar Day Grid */}
          <div className="px-1">{renderCalendar()}</div>

          {/* Footer Toolbar: Summary & Single Emerald CTA */}
          <div className="flex items-center justify-between pt-2.5 border-t border-[#ededed] dark:border-[#242424]">
            <div className="text-[11px] font-mono tabular-nums text-[#707070] dark:text-[#a1a1a1] truncate max-w-[150px]">
              {tempStart && (
                <span>
                  {format(parseISO(tempStart), 'dd MMM')}
                  {tempEnd && tempEnd !== tempStart && ` – ${format(parseISO(tempEnd), 'dd MMM')}`}
                  {selectedDaysCount > 0 && ` (${selectedDaysCount}d)`}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="h-[28px] px-2.5 rounded-[6px] border border-[#dfdfdf] dark:border-[#282828] text-[#171717] dark:text-[#a1a1a1] hover:bg-[#f4f4f5] dark:hover:bg-[#202020] text-[11px] font-medium font-sans transition-colors cursor-pointer"
              >
                Cancel
              </button>

              {/* Single Emerald CTA: #3ecf8e with near-black #171717 text per erpskill.md */}
              <button
                type="button"
                onClick={handleApply}
                disabled={!tempStart}
                className="h-[28px] px-3 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-medium text-[11px] font-sans flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
              >
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Apply</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DateRangePicker;
