import { expect, test } from "@playwright/test";
import { createOwner, openMenuIfCollapsed, restoreGoldenWithSnapshots, signIn } from "./helpers";

/**
 * Privacy mode (SPEC §12.3; decision 40): a per-device display preference for
 * showing the app on a shared screen. It masks every `.amount` through CSS
 * and survives a reload, and it is never sent to the server — which is why
 * decision 40 required `09-boundary.spec.ts` alongside it.
 */
test("privacy mode masks every amount and survives a reload", async ({ page }) => {
  test.setTimeout(120_000);
  const owner = await createOwner();
  let cleanup = async () => {};
  try {
    await signIn(page, owner);
    cleanup = await restoreGoldenWithSnapshots(owner);
    await page.goto("/");
    await expect(page.locator(".amount").first()).toBeVisible();

    const masked = async () =>
      page.evaluate(() => {
        const amounts = [...document.querySelectorAll(".amount")];
        if (amounts.length === 0) return { count: 0, unmasked: ["no .amount on the page"] };
        const unmasked = amounts
          .filter((el) => {
            const after = getComputedStyle(el, "::after").content;
            const colour = getComputedStyle(el).color;
            return !after.includes("•••") || !/rgba\(0, 0, 0, 0\)|transparent/.test(colour);
          })
          .slice(0, 5)
          .map((el) => el.textContent ?? "");
        return { count: amounts.length, unmasked };
      });

    // At 400 px the control lives inside the collapsed nav menu.
    await openMenuIfCollapsed(page);
    await page
      .getByRole("button", { name: /hide amounts|ocultar valores|amounts hidden|valores ocultos/i })
      .first()
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-privacy", "on");
    const on = await masked();
    expect(on.count).toBeGreaterThan(0);
    expect(on.unmasked).toEqual([]);

    // Remembered per device: the boot script restores it before first paint.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-privacy", "on");
    expect((await masked()).unmasked).toEqual([]);

    // And off again.
    await openMenuIfCollapsed(page);
    await page
      .getByRole("button", { name: /hide amounts|ocultar valores|amounts hidden|valores ocultos/i })
      .first()
      .click();
    await expect(page.locator("html")).not.toHaveAttribute("data-privacy", /./);
  } finally {
    await cleanup();
    await owner.remove();
  }
});
