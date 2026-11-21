// Web client side of the code-sending CAPTCHA (lib/captcha.ts). A fresh
// Turnstile token per request: tokens are single use. The widget is invisible
// unless Cloudflare wants the person to click; then it shows in a small dialog.
//
// With no NEXT_PUBLIC_TURNSTILE_SITE_KEY no token is sent (local development);
// the server checks only when TURNSTILE_SECRET_KEY is set.

import { CAPTCHA_FAILED_MESSAGE, CAPTCHA_HEADER } from "@/lib/captcha";

const SITE_KEY = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "").trim();
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TOKEN_TIMEOUT_MS = 120_000;

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string | undefined;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile missing")));
    script.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.appendChild(script);
  }).catch((err) => {
    scriptPromise = null; // try again next time
    throw err;
  });
  return scriptPromise;
}

function overlay(): { root: HTMLDivElement; slot: HTMLDivElement } {
  const root = document.createElement("div");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Security check");
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 0, 0, 0.45)",
    padding: "16px",
  });
  const card = document.createElement("div");
  Object.assign(card.style, {
    background: "#fff",
    color: "#1a1a1a",
    borderRadius: "12px",
    padding: "20px",
    maxWidth: "360px",
    textAlign: "center",
    font: "15px/1.4 system-ui, sans-serif",
  });
  const text = document.createElement("p");
  text.textContent = "Quick security check before we send your code.";
  text.style.margin = "0 0 12px";
  const slot = document.createElement("div");
  card.append(text, slot);
  root.append(card);
  return { root, slot };
}

function getToken(): Promise<string> {
  return loadTurnstile().then(
    (turnstile) =>
      new Promise<string>((resolve, reject) => {
        const { root, slot } = overlay();
        document.body.appendChild(root);
        let widgetId: string | undefined;
        let settled = false;
        const done = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (widgetId) {
            try {
              turnstile.remove(widgetId);
            } catch {
              // already gone
            }
          }
          root.remove();
          fn();
        };
        const fail = () => done(() => reject(new Error(CAPTCHA_FAILED_MESSAGE)));
        // done() runs only from callbacks, after this line.
        const timer = setTimeout(fail, TOKEN_TIMEOUT_MS);
        try {
          widgetId = turnstile.render(slot, {
            sitekey: SITE_KEY,
            appearance: "interaction-only",
            theme: "auto",
            retry: "never",
            callback: (token: string) => done(() => resolve(token)),
            "error-callback": () => {
              fail();
              return true; // handled: don't let Turnstile throw
            },
            "expired-callback": fail,
            "timeout-callback": fail,
            "before-interactive-callback": () => {
              root.style.display = "flex";
            },
            "after-interactive-callback": () => {
              root.style.display = "none";
            },
          });
        } catch {
          widgetId = undefined;
        }
        if (!widgetId) fail();
      }),
  );
}

/** Headers for a request to a CAPTCHA_PATHS endpoint; empty when Turnstile isn't set up. */
export async function captchaHeaders(): Promise<Record<string, string>> {
  if (!SITE_KEY || typeof window === "undefined") return {};
  try {
    return { [CAPTCHA_HEADER]: await getToken() };
  } catch {
    throw new Error(CAPTCHA_FAILED_MESSAGE);
  }
}
