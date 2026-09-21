"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";
const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};
const getSnapshot = () => window.matchMedia(QUERY).matches;
const getServerSnapshot = () => true;

/** Charts animate only when the person has not asked otherwise (plan "Accessibility"). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
