import React from 'react';
import { ShieldAlert, Home, Lock } from 'lucide-react';
import { useUIStore } from '@/store/uiStore';

interface AccessDeniedViewProps {
  title?: string;
  message?: string;
  pageName?: string;
  onGoBack?: () => void;
}

export const AccessDeniedView: React.FC<AccessDeniedViewProps> = ({
  title = 'Access Restricted',
  message,
  pageName,
  onGoBack,
}) => {
  const { setActivePage } = useUIStore();

  const handleReturn = () => {
    if (onGoBack) {
      onGoBack();
    } else {
      setActivePage('dashboard');
    }
  };

  return (
    <div className="min-h-full flex-1 flex flex-col items-center justify-center p-4 sm:p-6 select-none font-sans bg-slate-50 dark:bg-[#141414]">
      <div className="max-w-md w-full rounded-[12px] bg-white dark:bg-[#1c1c1c] border border-slate-200 dark:border-[#2e2e2e] shadow-2xl p-6 text-center space-y-5 my-auto">
        {/* Lock / Security Icon Badge */}
        <div className="w-12 h-12 rounded-[8px] bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 flex items-center justify-center mx-auto shadow-xs">
          <ShieldAlert className="w-6 h-6 stroke-[2]" />
        </div>

        {/* Text Details */}
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[6px] bg-rose-500/10 text-rose-700 dark:text-rose-400 text-[11px] font-mono font-medium border border-rose-500/20">
            <Lock className="w-3 h-3" />
            <span>403 Unauthorized Access</span>
          </div>

          <h2 className="text-lg font-semibold text-slate-900 dark:text-white font-sans tracking-tight pt-1">
            {title}
          </h2>

          <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed font-sans max-w-sm mx-auto">
            {message ||
              `Your current account role does not have permission to view ${
                pageName ? `the ${pageName} console` : 'this page'
              }. No unauthorized data has been loaded.`}
          </p>
        </div>

        {/* Security Notice */}
        <div className="p-3 rounded-[6px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#2e2e2e] text-[11px] text-slate-500 dark:text-zinc-400 font-mono text-left">
          <p className="font-semibold text-slate-700 dark:text-zinc-300">🛡️ Security Safeguard:</p>
          <p className="mt-0.5">
            If you need access to this page or showroom data, please request permission from your Store Manager or Super Admin.
          </p>
        </div>

        {/* Return to Dashboard CTA */}
        <div className="pt-2">
          <button
            type="button"
            onClick={handleReturn}
            className="w-full h-10 min-h-[40px] px-4 py-2 rounded-[6px] bg-[#3ecf8e] hover:bg-[#24b47e] text-[#171717] font-semibold font-sans text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs"
          >
            <Home className="w-3.5 h-3.5" />
            <span>Return to Dashboard</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccessDeniedView;
