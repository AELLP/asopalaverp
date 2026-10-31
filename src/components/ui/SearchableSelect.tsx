import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ChevronDown, Search, X, Check, Plus } from 'lucide-react';
import { cn, triggerHaptic } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  subLabel?: string | null;
  sublabel?: string | null;
  badge?: string | null;
  icon?: React.ComponentType<{ className?: string }>;
}

export interface SearchableSelectProps {
  options: (SelectOption | string)[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  error?: string;
  hint?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  wrapperClassName?: string;
  triggerClassName?: string;
  popupClassName?: string;
  disabled?: boolean;
  clearable?: boolean;
  required?: boolean;
  id?: string;
  allowCustom?: boolean;
  size?: 'sm' | 'md' | 'lg';
  align?: 'left' | 'right';
  placement?: 'bottom' | 'top' | 'auto';
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options = [],
  value = '',
  onChange,
  label,
  error,
  hint,
  placeholder = 'Select option...',
  searchPlaceholder = 'Type to search...',
  className,
  wrapperClassName,
  triggerClassName,
  popupClassName,
  disabled = false,
  clearable = false,
  id,
  allowCustom = false,
  size = 'md',
  align = 'left',
  placement = 'auto',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [computedPlacement, setComputedPlacement] = useState<'top' | 'bottom'>('bottom');

  const instanceIdRef = useRef('select-' + Math.random().toString(36).substring(2, 9));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Normalize options safely to SelectOption[] (handles null, undefined, strings, numbers, objects)
  const normalizedOptions: SelectOption[] = useMemo(() => {
    if (!Array.isArray(options)) return [];
    return options
      .filter((opt) => opt !== null && opt !== undefined)
      .map((opt) => {
        if (typeof opt === 'string' || typeof opt === 'number') {
          const str = String(opt);
          return { value: str, label: str };
        }
        const val = String(opt.value ?? '');
        const lbl = String(opt.label ?? opt.value ?? '');
        const sub = opt.subLabel ?? opt.sublabel ?? undefined;
        return {
          value: val,
          label: lbl,
          subLabel: sub,
          badge: opt.badge ?? undefined,
          icon: opt.icon,
        };
      });
  }, [options]);

  // Safe search query matching
  const filteredOptions = useMemo(() => {
    if (!search.trim()) return normalizedOptions;
    const q = search.trim().toLowerCase();
    return normalizedOptions.filter((opt) => {
      const labelMatch = String(opt.label || '').toLowerCase().includes(q);
      const valueMatch = String(opt.value || '').toLowerCase().includes(q);
      const sub = opt.subLabel || opt.sublabel;
      const subMatch = sub ? String(sub).toLowerCase().includes(q) : false;
      const badgeMatch = opt.badge ? String(opt.badge).toLowerCase().includes(q) : false;
      return labelMatch || valueMatch || subMatch || badgeMatch;
    });
  }, [normalizedOptions, search]);

  const selectedOption = useMemo(() => {
    const safeVal = String(value ?? '');
    return normalizedOptions.find((opt) => opt.value === safeVal);
  }, [normalizedOptions, value]);

  // Global event: close this dropdown if another dropdown opens
  useEffect(() => {
    const handleGlobalOpen = (e: Event) => {
      const customEvt = e as CustomEvent<string>;
      if (customEvt.detail !== instanceIdRef.current) {
        setIsOpen(false);
      }
    };

    window.addEventListener('asopalav:dropdown-open', handleGlobalOpen);
    return () => window.removeEventListener('asopalav:dropdown-open', handleGlobalOpen);
  }, []);

  // When isOpen changes, notify other dropdowns if opening, and focus search
  const handleToggleOpen = useCallback((openState: boolean) => {
    if (disabled) return;
    if (openState) {
      if (placement === 'top') {
        setComputedPlacement('top');
      } else if (placement === 'bottom') {
        setComputedPlacement('bottom');
      } else {
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          const spaceBelow = window.innerHeight - rect.bottom;
          const spaceAbove = rect.top;
          if (spaceBelow < 250 && spaceAbove > spaceBelow) {
            setComputedPlacement('top');
          } else {
            setComputedPlacement('bottom');
          }
        } else {
          setComputedPlacement('bottom');
        }
      }
      triggerHaptic('selection');
      window.dispatchEvent(
        new CustomEvent('asopalav:dropdown-open', { detail: instanceIdRef.current })
      );
    }
    setIsOpen(openState);
  }, [disabled, placement]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setHighlightedIndex(0);
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Close dropdown on outside click (supports mouse, touch, stylus)
  useEffect(() => {
    if (!isOpen) return;

    function handleOutsideClick(event: MouseEvent | TouchEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener('pointerdown', handleOutsideClick as any);
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick as any);
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        handleToggleOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < filteredOptions.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredOptions.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredOptions[highlightedIndex]) {
          triggerHaptic('selection');
          onChange(filteredOptions[highlightedIndex].value);
          setIsOpen(false);
        } else if (allowCustom && search.trim()) {
          triggerHaptic('selection');
          onChange(search.trim());
          setIsOpen(false);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        break;
      case 'Tab':
        setIsOpen(false);
        break;
    }
  };

  const handleSelect = (val: string) => {
    triggerHaptic('selection');
    onChange(val);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic('light');
    onChange('');
  };

  const isExactMatch = useMemo(() => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return normalizedOptions.some(
      (opt) =>
        String(opt.value || '').toLowerCase() === q ||
        String(opt.label || '').toLowerCase() === q
    );
  }, [normalizedOptions, search]);

  return (
    <div className={cn('w-full font-sans', (label || hint) && 'space-y-1.5', wrapperClassName)}>
      {(label || hint) && (
        <div className="flex items-center justify-between">
          {label && (
            <label htmlFor={id} className="block text-xs font-semibold text-slate-900 dark:text-gray-100 font-sans">
              {label}
            </label>
          )}
          {hint && (
            <span className="text-[11px] text-slate-500 dark:text-gray-400 font-sans">
              {hint}
            </span>
          )}
        </div>
      )}
      <div
        ref={containerRef}
        className={cn('relative w-full text-xs font-sans', isOpen ? 'z-[9999]' : 'z-auto', className)}
        onKeyDown={handleKeyDown}
      >
        {/* Trigger Button (Supabase Studio Standard Select) */}
        <button
          type="button"
          id={id}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={label || placeholder}
          disabled={disabled}
          onClick={() => handleToggleOpen(!isOpen)}
          className={cn(
            'w-full flex items-center justify-between text-left rounded-[6px] transition-colors cursor-pointer select-none text-xs font-sans shadow-2xs',
            size === 'sm' ? 'h-[34px] min-h-[34px] px-2.5' : size === 'lg' ? 'h-[44px] min-h-[44px] px-3.5' : 'h-10 min-h-[40px] px-3.5',
            'bg-white dark:bg-[#181818] text-slate-900 dark:text-[#EDEDED]',
            'border border-slate-200 dark:border-[#282828]',
            'hover:bg-slate-50 dark:hover:bg-[#202020] hover:border-slate-300 dark:hover:border-[#383838]',
            'focus:outline-none focus:border-[#3ecf8e] dark:focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30',
            disabled && 'opacity-50 cursor-not-allowed bg-slate-100 dark:bg-[#1c1c1c]',
            isOpen && 'border-[#3ecf8e] dark:border-[#3ecf8e] ring-1 ring-[#3ecf8e]/30',
            triggerClassName
          )}
        >
          <span className="truncate pr-2">
            {selectedOption ? (
              <span className="font-medium text-slate-900 dark:text-white">{selectedOption.label}</span>
            ) : value ? (
              <span className="font-medium text-slate-900 dark:text-white">{String(value)}</span>
            ) : (
              <span className="text-slate-400 dark:text-[#707070]">{placeholder}</span>
            )}
          </span>

          <div className="flex items-center gap-1.5 shrink-0">
            {clearable && value && value !== 'ALL' && value !== 'all' && !disabled && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Clear selection"
                onClick={handleClear}
                className="p-0.5 rounded-[4px] hover:bg-slate-200/80 dark:hover:bg-white/10 text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </span>
            )}
            <ChevronDown
              className={cn(
                'w-3.5 h-3.5 text-slate-400 dark:text-[#707070] transition-transform duration-150',
                isOpen && 'rotate-180 text-emerald-600 dark:text-[#3ecf8e]'
              )}
            />
          </div>
        </button>

        {/* Dropdown Popup (Solid High Elevation Studio Menu) */}
        {isOpen && (
          <div
            className={cn(
              'absolute z-[9999] rounded-[6px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] shadow-2xl overflow-hidden w-full left-0 right-0 animate-in fade-in zoom-in-95 duration-100',
              computedPlacement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1',
              size === 'sm' ? 'min-w-[120px]' : 'min-w-[200px]',
              align === 'right' && 'right-0 left-auto',
              popupClassName
            )}
          >
            {/* Search Input Box (only shown if more than 5 options) */}
            {normalizedOptions.length > 5 && (
              <div className="p-2 border-b border-slate-100 dark:border-[#242424] bg-slate-50 dark:bg-[#141414]">
                <div className="relative flex items-center">
                  <Search className="w-3.5 h-3.5 text-slate-400 dark:text-[#707070] absolute left-2.5 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    aria-label={searchPlaceholder}
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setHighlightedIndex(0);
                    }}
                    placeholder={searchPlaceholder}
                    className="w-full bg-white dark:bg-[#1c1c1c] text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-[#707070] text-xs pl-8 pr-3 py-1.5 rounded-[6px] border border-slate-200 dark:border-[#282828] focus:outline-none focus:border-[#3ecf8e] dark:focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 transition-colors font-sans min-h-[30px]"
                  />
                </div>
              </div>
            )}

            {/* Custom Input Quick Pick */}
            {allowCustom && search.trim() && !isExactMatch && (
              <div className="p-1.5 border-b border-slate-100 dark:border-[#242424] bg-[#3ecf8e]/5">
                <button
                  type="button"
                  onClick={() => handleSelect(search.trim())}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[4px] text-xs font-sans font-semibold text-emerald-700 dark:text-[#3ecf8e] hover:bg-[#3ecf8e]/15 transition-colors cursor-pointer text-left"
                >
                  <div className="flex items-center gap-2 truncate">
                    <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Use &ldquo;<span className="font-bold">{search.trim()}</span>&rdquo;</span>
                  </div>
                  <span className="text-[10px] font-mono uppercase bg-[#3ecf8e]/20 text-emerald-800 dark:text-[#3ecf8e] px-1.5 py-0.5 rounded-[4px]">
                    Custom
                  </span>
                </button>
              </div>
            )}

            {/* Options List */}
            <div ref={listRef} role="listbox" className="max-h-60 overflow-y-auto p-1 space-y-0.5">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((opt, idx) => {
                  const isSelected = opt.value === String(value ?? '');
                  const isHighlighted = idx === highlightedIndex;
                  const sub = opt.subLabel || opt.sublabel;

                  return (
                    <div
                      key={`${opt.value}-${idx}`}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelect(opt.value)}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      className={cn(
                        'flex items-center justify-between px-2.5 py-1.5 rounded-[4px] text-xs cursor-pointer transition-colors group select-none font-sans min-h-[30px]',
                        isSelected
                          ? 'bg-[#3ecf8e]/10 text-emerald-700 dark:text-[#3ecf8e] font-semibold border border-[#3ecf8e]/20'
                          : isHighlighted
                          ? 'bg-slate-100 dark:bg-[#222222] text-slate-900 dark:text-white font-medium'
                          : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#222222] hover:text-slate-900 dark:hover:text-white'
                      )}
                    >
                      <div className="flex items-center gap-2 truncate pr-2 flex-1 min-w-0">
                        {opt.icon && (
                          <opt.icon className="w-3.5 h-3.5 text-slate-400 dark:text-[#707070] shrink-0" />
                        )}
                        <div className="truncate flex-1 min-w-0">
                          <div className={cn("truncate font-sans", isSelected ? "font-semibold text-emerald-700 dark:text-[#3ecf8e]" : "")}>
                            {opt.label}
                          </div>
                          {sub && (
                            <div className="text-[10px] text-slate-400 dark:text-[#707070] font-mono truncate">
                              {sub}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 ml-1.5">
                        {opt.badge && (
                          <span className="px-1.5 py-0.5 rounded-[4px] text-[10px] font-mono bg-slate-100 dark:bg-[#242424] text-slate-600 dark:text-[#A1A1A1] border border-slate-200 dark:border-[#303030] whitespace-nowrap font-medium">
                            {opt.badge}
                          </span>
                        )}
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-[#3ecf8e] stroke-[2.5]" />
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-4 px-3 text-center text-xs text-slate-400 dark:text-[#707070] font-sans">
                  {allowCustom && search.trim() ? (
                    <button
                      type="button"
                      onClick={() => handleSelect(search.trim())}
                      className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-[#3ecf8e] hover:underline font-semibold cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Click to use &ldquo;{search.trim()}&rdquo;</span>
                    </button>
                  ) : (
                    <span>No matches found</span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {error && <p className="text-[11px] text-rose-500 font-mono font-medium">{error}</p>}
    </div>
  );
};
