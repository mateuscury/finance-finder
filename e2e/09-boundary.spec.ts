import { expect, test } from "@playwright/test";
import { APP_ROUTES, createOwner, enrolTotp, signIn } from "./helpers";

/**
 * The security boundary (MILESTONES.md §4 decision 40; US-014 AC-014.2).
 * Privacy mode was allowed to be client-only ON CONDITION that the real
 * boundaries are exercised by this journey: nothing renders without a
 * verified session, an enrolled owner reaches nothing at AAL1, and every
 * response carries decision 51's headers.
 */
test("signed out, every app route and the export redirect to /login", async ({ page }) => {
  for (const route of [...APP_ROUTES, "/settings/export/json", "/settings/export/csv"]) {
    await page.goto(route);
    await expect(page, `${route} must not render signed out`).toHaveURL(/\/login/);
  }
});

test("with a factor enrolled and only a password, every route redirects to the challenge", async ({ browser }) => {
  const owner = await createOwner();
  const enrolling = await browser.newContext();
  const aal1 = await browser.newContext();
  try {
    const page = await enrolling.newPage();
    await signIn(page, owner);
    await enrolTotp(page);

    // A session that passed the password and stopped there.
    const weak = await aal1.newPage();
    await weak.goto("/login");
    await weak.getByLabel(/e-?mail/i).fill(owner.email);
    await weak.getByLabel(/password|senha/i).fill(owner.password);
    await weak.getByRole("button", { name: /sign in|entrar/i }).click();
    // The challenge is served in place; the address bar may still read "/".
    await expect(weak.locator("input[name=code]")).toBeVisible();

    for (const route of [...APP_ROUTES, "/settings/export/json"]) {
      await weak.goto(route);
      await expect(weak, `${route} must not render at AAL1`).toHaveURL(/\/login\/mfa/);
      // The claim that matters: no figure of the owner's reaches an AAL1
      // session, whatever the URL says (decision 40's condition).
      await expect(weak.locator(".amount"), `${route} leaked an amount at AAL1`).toHaveCount(0);
    }
  } finally {
    await enrolling.close();
    await aal1.close();
    await owner.remove();
  }
});

test("every response carries the decision 51 headers", async ({ request }) => {
  for (const route of ["/login", "/", "/settings"]) {
    const res = await request.get(route);
    const h = res.headers();
    expect(h["content-security-policy"], route).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(h["x-content-type-options"], route).toBe("nosniff");
    expect(h["referrer-policy"], route).toBe("no-referrer");
    expect(h["x-frame-options"], route).toBe("DENY");
    expect(h["x-powered-by"], route).toBeUndefined();
  }
});
