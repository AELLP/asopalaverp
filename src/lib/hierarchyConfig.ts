/**
 * Asopalav ERP - Master Hierarchy Configuration (Parent-Child Taxonomies)
 * 
 * Provides two-tier hierarchical rollups for:
 * 1. Expense Categories: Parent Category (Group/Ledger Head) -> Child Expense Category
 * 2. Departments: Parent Division (Cost Center Division) -> Child Department
 * 
 * Super Admin can modify mappings via Showroom Settings / Master Data Drawer.
 * Changes are persisted locally and broadcast to all application components.
 */

// ---------------------------------------------------------------------------
// 1. STANDARD PARENT CATEGORY DEFINITIONS
// ---------------------------------------------------------------------------
export const PARENT_CATEGORIES = [
  'Direct Expenses',
  'Repair & Maintenance Exp',
  'Office Exp',
  'Conveyance Exp',
  'Packing Expenses',
  'Customer Services',
  'Travelling Expense',
  'Printing & Stationery Exp',
  'Advertisement Exp',
  'Legal Expense',
  'Employee Cost',
  '-',
] as const;

export type ParentCategoryName = typeof PARENT_CATEGORIES[number] | string;

export const DEFAULT_PARENT_CATEGORIES: Record<string, string> = {
  // Repair & Maintenance Exp
  'Software Expenses': 'Repair & Maintenance Exp',
  'Mobile Expenses': 'Repair & Maintenance Exp',
  'Computer Repair & Maintenance': 'Repair & Maintenance Exp',
  'Furniture Repair & Maintenance': 'Repair & Maintenance Exp',
  'Building Repair & Maintenance': 'Repair & Maintenance Exp',
  'Telephone Expenses': 'Repair & Maintenance Exp',
  'Electrical Repair & Maintenance': 'Repair & Maintenance Exp',
  'Vehicle Repair & Maintenance Expenses': 'Repair & Maintenance Exp',
  'Vehicle Expenses': 'Repair & Maintenance Exp',

  // Direct Expenses
  'Tailoring Expenses': 'Direct Expenses',
  'Fall & Biding Expenses': 'Direct Expenses',
  'Dyeing Expenses': 'Direct Expenses',
  'Material & Fabric Expenses': 'Direct Expenses',
  'Dry Cleaning Expenses': 'Direct Expenses',
  'Production Material Expenses': 'Direct Expenses',

  // Printing & Stationery Exp
  'Printing & Stationery': 'Printing & Stationery Exp',

  // Packing Expenses
  'Packing Expenses': 'Packing Expenses',
  'Freight & Transportation Charges': 'Packing Expenses',
  'Packing Exp': 'Packing Expenses',

  // Advertisement Exp
  'Shooting & Photography Expenses': 'Advertisement Exp',

  // Travelling Expense
  'Travelling Expenses - Working Partner': 'Travelling Expense',
  'Travelling Expenses - Staff': 'Travelling Expense',

  // Office Exp
  'Housekeeping material Expenses': 'Office Exp',
  'Housekeeping Expenses': 'Office Exp',
  'Shop Expenses (Misc Exps)': 'Office Exp',

  // Legal Expense
  'Legal & Professional Expenses': 'Legal Expense',

  // Conveyance Exp
  'Petrol Expenses - Delivery': 'Conveyance Exp',
  'Petrol Expenses - Working Partner': 'Conveyance Exp',
  'Petrol Expenses - Staff': 'Conveyance Exp',

  // Customer Services
  'Food & Beverage Expenses': 'Customer Services',
  'Working Partner Expenses': 'Customer Services',

  // Employee Cost
  'Sales Incentive Expenses': 'Employee Cost',

  // Direct Overhead / Operational / Unassigned (-)
  'Shop Expenses': '-',
  'Staff Adv for Exps': '-',
  'Advance Salary': '-',
  'Labour Expenses': '-',
  'Medical Expenses': '-',
  'Customer Courier & Packing': '-',
  'Fabric Expenses': '-',
  'Production Lace Expenses': '-',
  'Security Expense': '-',
  'Showroom Lighting & Electricals': '-',
  'Staff Welfare': '-',
  'Tailoring Expenses CC & SKD': '-',
  'Tea & Coffee Expenses': '-',
  'Stationery Expenses': '-',
  'Other Expenses': '-',
};

// ---------------------------------------------------------------------------
// 2. STANDARD PARENT DIVISION DEFINITIONS (For Departments)
// ---------------------------------------------------------------------------
export interface ParentDivision {
  code: string;
  name: string;
  description?: string;
}

export const PARENT_DIVISIONS: ParentDivision[] = [
  { code: 'DIV-CC', name: 'Chaniya Choli (CC) Division', description: 'Bridal & Occasion Wear' },
  { code: 'DIV-SKD', name: 'Salwar Kameez Dupatta (SKD) Division', description: 'Traditional & Formal Wear' },
  { code: 'DIV-MEN', name: "Men's Wear Division", description: 'Kurta, Sherwani & Menswear' },
  { code: 'DIV-RETAIL', name: 'Retail Apparel & Showroom Floors', description: 'Saree, Western Wear, Kids, Handbags' },
  { code: 'DIV-OPS', name: 'Store Operations & Front Desk', description: 'Cashier, Billing, Dispatch & Customer Care' },
  { code: 'DIV-CORP', name: 'Corporate & Administration', description: 'Accounts, HR, IT, Maintenance & Partners' },
];

export const DEFAULT_PARENT_DEPARTMENTS: Record<string, { code: string; name: string }> = {
  // Chaniya Choli (CC) Division
  'DEP-CC': { code: 'DIV-CC', name: 'Chaniya Choli (CC) Division' },
  'DEP-CC-PRODUCTION': { code: 'DIV-CC', name: 'Chaniya Choli (CC) Division' },
  'DEP-CC-TAILORING': { code: 'DIV-CC', name: 'Chaniya Choli (CC) Division' },

  // Salwar Kameez Dupatta (SKD) Division
  'DEP-SKD': { code: 'DIV-SKD', name: 'Salwar Kameez Dupatta (SKD) Division' },
  'DEP-SKD-PRODUCTION': { code: 'DIV-SKD', name: 'Salwar Kameez Dupatta (SKD) Division' },
  'DEP-SKD-TAILORING': { code: 'DIV-SKD', name: 'Salwar Kameez Dupatta (SKD) Division' },

  // Men's Wear Division
  'DEP-MENS': { code: 'DIV-MEN', name: "Men's Wear Division" },
  'DEP-M-PRODUCTION': { code: 'DIV-MEN', name: "Men's Wear Division" },
  'DEP-M-TAILORING': { code: 'DIV-MEN', name: "Men's Wear Division" },

  // Retail Apparel Sections & Showroom Floors
  'DEP-SAREE': { code: 'DIV-RETAIL', name: 'Retail Apparel & Showroom Floors' },
  'DEP-WW': { code: 'DIV-RETAIL', name: 'Retail Apparel & Showroom Floors' },
  'DEP-KIDS': { code: 'DIV-RETAIL', name: 'Retail Apparel & Showroom Floors' },
  'DEP-PURSE': { code: 'DIV-RETAIL', name: 'Retail Apparel & Showroom Floors' },
  'DEP-TAILORING': { code: 'DIV-RETAIL', name: 'Retail Apparel & Showroom Floors' },

  // Store Operations, Front Desk & Logistics
  'DEP-CASH-BILL': { code: 'DIV-OPS', name: 'Store Operations & Front Desk' },
  'DEP-CUSTOMER CARE': { code: 'DIV-OPS', name: 'Store Operations & Front Desk' },
  'DEP-CRM': { code: 'DIV-OPS', name: 'Store Operations & Front Desk' },
  'DEP-INVENTORY': { code: 'DIV-OPS', name: 'Store Operations & Front Desk' },
  'DEP-PARCEL': { code: 'DIV-OPS', name: 'Store Operations & Front Desk' },
  'ASPC': { code: 'DIV-OPS', name: 'Store Operations & Front Desk' },

  // Corporate, Administration & Facilities
  'DEP-ACCOUNTS': { code: 'DIV-CORP', name: 'Corporate & Administration' },
  'DEP-ADMIN': { code: 'DIV-CORP', name: 'Corporate & Administration' },
  'DEP-HR': { code: 'DIV-CORP', name: 'Corporate & Administration' },
  'DEP-IT': { code: 'DIV-CORP', name: 'Corporate & Administration' },
  'DEP-DM': { code: 'DIV-CORP', name: 'Corporate & Administration' },
  'DEP-HK': { code: 'DIV-CORP', name: 'Corporate & Administration' },
  'DEP-ELECTRICIAN': { code: 'DIV-CORP', name: 'Corporate & Administration' },
  'DEP-WPE': { code: 'DIV-CORP', name: 'Corporate & Administration' },
};

// ---------------------------------------------------------------------------
// 3. PERSISTENT OVERRIDES STORAGE & API
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'asopalav_hierarchy_overrides';

interface HierarchyOverrides {
  categoryParents?: Record<string, string>;
  departmentParents?: Record<string, { code: string; name: string }>;
}

function getStoredOverrides(): HierarchyOverrides {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredOverrides(overrides: HierarchyOverrides) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    window.dispatchEvent(new CustomEvent('asopalav:hierarchy-updated', { detail: overrides }));
  } catch (e) {
    console.warn('Failed to save hierarchy overrides:', e);
  }
}

/**
 * Get Parent Category for a given category name.
 * Checks: 1) local storage override -> 2) color_theme if not 'Vanilla' -> 3) default dictionary -> 4) 'Other Expenses'
 */
export function getParentCategory(categoryName?: string | null, colorTheme?: string | null): string {
  if (!categoryName || !categoryName.trim()) return '-';
  const name = categoryName.trim();

  // 1. Check local storage overrides
  const overrides = getStoredOverrides();
  if (overrides.categoryParents && overrides.categoryParents[name] && overrides.categoryParents[name].trim()) {
    return overrides.categoryParents[name].trim();
  }

  // 2. Check if color_theme holds an explicit parent group
  if (colorTheme && colorTheme !== 'Vanilla' && colorTheme !== 'Default' && colorTheme.trim().length > 0) {
    const ct = colorTheme.trim();
    // Normalize any legacy themes to the user's canonical parent groups
    if (ct === 'Production') return 'Direct Expenses';
    if (ct === 'Maintenance' || ct === 'IT & Computer' || ct === 'Communication') return 'Repair & Maintenance Exp';
    if (ct === 'Office Supplies') return 'Printing & Stationery Exp';
    if (ct === 'Logistics' || ct === 'Packing Exp') return 'Packing Expenses';
    if (ct === 'Marketing & Promotion') return 'Advertisement Exp';
    if (ct === 'Travel & Conveyance') return 'Travelling Expense';
    if (ct === 'Facility') return 'Office Exp';
    if (ct === 'Staff Advances' || ct === 'Salary & Employee Benefits') return '-';
    if (ct === 'Professional Services') return 'Legal Expense';
    return ct;
  }

  // 3. Check default dictionary
  if (DEFAULT_PARENT_CATEGORIES[name]) {
    return DEFAULT_PARENT_CATEGORIES[name];
  }

  // 4. Case-insensitive check against default dictionary
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(DEFAULT_PARENT_CATEGORIES)) {
    if (key.toLowerCase() === lower) {
      return val;
    }
  }

  // 5. Fallback heuristics
  if (lower.includes('tailor') || lower.includes('fabric') || lower.includes('dye') || lower.includes('biding') || lower.includes('production material')) {
    return 'Direct Expenses';
  }
  if (lower.includes('repair') || lower.includes('maintenance') || lower.includes('software') || lower.includes('computer') || lower.includes('mobile') || lower.includes('electric') || lower.includes('vehicle')) {
    return 'Repair & Maintenance Exp';
  }
  if (lower.includes('petrol') || lower.includes('conveyance') || lower.includes('delivery')) {
    return 'Conveyance Exp';
  }
  if (lower.includes('travel')) {
    return 'Travelling Expense';
  }
  if (lower.includes('pack') || lower.includes('freight') || lower.includes('transportation')) {
    return 'Packing Expenses';
  }
  if (lower.includes('print') || lower.includes('stationery')) {
    return 'Printing & Stationery Exp';
  }
  if (lower.includes('housekeeping') || lower.includes('misc exps')) {
    return 'Office Exp';
  }
  if (lower.includes('food') || lower.includes('beverage') || lower.includes('partner expenses')) {
    return 'Customer Services';
  }
  if (lower.includes('legal') || lower.includes('professional')) {
    return 'Legal Expense';
  }
  if (lower.includes('incentive') || lower.includes('sales incentive')) {
    return 'Employee Cost';
  }
  if (lower.includes('photo') || lower.includes('shooting') || lower.includes('advertisement')) {
    return 'Advertisement Exp';
  }

  return '-';
}

/**
 * Get Parent Division for a department code or name.
 */
export function getParentDepartment(deptCodeOrName?: string | null): { code: string; name: string } {
  if (!deptCodeOrName || !deptCodeOrName.trim()) {
    return { code: 'DIV-OPS', name: 'Store Operations & Front Desk' };
  }
  const key = deptCodeOrName.trim();

  // 1. Check overrides
  const overrides = getStoredOverrides();
  if (overrides.departmentParents && overrides.departmentParents[key]) {
    const ov = overrides.departmentParents[key];
    if (ov && ov.name && ov.name.trim()) {
      return { code: ov.code || 'DIV-OPS', name: ov.name.trim() };
    }
  }

  // 2. Explicit direct check for CC
  const upper = key.toUpperCase();
  if (upper === 'DEP-CC' || upper === 'CC') {
    return { code: 'DIV-CC', name: 'Chaniya Choli (CC) Division' };
  }

  // 3. Check by code directly
  if (DEFAULT_PARENT_DEPARTMENTS[key]) {
    return DEFAULT_PARENT_DEPARTMENTS[key];
  }

  // 4. Check by matching department_name or code prefix
  for (const [code, val] of Object.entries(DEFAULT_PARENT_DEPARTMENTS)) {
    if (upper === code || upper.includes(code.replace('DEP-', ''))) {
      return val;
    }
  }

  // Fallback heuristic
  if (upper.includes('CC') || upper.includes('CHANIYA')) {
    return { code: 'DIV-CC', name: 'Chaniya Choli (CC) Division' };
  }
  if (upper.includes('SKD') || upper.includes('SALWAR')) {
    return { code: 'DIV-SKD', name: 'Salwar Kameez Dupatta (SKD) Division' };
  }
  if (upper.includes('MEN')) {
    return { code: 'DIV-MEN', name: "Men's Wear Division" };
  }
  if (upper.includes('SAREE') || upper.includes('WESTERN') || upper.includes('KIDS') || upper.includes('PURSE')) {
    return { code: 'DIV-RETAIL', name: 'Retail Apparel & Showroom Floors' };
  }
  if (upper.includes('ACCOUNT') || upper.includes('ADMIN') || upper.includes('HR') || upper.includes('IT')) {
    return { code: 'DIV-CORP', name: 'Corporate & Administration' };
  }

  return { code: 'DIV-OPS', name: 'Store Operations & Front Desk' };
}

/**
 * Update Super Admin assignment for a Category's Parent Group.
 */
export function setCategoryParent(categoryName: string, parentCategory: string) {
  const overrides = getStoredOverrides();
  overrides.categoryParents = {
    ...(overrides.categoryParents || {}),
    [categoryName.trim()]: parentCategory.trim(),
  };
  saveStoredOverrides(overrides);
}

/**
 * Update Super Admin assignment for a Department's Parent Division.
 */
export function setDepartmentParent(deptCode: string, divisionCode: string, divisionName: string) {
  const overrides = getStoredOverrides();
  overrides.departmentParents = {
    ...(overrides.departmentParents || {}),
    [deptCode.trim()]: { code: divisionCode.trim(), name: divisionName.trim() },
  };
  saveStoredOverrides(overrides);
}
