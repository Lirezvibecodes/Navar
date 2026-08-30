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
}

/**
 * Publishes how much of the WebView Telegram is actually showing.
 *
 * Two numbers, because the app needs both. `--tg-viewport-stable-height` is
 * the keyboard-free figure: the floor for anything that must not leap up the
 * screen the moment a search field takes focus. `--tg-viewport-height` is the
 * live one, and it is what #root and every fixed overlay size themselves to.
 *
 * The visual viewport is in there because Android Telegram does not reliably
 * fire `viewportChanged` when its own keyboard opens, while
 * `window.visualViewport` always does — an overlay pinned to the stable
 * height simply sits underneath the keyboard there. min() of the two, so a
 * WebView that is taller than the part Telegram is showing cannot win.
 */
function applyViewport(tg: TelegramWebApp): void {
  const stable = tg.viewportStableHeight || tg.viewportHeight || window.innerHeight;
  const visible = window.visualViewport?.height ?? stable;
  const root = document.documentElement.style;
  root.setProperty("--tg-viewport-stable-height", `${Math.round(stable)}px`);
  root.setProperty(
    "--tg-viewport-height",
    `${Math.round(Math.min(stable, visible))}px`
  );
}

/**
 * Brings the Mini App up and wires the host events we depend on. Returns a
 * teardown function; safe to call outside Telegram, where it does nothing.
 */
export function initTelegramPlatform(): () => void {
  const tg = getTelegramWebApp();
  if (!tg) return () => {};

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
