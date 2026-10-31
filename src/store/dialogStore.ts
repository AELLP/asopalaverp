import { create } from 'zustand';

export interface ConfirmDialogOptions {
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'primary';
  onConfirm: () => Promise<void> | void;
  onCancel?: () => void;
}

interface DialogState {
  isOpen: boolean;
  options: ConfirmDialogOptions | null;
  isLoading: boolean;
  openConfirm: (options: ConfirmDialogOptions) => void;
  closeConfirm: () => void;
  setLoading: (loading: boolean) => void;
}

export const useDialogStore = create<DialogState>((set) => ({
  isOpen: false,
  options: null,
  isLoading: false,
  openConfirm: (options) => set({ isOpen: true, options, isLoading: false }),
  closeConfirm: () => set({ isOpen: false, options: null, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
}));

/**
 * Programmatic helper to trigger a Supabase Studio confirmation dialog anywhere
 */
export const confirmDialog = (options: ConfirmDialogOptions): Promise<boolean> => {
  return new Promise((resolve) => {
    useDialogStore.getState().openConfirm({
      ...options,
      onConfirm: async () => {
        try {
          useDialogStore.getState().setLoading(true);
          await options.onConfirm();
          resolve(true);
        } finally {
          useDialogStore.getState().closeConfirm();
        }
      },
      onCancel: () => {
        options.onCancel?.();
        useDialogStore.getState().closeConfirm();
        resolve(false);
      },
    });
  });
};
