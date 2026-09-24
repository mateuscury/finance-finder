/**
 * Shared steps for the journeys (specs/PERSONAS.md — Marina's scenarios in
 * order). Every journey creates its own throwaway owner through the admin
 * API and deletes it afterwards; nothing here touches a real account.
 */
import { expect, type Page } from "@playwright/test";
import { PACKS } from "../packs";
import { runSnapshots } from "../lib/jobs/snapshots";
import { createSnapshotStore } from "../lib/jobs/snapshots-store";
import { createDbTestClient } from "../lib/testing/stack";
import { loadGoldenFixture, removeGoldenSeries, seedGoldenPortfolio } from "../lib/testing/golden";
import { nextTotp, totp } from "../lib/testing/totp";
import { writeCsv } from "../lib/csv/write";
import { CANONICAL_COLUMNS } from "../lib/import/mapping";

export interface Owner {
  userId: string;
  email: string;
  password: string;
  remove(): Promise<void>;
}

/** A throwaway owner with a known password (the harness's own has none we can type). */
export async function createOwner(): Promise<Owner> {
  const admin = createDbTestClient();
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `Aa1!e2e-${Math.random().toString(36).slice(2, 14)}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user)
    throw new Error(`e2e: could not create the owner (${created.error?.message})`);
  const userId = created.data.user.id;
  return {
    userId,
    email,
    password,
    async remove() {
      await admin.auth.admin.deleteUser(userId);
    },
  };
}

/** Signs in through the form in whichever language the instance speaks (decision 34). */
export async function signIn(page: Page, owner: Owner): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(owner.email);
  await page.getByLabel(/password|senha/i).fill(owner.password);
  await page.getByRole("button", { name: /sign in|entrar/i }).click();
  await page.waitForURL("**/");
}

/** The golden ledger for the owner, with its series, and snapshots built through today. */
export async function restoreGoldenWithSnapshots(owner: Owner): Promise<() => Promise<void>> {
  const admin = createDbTestClient();
  const { fixture } = loadGoldenFixture();
  await seedGoldenPortfolio(admin, owner.userId, fixture, { series: true });
  const summary = await runSnapshots({
    scope: { kind: "users", userIds: [owner.userId] },
    budgetMs: 120_000,
    reserveMs: 1_000,
    now: () => new Date(),
    store: createSnapshotStore(admin, PACKS),
  });
  expect(summary.ok).toBe(true);
  return () => removeGoldenSeries(admin, fixture);
}

/** Collects every Content-Security-Policy violation the browser reports (decision 51); assert it is empty. */
export function cspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

/** Sets the theme through the nav control and waits for <html> to carry it. */
export async function setTheme(page: Page, theme: "system" | "light" | "dark"): Promise<void> {
  await page.locator("header select[name=theme]:visible").selectOption(theme);
  await page
    .locator("header form:visible")
    .filter({ has: page.locator("select[name=theme]") })
    .getByRole("button")
    .click();
  if (theme === "system") await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
  else await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/** The document never scrolls horizontally (US-013 AC-013.4). */
/**
 * `html, body { overflow-x: hidden }` clips a too-wide element instead of
 * scrolling, so scrollWidth cannot see it: measure the boxes themselves.
 * Content inside a `.table-scroll` may legitimately be wider.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const offenders = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth + 1;
    const found: string[] = [];
    const hidden = (el: Element): boolean => {
      for (let a: Element | null = el; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.clip !== "auto" || (s.overflow === "hidden" && a.clientWidth <= 1)) return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest(".table-scroll") || hidden(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= limit) continue;
      const cls = typeof el.className === "string" && el.className ? `.${el.className.split(" ")[0]}` : "";
      found.push(`${el.tagName.toLowerCase()}${cls}@${Math.round(r.right)}`);
      if (found.length >= 5) break;
    }
    return found;
  });
  expect(offenders, `${label} overflows horizontally`).toEqual([]);
}

/**
 * Enrols an authenticator through Settings and returns its secret, so a later
 * context can pass the challenge (US-003 AC-003.7). The secret is read off the
 * page — it is shown beside the QR precisely so it can be typed by hand — and
 * the code is generated by the same RFC 6238 arithmetic `lib/auth/
 * auth.dbtest.ts` verifies with.
 */
export async function enrolTotp(page: Page): Promise<string> {
  await page.goto("/settings");
  await page.getByRole("button", { name: /enrol an authenticator|cadastrar um aplicativo/i }).click();
  // Scoped to the enrolment form: Settings has another <code> (the phrase the
  // delete-everything box asks you to type).
  const enrolForm = page.locator("form").filter({ has: page.locator("input[name=code]") });
  const secret = (await enrolForm.locator("code").first().innerText()).trim();
  expect(secret, "the enrolment page shows the secret to type by hand").toMatch(/^[A-Z2-7]+$/);
  await page.getByLabel(/code from your authenticator|código do seu autenticador/i).fill(totp(secret));
  await page.getByRole("button", { name: /confirm enrolment|confirmar cadastro/i }).click();
  await expect(
    page.getByText(/an authenticator app is enrolled|um aplicativo autenticador está cadastrado/i),
  ).toBeVisible();
  return secret;
}

/**
 * Answers the AAL2 challenge with a fresh code.
 *
 * Asserts what RENDERS, not where the address bar points: after the sign-in
 * action redirects to "/", Next serves the challenge in place and leaves the
 * URL at "/" (verified in P7-U1 — the response carries no portfolio markup).
 * The security property is that the data is not there, which is what
 * `09-boundary.spec.ts` asserts.
 */
export async function passTotpChallenge(page: Page, secret: string): Promise<void> {
  await expect(page.locator("input[name=code]")).toBeVisible();
  // A code already spent in this 30 s step is refused, so take the next one.
  await page.locator("input[name=code]").fill(nextTotp(secret));
  await page.getByRole("button", { name: /verify|verificar/i }).click();
}

/** Every route an owner can reach, for the sweeps that visit all of them. */
export const APP_ROUTES = [
  "/",
  "/performance",
  "/allocation",
  "/contribution",
  "/maturities",
  "/assets",
  "/transactions",
  "/transactions/import",
  "/cash-flows",
  "/settings",
] as const;

/**
 * The golden ledger as the app's own export writes it (SPEC §9.1 canonical
 * columns, identifier-keyed) — the file `04-import-csv.spec.ts` uploads.
 * Built at test time from the fixture, never checked in, so it cannot drift
 * from the golden it claims to be.
 */
export function goldenCsvText(): { csv: string; rows: number; dividends: number } {
  const { fixture } = loadGoldenFixture();
  const kindOf = new Map(fixture.assets.map((a) => [a.id, { identifier: a.identifier, kind: a.instrumentKind }]));
  const rows = fixture.transactions.map((t) => {
    const a = kindOf.get(t.assetId)!;
    return [
      t.tradeDate,
      t.type,
      a.kind.slice(0, a.kind.indexOf(".")),
      a.kind,
      a.identifier,
      t.quantity,
      t.unitPrice,
      t.currency,
      t.fees,
      "",
    ];
  });
  return {
    csv: writeCsv([...CANONICAL_COLUMNS], rows),
    rows: rows.length,
    dividends: fixture.transactions.filter((t) => t.type === "dividend").length,
  };
}

/**
 * The metadata each BR kind's zod schema requires, by field name (the form
 * renders them as `meta_<name>`). Shared by the journey that adds every kind
 * by hand and the one that creates assets from an import preview — both fill
 * the same generated fields, and a kind whose schema gains a required field
 * fails both until this map says so.
 */
export const REQUIRED_METADATA: Record<string, Record<string, string>> = {
  "br.stock": { name: "Petrobras PN" },
  "br.fii": { fundName: "CSHG Logística" },
  "br.tesouro_direto": { titulo: "Tesouro Selic 2029", maturity: "2029-03-01" },
  "br.cdb": { issuer: "Banco X", rate: "1.10", maturity: "2028-02-02" },
  "br.lci_lca": { issuer: "Banco Y", rate: "0.95", maturity: "2027-01-15" },
  "br.cdb_prefixado": { issuer: "Banco Z", rate: "0.12", maturity: "2028-02-02" },
  "br.cdb_ipca": { issuer: "Banco W", rate: "0.06", maturity: "2029-02-02" },
};

/**
 * Opens the narrow-viewport nav menu when it is collapsed.
 *
 * The menu is a `<details>` so it works without JavaScript (see
 * `_components/nav.tsx`), which means `getByRole("button")` does not find its
 * `<summary>`. At desktop width there is no menu and this does nothing.
 */
export async function openMenuIfCollapsed(page: Page): Promise<void> {
  const summary = page.locator("header summary").filter({ hasText: /menu/i }).first();
  if ((await summary.count()) === 0) return;
  if (!(await summary.isVisible())) return;
  const open = await summary.evaluate((el) => (el.parentElement as HTMLDetailsElement | null)?.open ?? false);
  if (!open) await summary.click();
}
