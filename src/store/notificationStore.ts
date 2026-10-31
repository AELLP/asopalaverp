import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ERPNotification } from '@/types/database';

export interface BroadcastMessage {
  id: string;
  badge?: string;
  message: string;
  link?: string;
  created_at: string;
}

interface NotificationState {
  notifications: ERPNotification[];
  broadcast: BroadcastMessage | null;
  fetchCloudNotifications: () => Promise<void>;
  addNotification: (notification: Omit<ERPNotification, 'id' | 'created_at' | 'read_by'>) => void;
  markAsRead: (id: string, username: string) => void;
  markAllAsRead: (username: string) => void;
  clearAll: () => void;
  getNotificationsForUser: (userRole?: string, branchId?: string) => ERPNotification[];
  getUnreadCount: (username?: string, userRole?: string, branchId?: string) => number;
  setBroadcast: (msg: BroadcastMessage | null) => void;
}

const INITIAL_NOTIFICATIONS: ERPNotification[] = [];

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: INITIAL_NOTIFICATIONS,
      broadcast: null,

      setBroadcast: (msg) => set({ broadcast: msg }),

      fetchCloudNotifications: async () => {
        // Notifications are maintained locally in Zustand persist storage ('asopalav-erp-notifications-storage').
        // Avoid firing phantom queries to non-existent remote table to eliminate 404 console errors.
      },

      addNotification: async (data) => {
        const tempId = `NOTIF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
        const newNotif: ERPNotification = {
          id: tempId,
          ...data,
          created_at: new Date().toISOString(),
          read_by: [],
        };
        set((state) => ({
          notifications: [newNotif, ...state.notifications].slice(0, 50),
        }));

        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('asopalav:notification-received', { detail: newNotif })
          );
        }
      },

      markAsRead: async (id: string, username: string) => {
        if (!username) return;
        const current = get().notifications.find((n) => n.id === id);
        const updatedReadBy = current && !current.read_by.includes(username)
          ? [...current.read_by, username]
          : current?.read_by || [username];

        set((state) => ({
          notifications: state.notifications.map((n) => {
            if (n.id === id && !n.read_by.includes(username)) {
              return { ...n, read_by: updatedReadBy };
            }
            return n;
          }),
        }));
      },

      markAllAsRead: async (username: string) => {
        if (!username) return;
        set((state) => ({
          notifications: state.notifications.map((n) => ({
            ...n,
            read_by: n.read_by.includes(username) ? n.read_by : [...n.read_by, username],
          })),
        }));
      },

      clearAll: () => {
        set({ notifications: [] });
      },

      getNotificationsForUser: (userRole = 'Super_Admin', branchId) => {
        const { notifications } = get();
        const normRole = (userRole || '').toLowerCase().replace(/[\s_-]+/g, '');
        const isPrivileged = normRole === 'superadmin' || normRole === 'admin' || normRole === 'developer' || normRole === 'owner';
        return notifications.filter((n) => {
          const roleMatches =
            isPrivileged ||
            userRole === 'Super_Admin' ||
            userRole === 'Admin' ||
            n.target_roles.includes(userRole) ||
            n.target_roles.includes('*');
          const branchMatches = !branchId || isPrivileged || !n.branch_id || n.branch_id === branchId || n.branch_id === '*';
          return roleMatches && branchMatches;
        });
      },

      getUnreadCount: (username = '', userRole = 'Super_Admin', branchId) => {
        const notifs = get().getNotificationsForUser(userRole, branchId);
        if (!username) return notifs.length;
        return notifs.filter((n) => !n.read_by.includes(username)).length;
      },
    }),
    {
      name: 'asopalav-erp-notifications-storage',
    }
  )
);
