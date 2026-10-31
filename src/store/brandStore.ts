import { create } from 'zustand';

export interface BrandSettings {
  brandName: string;
  legalEntityName: string;
  tagline: string;
  logoUrl: string;
  logoType: 'svg' | 'image' | 'monogram';
  brandSvgContent: string;
  monogramText: string;
  faviconUrl: string;
  brandAccentColor: string;
  gstin: string;
  panNumber: string;
  contactPhone: string;
  contactEmail: string;
  address: string;
  city: string;
  state: string;
}

export const DEFAULT_BRAND_SETTINGS: BrandSettings = {
  brandName: 'Asopalav',
  legalEntityName: 'Asopalav Endeavours LLP',
  tagline: 'Showroom Cash Counter & Expense Management',
  logoUrl: '',
  logoType: 'svg',
  brandSvgContent: '',
  monogramText: 'ASI',
  faviconUrl: '',
  brandAccentColor: '#3ecf8e',
  gstin: '24ABVFA8046N1ZQ',
  panNumber: 'ABVFA8046N',
  contactPhone: '+91 9925009050',
  contactEmail: 'satellite@asopalav.com',
  address: 'Asopalav House, Opp Keshav Baug Party Plot, Near Shivranjani Cross Road, Satellite - 380015',
  city: 'Ahmedabad',
  state: 'Gujarat',
};

const STORAGE_KEY = 'asopalav_brand_settings';

interface BrandState extends BrandSettings {
  loading: boolean;
  updateBrandSettings: (updates: Partial<BrandSettings>) => Promise<void>;
  resetToDefaults: () => Promise<void>;
  fetchBrandSettings: () => Promise<void>;
  applyBrandToDocument: () => void;
}

const getStoredBrand = (): BrandSettings => {
  if (typeof window === 'undefined') return DEFAULT_BRAND_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_BRAND_SETTINGS, ...JSON.parse(raw) } : DEFAULT_BRAND_SETTINGS;
  } catch {
    return DEFAULT_BRAND_SETTINGS;
  }
};

export const useBrandStore = create<BrandState>((set, get) => ({
  ...getStoredBrand(),
  loading: false,

  applyBrandToDocument: () => {
    if (typeof window === 'undefined') return;
    const { brandName, faviconUrl, monogramText, brandAccentColor } = get();

    // 1. Update Title
    if (brandName) {
      document.title = `${brandName} ERP • Showroom Workspace`;
    }

    // 2. Update Favicon dynamically
    let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.getElementsByTagName('head')[0].appendChild(link);
    }

    if (faviconUrl && faviconUrl.trim()) {
      link.href = faviconUrl;
    } else {
      // Generate Dynamic SVG Favicon with Brand Accent & Monogram
      const svgFavicon = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
          <rect width="32" height="32" rx="8" fill="#141414"/>
          <rect x="6" y="6" width="20" height="20" rx="4" transform="rotate(45 16 16)" fill="${brandAccentColor || '#3ecf8e'}" fill-opacity="0.2" stroke="${brandAccentColor || '#3ecf8e'}" stroke-width="1.5"/>
          <text x="16" y="21" font-family="system-ui, sans-serif" font-size="11" font-weight="bold" fill="${brandAccentColor || '#3ecf8e'}" text-anchor="middle">${monogramText?.slice(0, 3) || 'ASI'}</text>
        </svg>
      `.trim();
      link.href = `data:image/svg+xml,${encodeURIComponent(svgFavicon)}`;
    }
  },

  fetchBrandSettings: async () => {
    // Brand settings are maintained locally via DEFAULT_BRAND_SETTINGS and localStorage.
    // Avoid firing phantom queries to non-existent remote table to eliminate 404 console errors.
    get().applyBrandToDocument();
  },

  updateBrandSettings: async (updates: Partial<BrandSettings>) => {
    const newState = { ...get(), ...updates };
    set(updates);

    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
    }

    get().applyBrandToDocument();
  },

  resetToDefaults: async () => {
    set(DEFAULT_BRAND_SETTINGS);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_BRAND_SETTINGS));
    }
    get().applyBrandToDocument();
  },
}));
