/**
 * Everything this app knows about the Telegram Mini App host.
 *
 * Two rules govern this file.
 *
 * The first is that every call is version-guarded. A Mini App runs inside
 * whatever Telegram build the user happens to have, and calling a method the
 * client does not implement throws — which in practice means a white screen
 * for the people on the oldest apps. `call()` swallows that, so a missing
 * feature degrades to nothing happening.
 *
 * The second is that safe areas come from Telegram, and from CSS, and neither
 * one alone is enough. Inside the iOS Mini App WebView
 * `env(safe-area-inset-*)` resolves to zero: a layout built on it looks
 * perfect in a desktop browser and then clips under the notch and the home
 * indicator on a real phone. Android is the mirror image — Telegram reports
 * `safeAreaInset: 0` on plenty of devices that do have a gesture bar, and it
 * is `env()` that knows about it (now that index.html asks for
 * `viewport-fit=cover`, without which env() is dead there too).
 *
 * So Telegram numbers are mirrored onto `--tg-safe-*-tg` here, and index.css
 * combines each with its `env()` counterpart using `max()`. Whichever source
 * knows about the hardware wins, and the one reporting zero costs nothing.
 */

import { currentAccentHex } from "./context/ThemeContext";

export interface SafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface TelegramWebApp {
  initData: string;
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  viewportHeight: number;
  viewportStableHeight: number;
  isActive?: boolean;
  safeAreaInset?: SafeAreaInset;
  contentSafeAreaInset?: SafeAreaInset;

  ready: () => void;
  expand: () => void;
  close: () => void;
  isVersionAtLeast: (version: string) => boolean;

  onEvent: (event: string, handler: (...args: unknown[]) => void) => void;
  offEvent: (event: string, handler: (...args: unknown[]) => void) => void;

  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  setBottomBarColor?: (color: string) => void;

  /** Opens a t.me URL inside the Telegram client rather than a browser tab. */
  openTelegramLink?: (url: string) => void;

  /** Opens the native story editor with the given HTTPS image, Bot API 7.8+. */
  shareToStory?: (mediaUrl: string, params?: { text?: string; widget_link?: { url: string; name?: string } }) => void;

  disableVerticalSwipes?: () => void;
  enableVerticalSwipes?: () => void;
  enableClosingConfirmation: () => void;
  disableClosingConfirmation: () => void;

  /** Bot API 6.2+. Native "are you sure?" popup — no sheet to build. */
  showConfirm?: (message: string, callback?: (confirmed: boolean) => void) => void;

  BackButton: {
    isVisible: boolean;
    show: () => void;
    hide: () => void;
    onClick: (handler: () => void) => void;
    offClick: (handler: () => void) => void;
  };
  MainButton: {
    text: string;
    isVisible: boolean;
    show: () => void;
    hide: () => void;
    setParams: (params: {
      text?: string;
      color?: string;
      text_color?: string;
      is_active?: boolean;
      is_visible?: boolean;
    }) => void;
    onClick: (handler: () => void) => void;
    offClick: (handler: () => void) => void;
  };
  HapticFeedback: {
    impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
    selectionChanged: () => void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

// The SDK is loaded as a classic script from our own origin (see index.html and
// scripts/copy-telegram-sdk.mjs), which sets window.Telegram.WebApp before any
// module script runs. Outside Telegram nothing sets it, so this is undefined
// and callers simply never authenticate.
export function getTelegramWebApp(): TelegramWebApp | undefined {
  return window.Telegram?.WebApp;
}

/**
 * Whether the host is Telegram for Android — the one platform whose WebView
 * needs layout numbers iOS never did. See applyViewport and index.css's
 * .nav-platform-android section for what actually changes because of it.
 */
export function isAndroidTelegram(): boolean {
  return getTelegramWebApp()?.platform === "android";
}

/** Runs `fn` against the host, quietly, if the host is new enough for it. */
function call(minVersion: string, fn: (tg: TelegramWebApp) => void): void {
  const tg = getTelegramWebApp();
  if (!tg) return;
  try {
    if (!tg.isVersionAtLeast(minVersion)) return;
    fn(tg);
  } catch {
    // An older client that reports a new version, or a method the desktop
    // build does not implement. Neither is worth taking the app down for.
  }
}

// --- Palette ----------------------------------------------------------------

// Navaar is dark-only and owns its own palette, so the chrome is told to match
// the screen rather than the user's Telegram theme.
const CHROME = "#030303";

// --- Insets -----------------------------------------------------------------

function px(value: number | undefined): string {
  return `${Math.max(0, Math.round(value ?? 0))}px`;
}

function applyInsets(tg: TelegramWebApp): void {
  const root = document.documentElement.style;
  const safe = tg.safeAreaInset;
  const content = tg.contentSafeAreaInset;

  // The device inset (notch, home indicator) and the inset Telegram's own
  // header imposes on top of it are separate numbers, and both matter: the
  // first keeps content out of the hardware, the second keeps it out from
  // under the client's chrome.
  // The -tg suffix matters: index.css owns --tg-safe-top / --tg-safe-bottom
  // and derives them as max(these, env(...)). Writing the unsuffixed names
  // here would be an inline style on the same element and would win outright,
  // throwing away whatever env() knew.
  root.setProperty("--tg-safe-top-tg", px(safe?.top));
  root.setProperty("--tg-safe-bottom-tg", px(safe?.bottom));
  root.setProperty("--tg-content-top", px(content?.top));
  root.setProperty("--tg-content-bottom", px(content?.bottom));
}

/** Rejects a viewport reading that is missing or transiently tiny — Android's
 *  WebView can report as little as 1px for a single frame mid-transition —
 *  and falls back to the last figure that was actually usable. */
function usableHeight(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  return rounded >= 200 ? rounded : fallback;
}

// The last Android shell height that passed usableHeight's floor, kept so a
// single bad reading has something better than 0 to fall back to.
let lastAndroidShellHeight = 0;
let lastLoggedAndroidShell = 0;

/**
 * Publishes how much of the WebView Telegram is actually showing.
 *
 * iOS and every other non-Android platform keep the original two numbers,
 * unchanged: `--tg-viewport-stable-height` is the keyboard-free figure, and
 * `--tg-viewport-height` is live — min() of stable and visual — and is what
 * #root and the fixed overlays size themselves to. That's fine on iOS, whose
 * visualViewport is well-behaved and where nothing needs to dodge a keyboard
 * that also resizes the WebView.
 *
 * Android's visualViewport is the only reliable keyboard signal (Telegram
 * doesn't always fire `viewportChanged` when its own keyboard opens), but it
 * can also report a transient sub-200px height for a frame during a WebView
 * transition, and folding either straight into `--tg-viewport-height` used to
 * drag the whole shell — #root, the top bar, both bottom bars — around with
 * every keyboard open/close instead of just the handful of surfaces that
 * actually need to dodge it. So on Android, `--tg-viewport-height` stays the
 * stable shell figure and the keyboard-following number moves to its own
 * variable, `--nav-android-visible-height`, which only index.css's
 * `.nav-platform-android` override (`--nav-keyboard-height`) hands to those
 * surfaces. See Sheet in ui.tsx, ToastContext, PlayerView and CrateSection.
 */
function applyViewport(tg: TelegramWebApp): void {
  const stableRaw = tg.viewportStableHeight || tg.viewportHeight || window.innerHeight;
  const root = document.documentElement.style;

  if (tg.platform !== "android") {
    const visible = window.visualViewport?.height ?? stableRaw;
    root.setProperty("--tg-viewport-stable-height", `${Math.round(stableRaw)}px`);
    root.setProperty(
      "--tg-viewport-height",
      `${Math.round(Math.min(stableRaw, visible))}px`
    );
    return;
  }

  const fallback = Math.max(
    window.innerHeight || 0,
    document.documentElement.clientHeight || 0,
    lastAndroidShellHeight
  );
  const shell = usableHeight(stableRaw, fallback);
  lastAndroidShellHeight = shell;
  const visible = Math.min(shell, usableHeight(window.visualViewport?.height, shell));

  root.setProperty("--tg-viewport-stable-height", `${shell}px`);
  root.setProperty("--tg-viewport-height", `${shell}px`);
  root.setProperty("--nav-android-visible-height", `${visible}px`);
  root.setProperty("--nav-android-keyboard-overlap", `${shell - visible}px`);

  if (import.meta.env.DEV && shell !== lastLoggedAndroidShell) {
    lastLoggedAndroidShell = shell;
    console.debug("[telegram] android viewport", { shell, visible, overlap: shell - visible });
  }
}

/**
 * Brings the Mini App up and wires the host events we depend on. Returns a
 * teardown function; safe to call outside Telegram, where it does nothing.
 */
export function initTelegramPlatform(): () => void {
  const tg = getTelegramWebApp();
  if (!tg) return () => {};

  // The one class every Android-only rule in index.css is gated behind.
  const android = tg.platform === "android";
  document.documentElement.classList.toggle("nav-platform-android", android);

  tg.ready();
  tg.expand();

  // Blocking, and the reason this runs before anything renders: without it a
  // downward drag anywhere in the app is read by the client as "close", so
  // dragging the scrubber or reordering the queue dismisses Navaar mid-gesture.
  call("7.7", (t) => t.disableVerticalSwipes?.());

  call("6.1", (t) => {
    t.setHeaderColor(CHROME);
    t.setBackgroundColor(CHROME);
  });
  call("7.10", (t) => t.setBottomBarColor?.(CHROME));

  applyInsets(tg);
  applyViewport(tg);

  const onSafeArea = () => applyInsets(tg);
  const onViewport = () => {
    applyInsets(tg);
    applyViewport(tg);
  };

  tg.onEvent("safeAreaChanged", onSafeArea);
  tg.onEvent("contentSafeAreaChanged", onSafeArea);
  tg.onEvent("viewportChanged", onViewport);

  // The keyboard, on the clients that do not announce it. See applyViewport.
  const vv = window.visualViewport;
  const onVisualViewport = () => applyViewport(tg);
  vv?.addEventListener("resize", onVisualViewport);
  vv?.addEventListener("scroll", onVisualViewport);

  return () => {
    document.documentElement.classList.remove("nav-platform-android");
    tg.offEvent("safeAreaChanged", onSafeArea);
    tg.offEvent("contentSafeAreaChanged", onSafeArea);
    tg.offEvent("viewportChanged", onViewport);
    vv?.removeEventListener("resize", onVisualViewport);
    vv?.removeEventListener("scroll", onVisualViewport);
  };
}

// --- Haptics ----------------------------------------------------------------

/**
 * The physical half of every confirmation in the app. Transport, toggles,
 * saves and queue actions all go through here so that "it did something" never
 * depends on the user having been looking at the right part of the screen.
 */
export const haptic = {
  tap(): void {
    call("6.1", (t) => t.HapticFeedback.impactOccurred("light"));
  },
  press(): void {
    call("6.1", (t) => t.HapticFeedback.impactOccurred("medium"));
  },
  select(): void {
    call("6.1", (t) => t.HapticFeedback.selectionChanged());
  },
  success(): void {
    call("6.1", (t) => t.HapticFeedback.notificationOccurred("success"));
  },
  warning(): void {
    call("6.1", (t) => t.HapticFeedback.notificationOccurred("warning"));
  },
  error(): void {
    call("6.1", (t) => t.HapticFeedback.notificationOccurred("error"));
  },
};

// --- Closing confirmation ---------------------------------------------------

/**
 * On while audio is playing, off when it is not. A stray swipe should not end
 * a song, but confirming an exit the user actually meant is just friction.
 */
export function setClosingConfirmation(enabled: boolean): void {
  call("6.2", (t) =>
    enabled ? t.enableClosingConfirmation() : t.disableClosingConfirmation()
  );
}

// --- Confirm ------------------------------------------------------------

/**
 * "Are you sure?" for the handful of actions in the app that cannot be undone
 * with a toast — Telegram's own native popup rather than a `Sheet` built to
 * ask one yes/no question. Resolves `false` outside Telegram, or on a client
 * too old for it, so a caller always gets an answer rather than a hang; on
 * the web (no Telegram host at all) it falls back to `window.confirm`.
 */
export function confirmAction(message: string): Promise<boolean> {
  const tg = getTelegramWebApp();
  const showConfirm = tg?.showConfirm;
  if (!tg || !showConfirm) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => {
    try {
      if (!tg.isVersionAtLeast("6.2")) {
        resolve(window.confirm(message));
        return;
      }
      showConfirm(message, (confirmed) => resolve(confirmed));
    } catch {
      resolve(window.confirm(message));
    }
  });
}

// --- Back button ------------------------------------------------------------

/**
 * Shows Telegram's own back button and routes it to `handler`, or hides it
 * when `handler` is null. There are no in-app back chevrons anywhere in
 * Navaar: two back affordances on one screen is how people end up two screens
 * away from where they meant to be.
 */
export function setBackButton(handler: (() => void) | null): () => void {
  const tg = getTelegramWebApp();
  if (!tg) return () => {};

  if (!handler) {
    try {
      tg.BackButton.hide();
    } catch {
      /* older client */
    }
    return () => {};
  }

  try {
    tg.BackButton.onClick(handler);
    tg.BackButton.show();
  } catch {
    return () => {};
  }

  return () => {
    try {
      tg.BackButton.offClick(handler);
      tg.BackButton.hide();
    } catch {
      /* older client */
    }
  };
}

// --- Main button ------------------------------------------------------------

export interface MainButtonConfig {
  text: string;
  onClick: () => void;
  enabled?: boolean;
}

/** The primary action of a sheet, rendered by Telegram rather than by us. */
export function setMainButton(config: MainButtonConfig | null): () => void {
  const tg = getTelegramWebApp();
  if (!tg) return () => {};

  if (!config) {
    try {
      tg.MainButton.hide();
    } catch {
      /* older client */
    }
    return () => {};
  }

  const handler = config.onClick;
  try {
    tg.MainButton.setParams({
      text: config.text,
      color: currentAccentHex(),
      text_color: "#0A0A0A",
      is_active: config.enabled !== false,
      is_visible: true,
    });
    tg.MainButton.onClick(handler);
  } catch {
    return () => {};
  }

  return () => {
    try {
      tg.MainButton.offClick(handler);
      tg.MainButton.hide();
    } catch {
      /* older client */
    }
  };
}

// --- Foreground / background ------------------------------------------------

/**
 * Whether the Mini App is the thing the user is looking at.
 *
 * This exists so the player can record where it got to when Telegram is put
 * aside, and for nothing else. There is deliberately no background-playback
 * toggle: the WebView is suspended when the app loses focus, so a switch
 * promising playback would be a switch that lies.
 */
export function onActivationChange(
  handler: (isActive: boolean) => void
): () => void {
  const tg = getTelegramWebApp();
  if (!tg) return () => {};

  const activated = () => handler(true);
  const deactivated = () => handler(false);

  try {
    tg.onEvent("activated", activated);
    tg.onEvent("deactivated", deactivated);
  } catch {
    return () => {};
  }

  return () => {
    tg.offEvent("activated", activated);
    tg.offEvent("deactivated", deactivated);
  };
}

/**
 * Hands a link to Telegram's own forward sheet.
 *
 * An invite is a message to a particular person, and Telegram already knows
 * who that person is; a copy-to-clipboard button would ask the user to leave
 * the app and go find the chat themselves. Outside Telegram there is nothing
 * to open, so the caller is told and can fall back to showing the URL.
 */
export function shareLink(url: string, text: string): boolean {
  const app = getTelegramWebApp();
  if (!app?.openTelegramLink) return false;
  app.openTelegramLink(
    `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
  );
  return true;
}

/**
 * Opens the native story editor with a rendered card. `mediaUrl` has to be a
 * real HTTPS URL Telegram's own servers can fetch — a blob: URL from the
 * canvas that drew it won't do — which is why callers upload the card first
 * and pass back the link that upload returns.
 */
export function shareToStory(mediaUrl: string, appLink?: string): boolean {
  const app = getTelegramWebApp();
  if (!app?.shareToStory || !app.isVersionAtLeast("7.8")) return false;
  app.shareToStory(mediaUrl, appLink ? { widget_link: { url: appLink, name: "Navaar" } } : undefined);
  return true;
}

/**
 * Falls back to the platform's own share/save picker when `shareToStory`
 * isn't available (Telegram < 7.8, or outside Telegram entirely): the Web
 * Share API with a real `File` when the browser supports sharing files, or a
 * plain anchor download otherwise. Returns which path was taken so a caller
 * can toast accordingly.
 */
export async function saveOrShareBlob(blob: Blob, filename: string): Promise<"shared" | "saved"> {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch {
      // Fall through to the download path — a cancelled share is not an error.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return "saved";
}
