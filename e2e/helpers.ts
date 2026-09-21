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

export async function signIn(page: Page, owner: Owner): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(owner.email);
  await page.getByLabel(/password/i).fill(owner.password);
  await page.getByRole("button", { name: /sign in/i }).click();
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
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const ok = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(ok, `${label} overflows horizontally`).toBe(true);
}
