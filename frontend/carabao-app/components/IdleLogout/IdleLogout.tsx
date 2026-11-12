"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { signOut } from "@/lib/auth-client";
import { idleState, idleTimeoutMs, secondsLeft } from "@/lib/idle";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { fmt } from "@/lib/i18n/format";
import styles from "./IdleLogout.module.css";

// Shared by every tab, so activity in one keeps the others signed in too.
const LAST_ACTIVITY_KEY = "carabao.lastActivity";
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "scroll", "touchstart", "mousemove"] as const;
const CHECK_EVERY_MS = 1_000;
const WRITE_EVERY_MS = 5_000; // throttle storage writes from mousemove/scroll

function readLastActivity(fallback: number): number {
  try {
    const value = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeLastActivity(at: number) {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(at));
  } catch {
    // Storage blocked: this tab still tracks its own activity.
  }
}

/** Signs a signed-in user out after inactivity, with a one-minute warning (E5). */
export default function IdleLogout() {
  const { isAuthenticated } = useAuth();
  const { t } = useLanguage();
  const timeoutMs = idleTimeoutMs();
  const lastActivity = useRef(0);
  const lastWrite = useRef(0);
  const signingOut = useRef(false);
  const [warningSeconds, setWarningSeconds] = useState<number | null>(null);
  // A ref mirror so the activity listener sees the current warning without re-binding.
  const warningRef = useRef<number | null>(null);
  const setWarning = useCallback((value: number | null) => {
    warningRef.current = value;
    setWarningSeconds(value);
  }, []);

  const markActive = useCallback(() => {
    const now = Date.now();
    lastActivity.current = now;
    if (now - lastWrite.current >= WRITE_EVERY_MS) {
      lastWrite.current = now;
      writeLastActivity(now);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const start = Date.now();
    lastActivity.current = Math.max(readLastActivity(start), start - 1);
    lastWrite.current = 0;
    markActive();

    // While the warning is up, only the "Stay signed in" button counts as activity,
    // so a stray mouse movement can't silently cancel it.
    const onActivity = () => {
      if (warningRef.current === null) markActive();
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true });

    const timer = window.setInterval(() => {
      const now = Date.now();
      const last = Math.max(lastActivity.current, readLastActivity(0));
      const state = idleState(now, last, timeoutMs);
      if (state === "expired") {
        if (signingOut.current) return;
        signingOut.current = true;
        void signOut()
          .catch(() => {
            // Session may already be gone; go to sign-in regardless.
          })
          .finally(() => {
            // A full page load, not a client navigation: it drops every bit of
            // in-memory state, including this component's stale "signed in".
            window.location.assign("/auth?reason=idle");
          });
      } else if (state === "warning") {
        setWarning(secondsLeft(now, last, timeoutMs));
      } else {
        setWarning(null);
      }
    }, CHECK_EVERY_MS);

    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity);
      window.clearInterval(timer);
      signingOut.current = false;
    };
  }, [isAuthenticated, markActive, setWarning, timeoutMs]);

  if (!isAuthenticated || warningSeconds === null) return null;

  const stay = () => {
    lastWrite.current = 0;
    markActive();
    setWarning(null);
  };

  return (
    <div className={styles.backdrop}>
      <div className={styles.card} role="alertdialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-body">
        <h2 id="idle-title">{t.idle.title}</h2>
        <p id="idle-body">{fmt(t.idle.body, { seconds: warningSeconds })}</p>
        <button type="button" className={styles.stay} onClick={stay} autoFocus>
          {t.idle.stay}
        </button>
      </div>
    </div>
  );
}
