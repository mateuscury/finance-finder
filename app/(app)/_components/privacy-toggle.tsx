"use client";

import { useSyncExternalStore } from "react";

const KEY = "ff-privacy";
const ATTR = "data-privacy";

/** The <html> attribute IS the store: the boot script sets it before paint, this component and CSS read it. */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [ATTR] });
  return () => observer.disconnect();
}
const getSnapshot = () => document.documentElement.getAttribute(ATTR) === "on";
const getServerSnapshot = () => false;

/**
 * Privacy mode (SPEC §12.3; decision 40): a per-device display preference
 * for screen-sharing, not a security boundary. Flips `data-privacy` on
 * <html> — the mask is CSS on `.amount` — and remembers it in localStorage;
 * the root layout's boot script restores it before first paint. Nothing is
 * ever sent to the server.
 */
export function PrivacyToggle({ label, onLabel, offLabel }: { label: string; onLabel: string; offLabel: string }) {
  const on = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggle = () => {
    const next = !on;
    if (next) document.documentElement.setAttribute(ATTR, "on");
    else document.documentElement.removeAttribute(ATTR);
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      // Storage may be unavailable (private mode); the toggle still works for this page.
    }
  };
  return (
    <button type="button" className="quiet" aria-pressed={on} onClick={toggle} title={on ? onLabel : offLabel}>
      <span aria-hidden="true">{on ? "◐" : "○"}</span> {label}
    </button>
  );
}
