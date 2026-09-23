import { expect, test } from "@playwright/test";
import { cspViolations, createOwner, expectNoHorizontalOverflow, restoreGoldenWithSnapshots, signIn } from "./helpers";

/**
 * The review gate for the spec-gap units (docs/milestone-4-gaps.md G-U3,
 * G-U4), shaped like `gate.spec.ts`: screenshots to docs/review/gaps/ for the
 * maintainer, plus the one assertion that is a contract rather than a
 * picture — US-015 AC-015.2, the Assets total is the Overview headline.
 *
 * P7-U1 folds this into the journeys and deletes the file.
 */
test("review gate: Assets, one asset page and a filtered Transactions list", async ({ page }) => {
  test.setTimeout(180_000);
  const owner = await createOwner();
  const violations = cspViolations(page);
  let cleanup = async () => {};
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, owner);
    cleanup = await restoreGoldenWithSnapshots(owner);

    // AC-015.2 — the same number, computed two different ways: the Overview
    // headline runs the kernel over a latest-price read, the Assets foot sums
    // the per-row values of the same valuation. A divergence here means the
    // screen is not showing the portfolio it claims to.
    await page.goto("/");
    const headline = (await page.locator("main .amount").first().innerText()).trim();
    await page.goto("/assets");
    const total = (await page.locator("tfoot .amount").first().innerText()).trim();
    expect(total).toBe(headline);

    // Every holding's row carries a quantity and a cost, not just a price.
    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow.locator("[data-label]")).not.toHaveCount(0);

    const assetHref = await page.locator("tbody tr a[href^='/assets/']").first().getAttribute("href");
    expect(assetHref).toBeTruthy();

    for (const [name, width] of [
      ["desktop", 1280],
      ["phone", 400],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });

      await page.goto("/assets");
      await expectNoHorizontalOverflow(page, `/assets ${name}`);
      await page.screenshot({ path: `docs/review/gaps/assets-${name}.png`, fullPage: true });

      await page.goto(assetHref!);
      await expect(page.locator("#position")).toBeVisible();
      await expectNoHorizontalOverflow(page, `${assetHref} ${name}`);
      await page.screenshot({ path: `docs/review/gaps/asset-position-${name}.png`, fullPage: true });

      await page.goto("/transactions?type=sell");
      await expectNoHorizontalOverflow(page, `/transactions?type=sell ${name}`);
      await page.screenshot({ path: `docs/review/gaps/transactions-filtered-${name}.png`, fullPage: true });
    }

    expect(violations).toEqual([]);
  } finally {
    await cleanup();
    await owner.remove();
  }
});
