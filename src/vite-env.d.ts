/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_CLOUDFLARE_ACCOUNT_ID: string;
  readonly VITE_R2_BUCKET_NAME: string;
  readonly VITE_R2_PUBLIC_DOMAIN: string;
  readonly VITE_R2_PUBLIC_URL?: string;
  readonly VITE_R2_ACCOUNT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
