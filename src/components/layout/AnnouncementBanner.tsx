import React, { useState, useEffect, useCallback } from "react";
import { X, WifiOff, ArrowUpRight, RefreshCw, Zap } from "lucide-react";
import { useNotificationStore } from "@/store/notificationStore";
import { useOfflineQueue } from "@/lib/offlineQueue";
import { cn } from "@/lib/utils";

type BannerMode = "offline" | "sync_pending" | "broadcast" | null;

// ─── Lightweight Hardware-Accelerated Announcement Banner (0 kB External Dependencies) ───
export const AnnouncementBanner: React.FC = () => {
  const { mutations, isOnline, isSyncing, processSyncQueue } = useOfflineQueue();
  const [isBroadcastDismissed, setIsBroadcastDismissed] = useState(() =>
    typeof sessionStorage !== "undefined"
      ? sessionStorage.getItem("asopalav-broadcast-dismissed") === "true"
      : false
  );
  const [dismissedBroadcastId, setDismissedBroadcastId] = useState<string | null>(() =>
    typeof sessionStorage !== "undefined"
      ? sessionStorage.getItem("asopalav-broadcast-dismissed-id")
      : null
  );
  const [isExiting, setIsExiting] = useState(false);

  const { broadcast } = useNotificationStore();

  useEffect(() => {
    if (broadcast && broadcast.id !== dismissedBroadcastId) {
      setIsBroadcastDismissed(false);
      setIsExiting(false);
    }
  }, [broadcast, dismissedBroadcastId]);

  const mode: BannerMode = !isOnline
    ? "offline"
    : mutations.length > 0
    ? "sync_pending"
    : broadcast && !isBroadcastDismissed
    ? "broadcast"
    : null;

  
  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      if (broadcast) {
        sessionStorage.setItem("asopalav-broadcast-dismissed", "true");
        sessionStorage.setItem("asopalav-broadcast-dismissed-id", broadcast.id);
        setDismissedBroadcastId(broadcast.id);
      }
      setIsBroadcastDismissed(true);
      setIsExiting(false);
    }, 220);
  }, [broadcast]);

  if (!mode || (mode === "broadcast" && isBroadcastDismissed)) return null;

  return (
    <aside
      className={cn(
        "w-full overflow-hidden select-none transition-all duration-200 ease-out",
        isExiting ? "max-h-0 opacity-0 -translate-y-2 pointer-events-none" : "max-h-24 opacity-100 translate-y-0"
      )}
      role="status"
      aria-live="polite"
    >
      <div
        className={cn(
          "relative flex min-h-[38px] w-full items-center justify-between px-4 py-2 text-xs font-medium sm:px-6 transition-colors border-b",
          mode === "offline"
            ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
            : mode === "sync_pending"
            ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/40 dark:bg-[#17130b] dark:text-amber-200"
            : "border-amber-200 dark:border-amber-900/30 bg-amber-50 dark:bg-[#16130d] text-amber-900 dark:text-amber-200"
        )}
      >
        {/* Main Content Strip */}
        <div className="flex flex-1 items-center justify-center gap-2 sm:gap-2.5 overflow-hidden pr-8 sm:pr-0">
          {mode === "offline" ? (
            <>
              <WifiOff className="w-3.5 h-3.5 shrink-0 text-rose-600 dark:text-rose-400 animate-pulse" aria-hidden />
              <span className="inline-flex items-center px-1.5 py-0.2 rounded-[4px] bg-rose-100 dark:bg-rose-500/20 border border-rose-300 dark:border-rose-500/35 text-rose-800 dark:text-rose-300 text-[10px] font-mono font-bold tracking-wider uppercase shrink-0 shadow-2xs">
                OFFLINE
              </span>
              <span aria-hidden="true" className="text-rose-400 dark:text-rose-500/30">▪</span>
              <p className="leading-snug text-center text-xs truncate font-medium text-rose-950 dark:text-rose-200">
                {mutations.length > 0
                  ? `${mutations.length} transaction(s) queued locally. Will auto-sync when reconnected.`
                  : "Zero-downtime counter active. Entries will save locally and sync upon reconnect."}
              </p>
            </>
          ) : mode === "sync_pending" ? (
            <>
              <Zap className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-500 animate-pulse" aria-hidden />
              <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-[4px] bg-amber-100 dark:bg-amber-500/20 border border-amber-300 dark:border-amber-500/35 text-amber-800 dark:text-amber-300 text-[10px] font-mono font-bold tracking-wider uppercase shrink-0 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                <span>SYNC PENDING</span>
              </span>
              <span aria-hidden="true" className="text-amber-400 dark:text-amber-500/30">▪</span>
              <p className="leading-snug text-center text-xs truncate font-medium text-amber-950 dark:text-amber-200">
                {mutations.length} offline transaction(s) ready to sync to cloud database.
              </p>
              <button
                type="button"
                onClick={() => processSyncQueue()}
                disabled={isSyncing}
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[4px] bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400 text-white dark:text-black font-mono text-[11px] font-medium transition-colors cursor-pointer shrink-0 shadow-xs"
              >
                <RefreshCw className={cn("w-3 h-3", isSyncing && "animate-spin")} />
                <span>{isSyncing ? "Syncing..." : "Sync Now"}</span>
              </button>
            </>
          ) : (
            <>
              {/* Destructive / High-Attention Badge with Pulse */}
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] text-[10px] font-mono font-bold tracking-wider uppercase bg-rose-100 dark:bg-rose-500/15 border border-rose-300 dark:border-rose-500/30 text-rose-800 dark:text-rose-300 shrink-0 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                <span>{broadcast?.badge || "ALERT"}</span>
              </span>
              <span aria-hidden="true" className="text-amber-400 dark:text-amber-800">▪</span>
              {/* Warning Styled Announcement Message */}
              <p className="leading-snug text-center text-xs font-sans truncate text-amber-950 dark:text-amber-200 font-medium">
                {broadcast?.message}
              </p>
              {broadcast?.link && (() => {
                try {
                  const url = new URL(broadcast.link);
                  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
                  return (
                    <>
                      <span aria-hidden="true" className="text-amber-300 dark:text-amber-800">▪</span>
                      <a
                        href={broadcast.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex shrink-0 items-center gap-1 text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 underline underline-offset-4 decoration-amber-500/40 hover:decoration-amber-500 text-xs font-sans font-medium transition-colors cursor-pointer"
                      >
                        <span>Learn more</span>
                        <ArrowUpRight className="w-3.5 h-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                      </a>
                    </>
                  );
                } catch {
                  return null;
                }
              })()}
            </>
          )}
        </div>

        {/* Dismiss button: for broadcast messages */}
        {mode === "broadcast" && (
          <button
            onClick={handleDismiss}
            className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-[4px] transition-colors cursor-pointer text-amber-600/70 hover:text-amber-900 dark:text-amber-400/70 dark:hover:text-amber-200 hover:bg-amber-100/60 dark:hover:bg-amber-950/40"
            aria-label="Dismiss announcement"
            title="Dismiss for this session"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </aside>
  );
};
