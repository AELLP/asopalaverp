import React, { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { supabase } from '@/lib/supabase';
import {
  Eye,
  EyeOff,
  AlertCircle,
  Sun,
  Moon,
  Lock,
  X,
  Phone,
  HelpCircle,
} from 'lucide-react';
import { useBrandStore } from '@/store/brandStore';
import { animateErrorBanner } from '@/lib/animations';
import { logSecurityEvent } from '@/lib/audit';

import bcrypt from 'bcryptjs';
import { showToast } from '@/components/ui/ToastContainer';

export const LoginPage: React.FC = () => {
  const { brandName } = useBrandStore();
  const { login } = useAuthStore();
  const { theme, toggleTheme } = useUIStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // M-1 Security: Persist lockout to sessionStorage so page refresh doesn't reset brute-force protection
  const [failedAttempts, setFailedAttempts] = useState<number>(() => {
    try { return parseInt(sessionStorage.getItem('asopalav_login_failures') || '0', 10); } catch { return 0; }
  });
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(() => {
    try {
      const v = sessionStorage.getItem('asopalav_login_lockout');
      return v ? parseInt(v, 10) : null;
    } catch { return null; }
  });

  const setFailedAttemptsP = (n: number) => {
    setFailedAttempts(n);
    try { sessionStorage.setItem('asopalav_login_failures', String(n)); } catch {}
  };
  const setLockoutUntilP = (t: number | null) => {
    setLockoutUntil(t);
    try {
      if (t === null) sessionStorage.removeItem('asopalav_login_lockout');
      else sessionStorage.setItem('asopalav_login_lockout', String(t));
    } catch {}
  };

  // Forgot password modal state
  const [showForgotModal, setShowForgotModal] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    if (lockoutUntil && Date.now() < lockoutUntil) {
      const remainingSeconds = Math.ceil((lockoutUntil - Date.now()) / 1000);
      setError(`Too many failed attempts. Please wait ${remainingSeconds} seconds.`);
      setIsLoading(false);
      return;
    }

    const cleanUser = username.trim().toLowerCase();
    const cleanPass = password.trim();

    // Input validation against PostgREST injection
    if (!/^[a-zA-Z0-9_.@-]{1,100}$/.test(cleanUser)) {
      setError('Invalid username or password. Please verify your credentials.');
      showToast({
        type: 'error',
        title: 'Login Failed',
        message: 'Invalid username or password. Please check your credentials.',
      });
      setIsLoading(false);
      return;
    }

    try {
      // 0. Primary Secure Server-Side RPC Verification (Zero Hash Leakage)
      try {
        const { data: rpcAuth, error: rpcAuthErr } = await supabase.rpc('verify_user_credentials', {
          p_username_or_email: cleanUser,
          p_plain_password: cleanPass,
        });

        if (!rpcAuthErr && rpcAuth) {
          if (rpcAuth.success && rpcAuth.user) {
            setFailedAttemptsP(0);
            setLockoutUntilP(null);
            await login(rpcAuth.user);
            showToast({
              type: 'success',
              title: `Welcome, ${rpcAuth.user.first_name || rpcAuth.user.username}!`,
              message: `Signed in to Asopalav ERP (${rpcAuth.user.role_code || 'User'})`,
            });
            setIsLoading(false);
            return;
          } else if (rpcAuth.message && rpcAuth.message.includes('deactivated')) {
            setError(rpcAuth.message);
            showToast({ type: 'error', title: 'Account Deactivated', message: rpcAuth.message });
            setIsLoading(false);
            return;
          }
        }
      } catch (rpcEx) {
        // Fallback to client query if RPC not yet deployed
      }

      // 1. Fast User Query with Timeout Guarantee (Max 3.5s)
      const queryPromise = supabase
        .from('app_users')
        .select('id, username, first_name, last_name, email, avatar_url, role_code, assigned_branches, avatar_initials, theme_preference, is_active, password_hash, lock_pin_hash')
        .or(`username.eq.${cleanUser},email.eq.${cleanUser}`)
        .limit(1);

      const timeoutPromise = new Promise<{ data: any[] | null; error: any }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: new Error('Network Timeout') }), 3500)
      );

      const { data: dbUsers, error: dbError } = await Promise.race([queryPromise, timeoutPromise]);

      if (dbError && dbError.message !== 'Network Timeout') {
        console.warn('User query issue:', dbError);
      }

      // Pick exact username/email match if multiple returned, otherwise first candidate
      let dbUser: any = null;
      if (dbUsers && dbUsers.length > 0) {
        dbUser =
          dbUsers.find(
            (u: any) =>
              u.username.toLowerCase() === cleanUser ||
              (u.email && u.email.toLowerCase() === cleanUser)
          ) || dbUsers[0];
      }

      // 2. Strict Password Verification (Bcrypt + constant-time comparison)
      const DUMMY_HASH = '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqr';
      const verifyCredential = (plain: string, storedHash?: string | null): boolean => {
        if (!storedHash || !plain) return false;
        if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
          try {
            return bcrypt.compareSync(plain, storedHash);
          } catch {
            return false;
          }
        }
        if (import.meta.env.DEV && storedHash === plain) return true;
        return false;
      };

      if (!dbUser) {
        try { bcrypt.compareSync(cleanPass, DUMMY_HASH); } catch {}

        const newAttempts = failedAttempts + 1;
        setFailedAttemptsP(newAttempts);
        if (newAttempts >= 5) {
          const lockDuration = Math.min(30 * Math.pow(2, Math.floor(newAttempts / 5) - 1), 300) * 1000;
          setLockoutUntilP(Date.now() + lockDuration);
        }
        setError('Invalid username or password. Please verify your credentials.');
        showToast({
          type: 'error',
          title: 'Login Failed',
          message: 'Invalid username or password. Please check your credentials.',
        });
        setIsLoading(false);
        logSecurityEvent({
          userName: cleanUser,
          userRole: 'Anonymous',
          actionType: 'Login_Failure' as any,
          targetEntity: 'app_users',
          targetIdentifier: cleanUser,
          eventDescription: `Failed login attempt: Account '${cleanUser}' not found`,
          justification: 'Authentication failure',
        });
        return;
      }

      if (dbUser.is_active === false) {
        setError('This account has been deactivated. Please contact your Store Administrator.');
        showToast({
          type: 'error',
          title: 'Account Deactivated',
          message: 'This account has been deactivated. Please contact your Store Administrator.',
        });
        setIsLoading(false);
        return;
      }

      const isValid = verifyCredential(cleanPass, dbUser.password_hash);

      if (!isValid) {
        const newAttempts = failedAttempts + 1;
        setFailedAttemptsP(newAttempts);
        if (newAttempts >= 5) {
          const lockDuration = Math.min(30 * Math.pow(2, Math.floor(newAttempts / 5) - 1), 300) * 1000;
          setLockoutUntilP(Date.now() + lockDuration);
        }
        setError('Invalid username or password. Please verify your credentials.');
        showToast({
          type: 'error',
          title: 'Login Failed',
          message: 'Invalid username or password. Please check your credentials.',
        });
        setIsLoading(false);
        logSecurityEvent({
          userName: `${dbUser.first_name || ''} ${dbUser.last_name || ''}`.trim() || cleanUser,
          userRole: dbUser.role_code || 'Cashier',
          actionType: 'Login_Failure' as any,
          targetEntity: 'app_users',
          targetIdentifier: cleanUser,
          eventDescription: `Failed login attempt for user @${cleanUser}: Incorrect password`,
          justification: 'Invalid credential provided',
        });
        return;
      }

      // 3. Successful Authentication
      setFailedAttemptsP(0);
      setLockoutUntilP(null);
      const normalizedRole = dbUser.role_code === 'Showroom_Cashier' ? 'Cashier' : (dbUser.role_code || 'Cashier');
      const userPayload = {
        id: dbUser.id,
        username: dbUser.username,
        first_name: dbUser.first_name,
        last_name: dbUser.last_name,
        email: dbUser.email || undefined,
        avatar_url: dbUser.avatar_url || undefined,
        role_code: normalizedRole,
        assigned_branches: Array.isArray(dbUser.assigned_branches) ? dbUser.assigned_branches : ['*'],
        avatar_initials:
          dbUser.avatar_initials ||
          `${dbUser.first_name?.[0] || ''}${dbUser.last_name?.[0] || ''}`.toUpperCase(),
        theme_preference: dbUser.theme_preference || 'Dark',
        is_active: dbUser.is_active ?? true,
      };

      logSecurityEvent({
        userName: `${userPayload.first_name} ${userPayload.last_name}`.trim(),
        userRole: userPayload.role_code,
        actionType: 'User_Login' as any,
        targetEntity: 'app_users',
        targetIdentifier: userPayload.username,
        eventDescription: `User @${userPayload.username} authenticated successfully`,
        justification: 'Interactive terminal login',
      });

      showToast({
        type: 'success',
        title: 'Welcome Back!',
        message: `Logged in as ${userPayload.first_name} ${userPayload.last_name || ''} (${userPayload.role_code}).`,
      });

      await login(userPayload);
      useUIStore.getState().setActivePage('dashboard', true);
    } catch (err: any) {
      console.error('Auth error:', err);
      setError('An error occurred during authentication. Please try again.');
      showToast({
        type: 'error',
        title: 'Authentication Error',
        message: 'An error occurred during authentication. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col justify-between bg-slate-50 dark:bg-black font-sans text-slate-900 dark:text-[#ededed] p-4 sm:p-6 lg:p-8 select-none selection:bg-[#3ecf8e]/25 selection:text-[#3ecf8e] relative overflow-hidden">
      {/* ========================================================================= */}
      {/* TOP BAR: THEME SWITCHER (RIGHT ALIGNED)                                   */}
      {/* ========================================================================= */}
      <div className="w-full max-w-4xl mx-auto flex items-center justify-end relative z-10 bg-transparent">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Current Theme: ${theme}. Click to switch.`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border border-slate-200 dark:border-[#2e2e2e] bg-white dark:bg-[#1c1c1c] hover:bg-slate-50 dark:hover:bg-[#252525] text-slate-700 dark:text-zinc-200 text-xs font-medium transition-colors cursor-pointer shadow-xs"
        >
          {theme === 'light' ? (
            <>
              <Moon className="w-3.5 h-3.5 text-slate-700" />
              <span>Dark Mode</span>
            </>
          ) : (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-500" />
              <span>Light Mode</span>
            </>
          )}
        </button>
      </div>

      {/* ========================================================================= */}
      {/* CENTER: STUDIO LOGIN CARD                                                 */}
      {/* ========================================================================= */}
      <div className="w-full max-w-[400px] mx-auto my-auto p-6 sm:p-8 space-y-6 relative z-10 bg-white dark:bg-[#171717] border border-slate-200 dark:border-[#262626] rounded-[12px]">
        {/* Card Header */}
        <div className="space-y-1.5 text-left">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white font-sans">
            Welcome back
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-[#8e8e93] font-sans">
            Sign in to your {brandName} account
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          {/* Email / Username Field */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-[#a1a1a6]">
              Email or Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="you@example.com"
              autoComplete="username"
              className="w-full h-10 min-h-[40px] px-3.5 rounded-[6px] bg-white dark:bg-[#121212] border border-slate-200 dark:border-[#282828] text-xs sm:text-sm text-slate-900 dark:text-[#ededed] placeholder:text-slate-400 dark:placeholder:text-[#707070] focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 transition-all font-sans"
              required
            />
          </div>

          {/* Password Field */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-slate-700 dark:text-[#a1a1a6]">
                Password
              </label>
              <button
                type="button"
                onClick={() => setShowForgotModal(true)}
                className="text-xs text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white transition-colors cursor-pointer"
              >
                Forgot password?
              </button>
            </div>
            <div className="relative flex items-center">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="current-password"
                className="w-full h-10 min-h-[40px] pl-3.5 pr-10 rounded-[6px] bg-white dark:bg-[#121212] border border-slate-200 dark:border-[#282828] text-xs sm:text-sm text-slate-900 dark:text-[#ededed] placeholder:text-slate-400 dark:placeholder:text-[#707070] focus:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]/30 transition-all font-mono"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 text-slate-400 hover:text-slate-700 dark:text-zinc-500 dark:hover:text-white transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div
              ref={(el) => {
                if (el && error) {
                  animateErrorBanner(el);
                }
              }}
              className="p-3 rounded-[6px] bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs font-sans flex items-center gap-2 font-medium"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Primary Emerald CTA */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full h-10 mt-2 rounded-[6px] bg-[#3ecf8e] hover:bg-[#3ecf8e]/90 text-[#171717] font-semibold text-xs sm:text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 select-none"
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-[#171717] border-t-transparent rounded-full animate-spin" />
                <span>Signing in...</span>
              </>
            ) : (
              <span>Sign in</span>
            )}
          </button>
        </form>

        {/* Encrypted Session Tag */}
        <div className="pt-1 flex items-center justify-center gap-1.5 text-[11px] text-[#707070] dark:text-[#8E8E93]">
          <Lock className="w-3 h-3 text-emerald-600 dark:text-[#3ecf8e]" />
          <span>End-to-End Encrypted Session</span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* FOOTER: COPYRIGHT & PROTOCOL INFO                                         */}
      {/* ========================================================================= */}
      <div className="w-full max-w-4xl mx-auto text-center py-2 text-[11px] text-[#707070] dark:text-[#8E8E93] font-sans bg-transparent">
        <span>Protected by Asopalav Role-Based Security</span>
      </div>

      {/* ========================================================================= */}
      {/* FORGOT PASSWORD MODAL                                                     */}
      {/* ========================================================================= */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75">
          <div className="w-full max-w-md bg-white dark:bg-[#1c1c1c] border border-slate-200 dark:border-[#2e2e2e] rounded-[12px] p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#2e2e2e] pb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-[6px] bg-emerald-500/10 border border-emerald-500/20 text-[#3ecf8e] flex items-center justify-center">
                  <HelpCircle className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white font-sans">
                  Reset Account Access
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowForgotModal(false)}
                className="p-1 rounded-[6px] text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#252525] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 dark:text-zinc-300 font-sans">
              <p className="leading-relaxed">
                Asopalav ERP utilizes role-based enterprise credentials. For security and cash drawer compliance, password resets must be authorized by an Administrator.
              </p>

              <div className="p-3.5 rounded-[6px] bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#2e2e2e] space-y-2">
                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-emerald-600 dark:text-[#3ecf8e]" />
                  <span>How to reset your access:</span>
                </div>
                <ul className="list-disc list-inside space-y-1 text-slate-500 dark:text-zinc-400">
                  <li>Contact your <strong>Store Branch Manager</strong> or <strong>Accounts Lead</strong>.</li>
                  <li>Super Administrators can reset credentials directly under <strong>Staff Directory → Security</strong>.</li>
                  <li>In case of urgent counter lockout, notify IT Support on the store intercom.</li>
                </ul>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowForgotModal(false)}
                className="w-full h-9 rounded-[6px] bg-slate-900 dark:bg-white text-white dark:text-[#171717] hover:bg-slate-800 dark:hover:bg-zinc-200 font-medium text-xs transition-colors cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
