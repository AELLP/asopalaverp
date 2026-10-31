import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO } from 'date-fns';
import { Branch } from '@/types/database';

/**
 * Canonical showroom catalog covering all 9 Asopalav store branches
 */
export const DEFAULT_BRANCHES: Branch[] = [
  {
    branch_id: 'Aellp-ASI',
    branch_code: 'ASI',
    branch_name: 'Asopalav - Satellite Flagship',
    short_name: 'Satellite',
    entity_company_name: 'Asopalav Endeavours LLP',
    accountant_name: 'Hemendra Bhai',
    contact_phone: '+91 9925009050',
    contact_email: 'satellite@asopalav.com',
    city: 'Ahmedabad',
    state: 'Gujarat',
    address: 'Satellite Road, Ahmedabad - 380015',
    min_cash_threshold: 3000,
    max_cash_ceiling: 25000,
    max_upi_ceiling: 50000,
    is_active: true,
  },
];

/**
 * Normalizes any branch identifier (e.g. 'Aellp-AP', 'AP', 'aellp-ap', 'aellp-asm') into canonical uppercase code (e.g. 'AP', 'ASM', 'ASI')
 */
export function normalizeBranchCode(branchCodeOrId?: string | null): string {
  if (!branchCodeOrId || typeof branchCodeOrId !== 'string') return 'ASI';
  const clean = branchCodeOrId.trim();
  if (!clean || clean.toUpperCase() === 'ALL') return 'ALL';
  return clean.replace(/^[Aa][Ee][Ll]{2}[Pp]-/, '').toUpperCase();
}

/**
 * Normalizes any branch identifier into canonical database branch ID (e.g. 'Aellp-AP', 'Aellp-ASM', 'ALL')
 */
export function normalizeBranchId(branchCodeOrId?: string | null): string {
  const code = normalizeBranchCode(branchCodeOrId);
  if (code === 'ALL') return 'ALL';
  return `Aellp-${code}`;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a number as Indian Currency (e.g. ₹ 1,425.00, ₹ 83,488.00, ₹ 14.25 L)
 */
export function formatINR(amount: number, compact: boolean = false): string {
  if (isNaN(amount) || amount === null || amount === undefined) return '₹0.00';
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);

  if (compact && absAmount >= 100000) {
    const inLakhs = absAmount / 100000;
    return `${isNegative ? '-' : ''}₹${inLakhs.toFixed(2)}L`;
  }

  const formatted = absAmount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${isNegative ? '-' : ''}₹${formatted}`;
}

/**
 * Formats numbers in clean Instagram / modern dashboard compact K and M notation (e.g. ₹45.7K, ₹1.44M, ₹100K)
 */
export function formatCompactINR(amount: number): string {
  if (isNaN(amount) || amount === null || amount === undefined) return '₹0';
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);

  if (abs >= 1_000_000_000) {
    const val = abs / 1_000_000_000;
    return `${sign}₹${val >= 100 ? Math.round(val) : val.toFixed(1).replace(/\.0$/, '')}B`;
  }
  if (abs >= 1_000_000) {
    const val = abs / 1_000_000;
    return `${sign}₹${val >= 100 ? Math.round(val) : val.toFixed(2).replace(/\.00$/, '')}M`;
  }
  if (abs >= 10_000) {
    const val = abs / 1_000;
    return `${sign}₹${val >= 100 ? Math.round(val) : val.toFixed(1).replace(/\.0$/, '')}K`;
  }
  if (abs >= 1_000) {
    const val = abs / 1_000;
    return `${sign}₹${val.toFixed(1).replace(/\.0$/, '')}K`;
  }

  return `${sign}₹${Number(abs).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Formats a date string into readable Indian retail format (e.g. 14-Sep-2026, 14-Sep-26)
 */
export function formatDate(dateString: string | Date, formatStr: string = 'dd-MMM-yyyy'): string {
  if (!dateString) return '-';
  try {
    const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
    return format(date, formatStr);
  } catch {
    return String(dateString);
  }
}

/**
 * Normalizes any date string (ISO, YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY) into canonical YYYY-MM-DD for reliable filtering
 */
export function normalizeDateToYMD(dateStr?: string | null): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
    const [d, m, y] = trimmed.split('-');
    return `${y}-${m}-${d}`;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [d, m, y] = trimmed.split('/');
    return `${y}-${m}-${d}`;
  }
  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return format(d, 'yyyy-MM-dd');
    }
  } catch {}
  return trimmed.slice(0, 10);
}

/**
 * Formats an Indian mobile phone number to standard +91 XXXXX XXXXX format
 */
export function formatIndianPhone(phone?: string | null): string {
  if (!phone || phone.trim() === '' || phone.trim() === '-' || phone.trim().toLowerCase() === 'null') return '—';
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.length === 0) return '—';
  if (cleaned.startsWith('91') && cleaned.length > 2) {
    const raw = cleaned.slice(2, 12);
    if (raw.length <= 5) return `+91 ${raw}`;
    return `+91 ${raw.slice(0, 5)} ${raw.slice(5, 10)}`;
  }
  const raw = cleaned.slice(0, 10);
  if (raw.length <= 5) return `+91 ${raw}`;
  return `+91 ${raw.slice(0, 5)} ${raw.slice(5, 10)}`;
}

/**
 * Normalizes input in realtime for telephone fields ensuring +91 prefix is maintained when typing
 */
export function cleanIndianPhoneInput(val: string): string {
  if (!val || val.trim() === '' || val.trim() === '+' || val.trim() === '+9' || val.trim() === '+91') {
    return '';
  }
  let digits = val.replace(/[^0-9]/g, '');
  if (digits.startsWith('91')) {
    digits = digits.slice(2);
  }
  digits = digits.slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length <= 5) return `+91 ${digits}`;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5, 10)}`;
}

/**
 * Returns pastel badge color styles based on category/department theme from our 8-color designer palette
 */
export function getCategoryBadgeStyle(themeName: string = 'Vanilla'): { bg: string; text: string; dot: string } {
  switch (themeName?.toLowerCase()) {
    case 'emerald':
    case 'fabric':
    case 'food & beverage':
    case 'tea & refreshments':
      return {
        bg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
        text: 'text-emerald-600 dark:text-emerald-400',
        dot: 'bg-emerald-500',
      };
    case 'sky blue':
    case 'computer':
    case 'it':
    case 'online':
      return {
        bg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20',
        text: 'text-blue-600 dark:text-blue-400',
        dot: 'bg-blue-500',
      };
    case 'peach':
    case 'dry cleaning':
    case 'advance':
    case 'staff loan':
      return {
        bg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20',
        text: 'text-amber-600 dark:text-amber-400',
        dot: 'bg-amber-500',
      };
    case 'electric lime':
    case 'dyeing':
    case 'freight':
    case 'courier':
      return {
        bg: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20',
        text: 'text-orange-600 dark:text-orange-400',
        dot: 'bg-orange-500',
      };
    case 'blush pink':
    case 'electrical':
    case 'tailoring':
    case 'housekeeping':
      return {
        bg: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20',
        text: 'text-indigo-600 dark:text-indigo-400',
        dot: 'bg-indigo-500',
      };
    case 'yellow':
    case 'stationery':
    case 'repairs':
      return {
        bg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20',
        text: 'text-amber-600 dark:text-amber-400',
        dot: 'bg-amber-500',
      };
    case 'coral':
    case 'emergency':
    case 'urgent':
      return {
        bg: 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20',
        text: 'text-red-600 dark:text-red-400',
        dot: 'bg-red-500',
      };
    default:
      return {
        bg: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border border-gray-500/20',
        text: 'text-gray-600 dark:text-gray-400',
        dot: 'bg-gray-400',
      };
  }
}

/**
 * Converts Indian Rupee number to words (e.g. 1450 -> 'One Thousand Four Hundred Fifty Rupees Only')
 */
export function numberToWordsINR(num: number): string {
  if (!num || isNaN(num) || num <= 0) return 'Zero Rupees Only';

  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function inWords(n: number): string {
    if (n === 0) return '';
    if (n < 20) return a[n] + ' ';
    if (n < 100) return b[Math.floor(n / 10)] + ' ' + (a[n % 10] ? a[n % 10] + ' ' : '');
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred ' + inWords(n % 100);
    if (n < 100000) return inWords(Math.floor(n / 1000)).trim() + ' Thousand ' + inWords(n % 1000);
    if (n < 10000000) return inWords(Math.floor(n / 100000)).trim() + ' Lakh ' + inWords(n % 100000);
    return inWords(Math.floor(n / 10000000)).trim() + ' Crore ' + inWords(n % 10000000);
  }

  const rounded = Math.round(num);
  const result = inWords(rounded).replace(/\s+/g, ' ').trim();
  return `${result} Rupees Only`;
}



export type HapticFeedbackType = 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error';

/**
 * Emits tactile haptic vibration patterns ONLY on mobile & tablet touch devices.
 * Completely disabled on desktop devices.
 */
export function triggerHaptic(type: HapticFeedbackType = 'light') {
  if (typeof window === 'undefined' || !window.navigator || !('vibrate' in window.navigator)) {
    return;
  }

  // Only trigger on mobile / tablet touch devices (width < 1024px or coarse touch pointer)
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isMobileOrTablet = window.innerWidth < 1024 || (isTouch && window.matchMedia('(pointer: coarse)').matches);

  if (!isTouch || !isMobileOrTablet) {
    return;
  }

  try {
    switch (type) {
      case 'selection':
      case 'light':
        window.navigator.vibrate(10);
        break;
      case 'medium':
        window.navigator.vibrate(22);
        break;
      case 'heavy':
        window.navigator.vibrate(40);
        break;
      case 'success':
        window.navigator.vibrate([12, 40, 20]);
        break;
      case 'warning':
        window.navigator.vibrate([25, 30, 25]);
        break;
      case 'error':
        window.navigator.vibrate([35, 40, 35, 40, 35]);
        break;
      default:
        window.navigator.vibrate(10);
        break;
    }
  } catch {
    // Graceful fallback for non-supported browsers
  }
}

/**
 * Formats a raw database voucher number (e.g. 'ASI-2048-e54gf') for user display,
 * invoice printing, tables, and reports by stripping the internal 5-char collision token,
 * cleanly returning 'ASI-2048'.
 * Safely preserves past entries (e.g. 'ASI-2048', 'ASI-10025', 'ASI-EMG-1024').
 */
export function formatVoucherNumber(rawVoucherNumber?: string | null): string {
  if (!rawVoucherNumber || typeof rawVoucherNumber !== 'string') return '';
  const trimmed = rawVoucherNumber.trim();
  
  // Handle any timestamp suffixes (e.g. -16.10.11.35)
  const withoutTimestamp = trimmed.replace(/-(\d{2}\.\d{2}\.\d{2}\.\d{2}(\.\d{2})?)$/, '');
  
  // Check if there are at least 3 hyphen-separated segments (e.g. 'ASI-2048-e54gf')
  const parts = withoutTimestamp.split('-');
  if (parts.length >= 3) {
    const last = parts[parts.length - 1];
    // If the last segment is a 4-10 char token (e.g. 5-char hash 'e54gf')
    if (/^[a-zA-Z0-9]{4,10}$/.test(last)) {
      // Preserve past auto-vouchers like 'ASI-EMG-1024' where 2nd part is EMG and last part is pure digits
      if (parts.length === 3 && parts[1].toUpperCase() === 'EMG' && /^\d+$/.test(last)) {
        return withoutTimestamp;
      }
      return parts.slice(0, -1).join('-');
    }
  }
  
  return withoutTimestamp;
}

/**
 * Generates an internal 5-character cryptographic random hash suffix (e.g. 'e54gf')
 * used to guarantee zero database collisions across repeating physical printing batches.
 */
export function generateVoucherCollisionToken(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let token = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(5);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < 5; i++) {
      token += chars[bytes[i] % chars.length];
    }
    return token;
  }
  return Math.random().toString(36).slice(2, 7).toLowerCase();
}


