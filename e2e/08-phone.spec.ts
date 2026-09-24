import { expect, test } from "@playwright/test";
import {
  APP_ROUTES,
  createOwner,
  expectNoHorizontalOverflow,
  openMenuIfCollapsed,
  restoreGoldenWithSnapshots,
  signIn,
} from "./helpers";

/**
 * US-013 AC-013.4: every screen works at 400 px. Runs in the `phone` project
 * only — the same assertions at 1280 px would prove nothing.
 */
test("every route fits a 400 px screen and the menu opens", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the phone project only");
  test.setTimeout(240_000);
  const owner = await createOwner();
  let cleanup = async () => {};
  try {
    await signIn(page, owner);
    cleanup = await restoreGoldenWithSnapshots(owner);

    // The nav collapses to a menu that can actually be opened.
    await page.goto("/");
    const summary = page.locator("header summary").filter({ hasText: /menu/i }).first();
    await expect(summary, "the nav collapses to a menu at 400 px").toBeVisible();
    await openMenuIfCollapsed(page);
    await expect(page.getByRole("link", { name: /settings|configurações/i }).first()).toBeVisible();

    for (const route of APP_ROUTES) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 }), `${route} has a heading`).toBeVisible();
      await expectNoHorizontalOverflow(page, route);
    }
  } finally {
    await cleanup();
    await owner.remove();
  }
});
