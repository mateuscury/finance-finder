import { expect, test } from "@playwright/test";

/** The tier's own smoke test: the login page renders and offers no signup (SPEC §9.6). */
test("the login page is email + password with no signup link", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /sign up|signup|register|create account/i })).toHaveCount(0);
});
