import { useSyncExternalStore } from "react";
import { flushPendingPlays, isOnlineNow, probeServer, subscribeReachability } from "../api";

/**
 * Whether the app can reach Navaar: the radio is on and, in the installed
 * app, the server has been answering (see Reachability in api.ts). This is
 * what the offline look keys off.
 */
function subscribe(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  const off = subscribeReachability(listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
    off();
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnlineNow);
}

let wired = false;

/**
 * Sends plays heard offline now, and again every time the connection comes
 * back. Called once the account is known; safe to call more than once.
 */
export function startPlaySync(): void {
  void flushPendingPlays();
  if (wired) return;
  wired = true;
  // The radio coming back is a hint, not proof: check the server answers,
  // then send what is waiting.
  window.addEventListener("online", () => {
    void probeServer().then((ok) => {
      if (ok) void flushPendingPlays();
    });
  });
  subscribeReachability(() => {
    if (isOnlineNow()) void flushPendingPlays();
  });
}
