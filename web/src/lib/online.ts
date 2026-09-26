import { useSyncExternalStore } from "react";
import { flushPendingPlays } from "../api";

/**
 * Whether the device has a connection, as the browser sees it. That can be
 * optimistic — on a network with no way out it still says yes — but when it
 * says no it is right, and "no" is what the offline look keys off.
 */
function subscribe(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine);
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
  window.addEventListener("online", () => void flushPendingPlays());
}
