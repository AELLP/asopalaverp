import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'ui': path.resolve(__dirname, './src/components/ui'),
    },
  },
  server: {
    port: 3001,
    host: true,
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'zustand'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-icons': ['lucide-react'],
          'vendor-utils': ['date-fns', 'clsx', 'tailwind-merge', 'bcryptjs'],
        },
      },
    },
  },
});
