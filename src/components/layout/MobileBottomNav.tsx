import React, { useState } from 'react';
import { useUIStore, PageId } from '@/store/uiStore';
import { useAuthStore } from '@/store/authStore';
import {
  LayoutGrid,
  Receipt,
  Wallet,
  HandCoins,
  Plus,  ChevronRight,
} from 'lucide-react';
import { cn, triggerHaptic } from '@/lib/utils';
import { useScrollLock } from '@/hooks/useScrollLock';

export const MobileBottomNav: React.FC = () => {
  const {
    activePage,
    setActivePage,
    setMobileSidebarOpen,  } = useUIStore();
  const { user, can } = useAuthStore();

  const [isQuickActionOpen, setIsQuickActionOpen] = useState(false);

  useScrollLock(isQuickActionOpen);

  const handleNavClick = (pageId: PageId) => {
    triggerHaptic('selection');
    setActivePage(pageId);
    setMobileSidebarOpen(false);
    setIsQuickActionOpen(false);
  };

  const userInitials =
    user?.avatar_initials ||
    (user?.first_name
      ? `${user.first_name[0]}${user.last_name ? user.last_name[0] : ''}`.toUpperCase()
      : 'AD');

  const isCashier = user?.role_code === 'Cashier';

  return (
    <>
      {/* ========================================================================= */}
      {/* 1. SUPABASE STUDIO FLOATING DOCK NAVIGATION                                */}
      {/* ========================================================================= */}
      <nav
        aria-label="Mobile Navigation"
        className={cn(
          'lg:hidden fixed bottom-3 left-3 right-3 z-40 select-none touch-manipulation max-w-md mx-auto',
          'rounded-[12px] bg-white dark:bg-[#161616] border border-slate-200 dark:border-[#282828] shadow-2xl',
          'pb-[env(safe-area-inset-bottom,0px)]'
        )}
      >
        <div className="h-[56px] px-2 flex items-center justify-around">
          {/* TAB 1: Home */}
          <button
            type="button"
            onClick={() => handleNavClick('dashboard')}
            aria-label="Dashboard"
            className="flex flex-col items-center justify-center flex-1 h-full py-1 select-none cursor-pointer active:scale-[0.92] transition-transform duration-150"
          >
            <div
              className={cn(
                'w-7 h-7 rounded-[6px] flex items-center justify-center transition-colors',
                activePage === 'dashboard'
                  ? 'text-emerald-600 dark:text-[#3ecf8e]'
                  : 'text-slate-500 dark:text-[#a1a1a1]'
              )}
            >
              <LayoutGrid className="w-[19px] h-[19px] stroke-[1.8]" />
            </div>
            <span
              className={cn(
                'text-[10px] font-sans font-medium transition-colors tracking-tight',
                activePage === 'dashboard'
                  ? 'text-emerald-600 dark:text-[#3ecf8e] font-semibold'
                  : 'text-slate-500 dark:text-[#a1a1a1]'
              )}
            >
              Dashboard
            </span>
          </button>

          {/* TAB 2: Expenses */}
          <button
            type="button"
            onClick={() => handleNavClick('expenses')}
            aria-label="All Expenses"
            className="flex flex-col items-center justify-center flex-1 h-full py-1 select-none cursor-pointer active:scale-[0.92] transition-transform duration-150"
          >
            <div
              className={cn(
                'w-7 h-7 rounded-[6px] flex items-center justify-center transition-colors',
                activePage === 'expenses'
                  ? 'text-emerald-600 dark:text-[#3ecf8e]'
                  : 'text-slate-500 dark:text-[#a1a1a1]'
              )}
            >
              <Receipt className="w-[19px] h-[19px] stroke-[1.8]" />
            </div>
            <span
              className={cn(
                'text-[10px] font-sans font-medium transition-colors tracking-tight',
                activePage === 'expenses'
                  ? 'text-emerald-600 dark:text-[#3ecf8e] font-semibold'
                  : 'text-slate-500 dark:text-[#a1a1a1]'
              )}
            >
              All Bills
            </span>
          </button>

          {/* TAB 3: SIGNATURE STUDIO EMERALD ACTION BUTTON */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic('medium');
              setIsQuickActionOpen(!isQuickActionOpen);
            }}
            aria-label="Quick Action Menu"
            className="flex flex-col items-center justify-center flex-1 h-full py-1 select-none cursor-pointer active:scale-[0.92] transition-transform duration-150"
          >
            <div className="w-[36px] h-[36px] rounded-[8px] bg-[#3ecf8e] text-[#171717] flex items-center justify-center shadow-xs transition-all hover:opacity-90">
              <Plus className={cn('w-5 h-5 stroke-[2.5] transition-transform duration-200', isQuickActionOpen && 'rotate-45')} />
            </div>
          </button>

          {/* TAB 4: Cash Box / Advances */}
          <button
            type="button"
            onClick={() => handleNavClick(isCashier ? 'advances' : 'treasury')}
            aria-label={isCashier ? 'Staff Advances' : 'Cash Drawer & UPI'}
            className="flex flex-col items-center justify-center flex-1 h-full py-1 select-none cursor-pointer active:scale-[0.92] transition-transform duration-150"
          >
            <div
              className={cn(
                'w-7 h-7 rounded-[6px] flex items-center justify-center transition-colors',
                activePage === (isCashier ? 'advances' : 'treasury')
                  ? 'text-emerald-600 dark:text-[#3ecf8e]'
                  : 'text-slate-500 dark:text-[#a1a1a1]'
              )}
            >
              {isCashier ? <HandCoins className="w-[19px] h-[19px] stroke-[1.8]" /> : <Wallet className="w-[19px] h-[19px] stroke-[1.8]" />}
            </div>
            <span
              className={cn(
                'text-[10px] font-sans font-medium transition-colors tracking-tight',
                activePage === (isCashier ? 'advances' : 'treasury')
                  ? 'text-emerald-600 dark:text-[#3ecf8e] font-semibold'
                  : 'text-slate-500 dark:text-[#a1a1a1]'
              )}
            >
              {isCashier ? 'Advances' : 'Cash Box'}
            </span>
          </button>

          {/* TAB 5: Profile */}
          <button
            type="button"
            onClick={() => handleNavClick('profile')}
            aria-label="Profile"
            className="flex flex-col items-center justify-center flex-1 h-full py-1 select-none cursor-pointer active:scale-[0.92] transition-transform duration-150"
          >
            <div className="w-7 h-7 flex items-center justify-center shrink-0">
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt="Profile"
                  className={cn(
                    'w-[22px] h-[22px] rounded-full object-cover transition-all shrink-0',
                    activePage === 'profile'
                      ? 'ring-2 ring-[#3ecf8e] ring-offset-1 ring-offset-white dark:ring-offset-[#141414]'
                      : 'ring-1 ring-black/10 dark:ring-white/20'
                  )}
                />
              ) : (
                <div
                  className={cn(
                    'w-[22px] h-[22px] rounded-full flex items-center justify-center text-[9px] font-mono font-bold transition-all shrink-0',
                    activePage === 'profile'
                      ? 'bg-[#3ecf8e] text-[#171717] ring-2 ring-[#3ecf8e] ring-offset-1 ring-offset-white dark:ring-offset-[#141414]'
                      : 'bg-slate-200 dark:bg-[#2c2c2e] text-slate-800 dark:text-zinc-200 ring-1 ring-black/10 dark:ring-white/20'
                  )}
                >
                  {userInitials}
                </div>
              )}
            </div>
            <span
              className={cn(
                'text-[10px] font-sans font-medium transition-colors tracking-tight',
                activePage === 'profile'
                  ? 'text-emerald-600 dark:text-[#3ecf8e] font-semibold'
                  : 'text-slate-500 dark:text-[#a1a1a1]'
              )}
            >
              My Profile
            </span>
          </button>
        </div>
      </nav>

      {/* ========================================================================= */}
      {/* 2. SUPABASE STUDIO ACTION SHEET / BOTTOM DRAWER                            */}
      {/* ========================================================================= */}
      {isQuickActionOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end p-3 pb-safe select-none touch-manipulation">
          {/* Backdrop */}
          <div
            onClick={() => {
              triggerHaptic('light');
              setIsQuickActionOpen(false);
            }}
            className="fixed inset-0 bg-black/75 transition-opacity animate-in fade-in duration-150"
          />

          {/* Studio Action Sheet Container */}
          <div className="relative w-full max-w-md mx-auto space-y-2 z-10 animate-in slide-in-from-bottom duration-200 ease-out">
            {/* Action Group Card */}
            <div className="rounded-[12px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] shadow-2xl p-4 space-y-3">
              {/* Studio Grabber */}
              <div className="w-8 h-1 rounded-full bg-slate-300 dark:bg-[#333333] mx-auto" />

              <div className="text-center pb-1">
                <h2 className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider font-mono">
                  Quick Actions
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-[#8e8e8e]">
                  Add new expense, staff advance, or daily closing
                </p>
              </div>

              <div className="space-y-2 text-xs font-sans">
                {/* Option 1: Record New Expense */}
                {can('can_create_voucher') && (
                  <button
                    type="button"
                    onClick={() => handleNavClick('new-voucher')}
                    className="w-full flex items-center justify-between p-3 rounded-[8px] bg-emerald-500/10 hover:bg-emerald-500/15 text-slate-900 dark:text-white border border-emerald-500/20 transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-[6px] bg-[#3ecf8e] text-[#171717] flex items-center justify-center font-bold shadow-xs shrink-0">
                        <Receipt className="w-4 h-4 stroke-[2.2]" />
                      </div>
                      <div className="text-left">
                        <div className="font-semibold text-xs text-slate-900 dark:text-white">
                          Add Expense Bill
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-[#8e8e8e]">
                          Shop tea, stationery, repairs & transport
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-emerald-600 dark:text-[#3ecf8e] shrink-0" />
                  </button>
                )}
              </div>
            </div>

            {/* Cancel Button */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic('light');
                setIsQuickActionOpen(false);
              }}
              className="w-full h-11 rounded-[8px] bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#282828] text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-[#202020] font-medium text-xs shadow-md flex items-center justify-center cursor-pointer active:scale-[0.98] transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default MobileBottomNav;
