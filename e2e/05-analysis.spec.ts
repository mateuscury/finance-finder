import { expect, test } from "@playwright/test";
import { createOwner, cspViolations, expectNoHorizontalOverflow, restoreGoldenWithSnapshots, signIn } from "./helpers";

/**
 * The analysis screens over a known ledger (US-009 to US-012, US-015).
 * Absorbs the Phase-5 gap gate (`e2e/gate-gaps.spec.ts`, deleted by this
 * unit): the assertions that were contracts rather than pictures are here,
 * and the screenshots that were review material have served their purpose.
 *
 * The golden portfolio is the fixture because its figures are derived
 * independently (`packs/br/fixtures/derive_expected.py`), so a screen showing
 * something else is the screen's fault, not the kernel's.
 */
test("the analysis screens agree with each other over the golden portfolio", async ({ page }) => {
  test.setTimeout(180_000);
  const owner = await createOwner();
  const violations = cspViolations(page);
  let cleanup = async () => {};
  try {
    await signIn(page, owner);
    cleanup = await restoreGoldenWithSnapshots(owner);

    // US-015 AC-015.2 — the same number computed two ways: the Overview
    // headline runs the kernel over a latest-price read, the Assets foot sums
    // the per-row values of that same valuation. A divergence means a screen
    // is not showing the portfolio it claims to.
    await page.goto("/");
    await expect(page.locator("main .amount").first()).toBeVisible();
    const headline = (await page.locator("main .amount").first().innerText()).trim();
    expect(headline).not.toBe("");

    await page.goto("/assets");
    const total = (await page.locator("tfoot .amount").first().innerText()).trim();
    expect(total, "the Assets foot total is the Overview headline").toBe(headline);

    // US-015 AC-015.3 — the asset's own page lists the open lots.
    const assetHref = await page.locator("tbody tr a[href^='/assets/']").first().getAttribute("href");
    expect(assetHref).toBeTruthy();
    await page.goto(assetHref!);
    await expect(page.locator("#position")).toBeVisible();

    // US-010 — Performance states a return over a period, not an empty state.
    await page.goto("/performance");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/not enough history|histórico insuficiente/i);

    // US-012 — Maturities lists the fixed-income holdings by date.
    await page.goto("/maturities");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("tbody tr").first()).toBeVisible();

    // US-011 — Allocation and Contribution render their figures.
    for (const route of ["/allocation", "/contribution"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page, route);
    }

    expect(violations).toEqual([]);
  } finally {
    await cleanup();
    await owner.remove();
  }
});
