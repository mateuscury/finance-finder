import { expect, test, type Page } from "@playwright/test";

/** Collects every Content-Security-Policy violation the browser reports (decision 51); assert it is empty. */
export function cspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

/** The tier's own smoke test: the login page renders and offers no signup (SPEC §9.6). */
test("the login page is email + password with no signup link, and violates no CSP", async ({ page }) => {
  const violations = cspViolations(page);
  await page.goto("/login");
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /sign up|signup|register|create account/i })).toHaveCount(0);
  // Next's own scripts ran under the nonce: the page is hydrated, not static HTML.
  await expect.poll(() => page.evaluate(() => document.querySelectorAll("script[nonce]").length)).toBeGreaterThan(0);
  expect(violations).toEqual([]);
});

test("every response carries the security headers", async ({ request }) => {
  const res = await request.get("/login");
  expect(res.headers()["content-security-policy"]).toMatch(
    /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/,
  );
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["referrer-policy"]).toBe("no-referrer");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["x-powered-by"]).toBeUndefined();
});
