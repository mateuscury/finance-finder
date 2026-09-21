import { expect, test } from "@playwright/test";
import {
  cspViolations,
  createOwner,
  expectNoHorizontalOverflow,
  restoreGoldenWithSnapshots,
  setTheme,
  signIn,
} from "./helpers";

/**
 * The Phase 2 review gate (MILESTONES.md §4 decision 39): /login and / in
 * both themes at both widths, written to docs/review/phase-2/ (gitignored)
 * for the maintainer. Kept as a journey so the shots can be regenerated.
 */
test("review gate: screenshots of /login and / in both themes and widths", async ({ page }) => {
  test.setTimeout(180_000);
  const owner = await createOwner();
  const violations = cspViolations(page);
  let cleanup = async () => {};
  try {
    for (const [name, width] of [
      ["desktop", 1280],
      ["phone", 400],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/login");
      await page.screenshot({ path: `docs/review/phase-2/login-light-${name}.png`, fullPage: true });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.reload();
      await page.screenshot({ path: `docs/review/phase-2/login-dark-${name}.png`, fullPage: true });
      await page.emulateMedia({ colorScheme: "light" });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, owner);
    await page.screenshot({ path: "docs/review/phase-2/overview-fresh-light-desktop.png", fullPage: true });
    cleanup = await restoreGoldenWithSnapshots(owner);
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: 1280, height: 900 }); // the theme control lives in the wide nav
      await page.goto("/");
      await setTheme(page, theme);
      for (const [name, width] of [
        ["desktop", 1280],
        ["phone", 400],
      ] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        await expect(page.locator(".recharts-surface")).toHaveCount(2);
        await page.waitForTimeout(1800); // let the chart animation finish
        await expectNoHorizontalOverflow(page, `/ ${theme} ${name}`);
        await page.screenshot({ path: `docs/review/phase-2/overview-${theme}-${name}.png`, fullPage: true });
      }
    }
    expect(violations).toEqual([]);
  } finally {
    await cleanup();
    await owner.remove();
  }
});
