export interface TelegramWebApp {
  initData: string;
  colorScheme: "light" | "dark";
  ready: () => void;
  expand: () => void;
  close: () => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

// The SDK is loaded as a classic script from our own origin (see index.html and
// scripts/copy-telegram-sdk.mjs), which sets window.Telegram.WebApp before any
// module script runs. Outside Telegram nothing sets it, so this is undefined and
// callers simply never authenticate.
export function getTelegramWebApp(): TelegramWebApp | undefined {
  return window.Telegram?.WebApp;
}
