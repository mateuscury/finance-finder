import { expect, test } from "@playwright/test";
import { createOwner, cspViolations, signIn } from "./helpers";

/**
 * Marina signs in (specs/PERSONAS.md scenario 1; US-003). A password alone
 * reaches the ledger while no factor is enrolled; the instance offers no way
 * to create a second account.
 */
test("the owner signs in with a password and lands on the Overview", async ({ page }) => {
  const owner = await createOwner();
  const violations = cspViolations(page);
  try {
    await page.goto("/login");
    await expect(page.getByRole("link", { name: /sign up|cadastr|criar conta/i })).toHaveCount(0);

    await signIn(page, owner);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // A fresh account leads with the first-run card, not an empty dashboard.
    await expect(page.locator("main")).toContainText(/first|primeir/i);
    expect(violations).toEqual([]);
  } finally {
    await owner.remove();
  }
});

test("a wrong password is refused and says nothing about which half was wrong", async ({ page }) => {
  const owner = await createOwner();
  try {
    await page.goto("/login");
    await page.getByLabel(/e-?mail/i).fill(owner.email);
    await page.getByLabel(/password|senha/i).fill("Aa1!definitely-not-the-password");
    await page.getByRole("button", { name: /sign in|entrar/i }).click();
    await expect(page).toHaveURL(/\/login/);
    const message = await page.locator("[role=alert]").innerText();
    // Never "no such user" / "wrong password": the same sentence either way.
    expect(message).not.toMatch(/unknown|not found|no such|não encontrad|inexistente/i);
  } finally {
    await owner.remove();
  }
});
