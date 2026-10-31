import React from 'react';
import { cn } from '@/lib/utils';

export interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
  badge?: string;
  badgeColor?: 'emerald' | 'amber' | 'blue' | 'rose' | 'neutral';
  statusText?: React.ReactNode;
  statusDotColor?: string;
  icon?: React.ElementType;
  className?: string;
  onClick?: () => void;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  subValue,
  badge,
  badgeColor = 'neutral',
  statusText,
  statusDotColor,
  icon: Icon,
  className,
  onClick,
}) => {
  const badgeClasses: Record<string, string> = {
    emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-[#3ecf8e] border-emerald-500/20',
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
    blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
    rose: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20',
    neutral: 'bg-slate-100 dark:bg-[#202024] text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-[#2e2e32]',
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        'p-3.5 sm:p-4 rounded-[12px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#242424]',
        'space-y-1.5 font-sans transition-all duration-200 select-none min-w-0 overflow-hidden shadow-2xs',
        'hover:border-slate-300 dark:hover:border-[#333333] hover:shadow-xs',
        onClick && 'cursor-pointer active:scale-[0.98]',
        className
      )}
    >
      {/* Top Header: Label & Icon / Badge */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <span className="text-[10px] sm:text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-zinc-400 font-semibold truncate">
          {label}
        </span>
        {badge ? (
          <span
            className={cn(
              'px-1.5 sm:px-2 py-0.5 rounded-[4px] text-[9px] sm:text-[10px] font-mono border font-medium shrink-0 whitespace-nowrap',
              badgeClasses[badgeColor]
            )}
          >
            {badge}
          </span>
        ) : Icon ? (
          <div className="w-6 h-6 rounded-[6px] bg-slate-50 dark:bg-[#1c1c1f] border border-slate-100 dark:border-[#26262a] flex items-center justify-center shrink-0">
            <Icon className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" />
          </div>
        ) : null}
      </div>

      {/* Main Metric Value */}
      <div
        title={typeof value === 'string' || typeof value === 'number' ? String(value) : undefined}
        className="text-lg sm:text-xl lg:text-[22px] font-medium font-mono text-slate-900 dark:text-white tabular-nums tracking-tight truncate"
      >
        {value}
      </div>

      {/* Footer Meta / Status with live dot */}
      {(subValue || statusText) && (
        <div className="text-[10.5px] sm:text-[11px] text-slate-500 dark:text-[#8e8e93] font-sans pt-0.5 truncate flex items-center gap-1.5">
          {statusDotColor && (
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0 shadow-xs"
              style={{ backgroundColor: statusDotColor }}
            />
          )}
          <span className="truncate">{statusText || subValue}</span>
        </div>
      )}
    </div>
  );
};
