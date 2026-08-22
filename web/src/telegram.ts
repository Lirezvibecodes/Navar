// Bundles Telegram's official SDK (it populates window.Telegram.WebApp on
// import) instead of loading it from telegram.org. That domain is blocked on
// some networks where the Mini App itself still loads fine, and without the
// SDK there is no initData — so authentication would be impossible there.
// The import must be used, not bare: a side-effect-only import of the package
// entry gets tree-shaken out of the bundle, taking the script with it.
import WebApp from "@twa-dev/sdk";

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

export function getTelegramWebApp(): TelegramWebApp | undefined {
  // Outside Telegram the SDK still initialises, but with empty initData, so
  // callers see a WebApp that simply never authenticates.
  return (WebApp as TelegramWebApp | undefined) ?? window.Telegram?.WebApp;
}
