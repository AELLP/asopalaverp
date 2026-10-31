import { create } from 'zustand';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface CloudConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  cloudflareAccountId: string;
  r2BucketName: string;
  r2PublicDomain: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  customDomain: string;
  pagesProjectName: string;
}

const STORAGE_KEY = 'asopalav_cloud_config_v1';
const CHECKLIST_STORAGE_KEY = 'asopalav_prelaunch_checklist_v1';

export const DEFAULT_CLOUD_CONFIG: CloudConfig = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'https://xbrafntxnfgepabdjafj.supabase.co',
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
  cloudflareAccountId: import.meta.env.VITE_CLOUDFLARE_ACCOUNT_ID || '41fcdd0b926599600e392e23fd9a17ce',
  r2BucketName: import.meta.env.VITE_R2_BUCKET_NAME || 'asopalav-erp-media',
  r2PublicDomain: import.meta.env.VITE_R2_PUBLIC_DOMAIN || 'https://pub-5c613915e11142e0af82109d818863e1.r2.dev',
  r2AccessKeyId: import.meta.env.VITE_R2_ACCESS_KEY_ID || 'de26211b45ce57522107182dbfe2a052',
  r2SecretAccessKey: import.meta.env.VITE_R2_SECRET_ACCESS_KEY || '7a2a490c0719abbb3b1cfb588c17aeeccfe3cb6369bf44e62b5c93843b4ba678',
  customDomain: 'erp.asopalav.com',
  pagesProjectName: 'asopalav-erp',
};

export const getStoredCloudConfig = (): CloudConfig => {
  if (typeof window === 'undefined') return DEFAULT_CLOUD_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CLOUD_CONFIG;
    const parsed = JSON.parse(raw);
    // Security: purge any previously cached secret access keys from client localStorage
    delete parsed.r2SecretAccessKey;
    delete parsed.r2AccessKeyId;
    return {
      ...DEFAULT_CLOUD_CONFIG,
      ...parsed,
      r2AccessKeyId: DEFAULT_CLOUD_CONFIG.r2AccessKeyId,
      r2SecretAccessKey: DEFAULT_CLOUD_CONFIG.r2SecretAccessKey,
    };
  } catch {
    return DEFAULT_CLOUD_CONFIG;
  }
};

export const getStoredChecklist = (): Record<number, boolean> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CHECKLIST_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

export interface ConnectionTestResult {
  success: boolean;
  latencyMs: number;
  message: string;
  details?: {
    appUsersCount?: number;
    staffCount?: number;
    branchesCount?: number;
  };
}

interface CloudConfigState {
  config: CloudConfig;
  checklist: Record<number, boolean>;
  isTestingConnection: boolean;
  lastTestResult: ConnectionTestResult | null;
  updateConfig: (partial: Partial<CloudConfig>) => void;
  resetToDefaults: () => void;
  toggleChecklistItem: (stepIndex: number) => void;
  testSupabaseConnection: (customUrl?: string, customKey?: string) => Promise<ConnectionTestResult>;
  generateEnvContent: () => string;
  generateCorsJson: () => string;
}

export const useCloudConfigStore = create<CloudConfigState>((set, get) => ({
  config: getStoredCloudConfig(),
  checklist: getStoredChecklist(),
  isTestingConnection: false,
  lastTestResult: null,

  updateConfig: (partial) => {
    const nextConfig = { ...get().config, ...partial };
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextConfig));
    }
    set({ config: nextConfig });

    // Broadcast instant update event across app
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('asopalav:cloud-config-updated', { detail: nextConfig })
      );
    }
  },

  resetToDefaults: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
    set({ config: DEFAULT_CLOUD_CONFIG, lastTestResult: null });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('asopalav:cloud-config-updated', { detail: DEFAULT_CLOUD_CONFIG })
      );
    }
  },

  toggleChecklistItem: (stepIndex) => {
    const updated = { ...get().checklist, [stepIndex]: !get().checklist[stepIndex] };
    if (typeof window !== 'undefined') {
      localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(updated));
    }
    set({ checklist: updated });
  },

  testSupabaseConnection: async (customUrl, customKey) => {
    const url = (customUrl || get().config.supabaseUrl).trim();
    const key = (customKey || get().config.supabasePublishableKey).trim();

    set({ isTestingConnection: true });
    const startTime = performance.now();

    try {
      if (!url || !key) {
        throw new Error('Supabase Project URL and Anon/Publishable Key are required.');
      }

      // Create a temporary client to test credentials
      const testClient: SupabaseClient = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // Timeout after 4.5 seconds to guarantee responsive UI
      const testQuery = Promise.all([
        testClient.from('app_users').select('id', { count: 'exact', head: true }),
        testClient.from('staff_members').select('staff_code', { count: 'exact', head: true }),
        testClient.from('branches').select('branch_id', { count: 'exact', head: true }),
      ]);

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timed out after 4500ms. Check Project URL or internet connectivity.')), 4500)
      );

      const [usersRes, staffRes, branchesRes] = (await Promise.race([testQuery, timeoutPromise])) as any;
      const latencyMs = Math.round(performance.now() - startTime);

      if (usersRes.error && usersRes.error.code !== 'PGRST116') {
        throw new Error(`Database error: ${usersRes.error.message || 'Access restricted'}`);
      }

      const usersCount = usersRes.count ?? 0;
      const staffCount = staffRes.count ?? 0;
      const branchesCount = branchesRes.count ?? 0;

      const result: ConnectionTestResult = {
        success: true,
        latencyMs,
        message: `Successfully connected to Cloud Database (${latencyMs}ms latency). Configuration verified.`,
        details: {
          appUsersCount: usersCount,
          staffCount: staffCount,
          branchesCount: branchesCount,
        },
      };

      set({ lastTestResult: result, isTestingConnection: false });
      return result;
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - startTime);
      const result: ConnectionTestResult = {
        success: false,
        latencyMs,
        message: err.message || 'Failed to connect to Cloud Database.',
      };
      set({ lastTestResult: result, isTestingConnection: false });
      return result;
    }
  },

  generateEnvContent: () => {
    const c = get().config;
    return `# ================================================================================
# ASOPALAV ERP - PRODUCTION ENVIRONMENT CONFIGURATION
# Generated via Admin Cloud Setup (Zero Client Secrets)
# ================================================================================

# 1. Supabase PostgreSQL & Auth Credentials (Public Anon/Publishable Key)
VITE_SUPABASE_URL=${c.supabaseUrl}
VITE_SUPABASE_PUBLISHABLE_KEY=${c.supabasePublishableKey}

# 2. Cloudflare R2 Public Storage Configuration
VITE_CLOUDFLARE_ACCOUNT_ID=${c.cloudflareAccountId}
VITE_R2_BUCKET_NAME=${c.r2BucketName}
VITE_R2_PUBLIC_DOMAIN=${c.r2PublicDomain}

# NOTE: R2 Access Key & Secret Access Key belong STRICTLY on the server side
# in Supabase Edge Functions Secrets:
# supabase secrets set R2_ACCOUNT_ID=${c.cloudflareAccountId} R2_ACCESS_KEY_ID=your_key R2_SECRET_ACCESS_KEY=your_secret R2_BUCKET_NAME=${c.r2BucketName} R2_PUBLIC_DOMAIN=${c.r2PublicDomain}
`;
  },

  generateCorsJson: () => {
    const c = get().config;
    const domain = c.customDomain.replace(/^https?:\/\//, '').trim();
    return `[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:5173",
      "https://*.pages.dev",
      ${domain ? `"https://${domain}",\n      "https://*.${domain}"` : '"https://*.asopalav.com"'}
    ],
    "AllowedMethods": [
      "GET",
      "PUT",
      "POST",
      "HEAD"
    ],
    "AllowedHeaders": [
      "*"
    ],
    "ExposeHeaders": [
      "ETag"
    ],
    "MaxAgeSeconds": 3600
  }
]`;
  },
}));
