import type { Metadata, Viewport } from "next";
import { Instrument_Serif } from "next/font/google";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { LOCALE_COOKIE, parseLocale, parseTheme, THEME_COOKIE } from "@/lib/settings/preferences";

// Display headings and large figures (SPEC §10). Downloaded at build time and
// served from the app's own origin — a page view never touches Google
// (SPEC §12.1). latin-ext carries the Portuguese accents.
const instrumentSerif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin", "latin-ext"],
  variable: "--font-instrument-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Finance Finder",
  description: "Multi-market portfolio tracker",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Privacy mode is per device (SPEC §12.3): the boot script reads it from
 * localStorage before first paint so masked amounts never flash. It is the
 * one inline script in the app and runs under the request's CSP nonce.
 */
const PRIVACY_BOOT = `try{if(localStorage.getItem("ff-privacy")==="on")document.documentElement.setAttribute("data-privacy","on")}catch(e){}`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Theme and language come from the preference cookies the server actions
  // mirror from user_settings (lib/settings/preferences.ts): no flash, no
  // database read, and a signed-out page speaks the instance default.
  const [jar, requestHeaders] = await Promise.all([cookies(), headers()]);
  const locale = parseLocale(jar.get(LOCALE_COOKIE)?.value);
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  return (
    <html lang={locale} data-theme={theme === "system" ? undefined : theme} className={instrumentSerif.variable}>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: PRIVACY_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
