import { expect, test } from "@playwright/test";
import { createOwner, enrolTotp, passTotpChallenge, signIn } from "./helpers";

/**
 * The second factor, end to end (US-003 AC-003.7; decision 40): enrolling in
 * one session must make EVERY later session prove it. The second context is
 * the point of the journey — an enrolment that only guards the session that
 * created it guards nothing.
 */
test("an enrolled authenticator is demanded from a fresh session", async ({ browser }) => {
  const owner = await createOwner();
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const page = await first.newPage();
    await signIn(page, owner);
    const secret = await enrolTotp(page);

    // A brand-new context: password accepted, then the challenge.
    const fresh = await second.newPage();
    await fresh.goto("/login");
    await fresh.getByLabel(/e-?mail/i).fill(owner.email);
    await fresh.getByLabel(/password|senha/i).fill(owner.password);
    await fresh.getByRole("button", { name: /sign in|entrar/i }).click();
    await passTotpChallenge(fresh, secret);
    await expect(fresh).toHaveURL(/\/$/);
    await expect(fresh.getByRole("heading", { level: 1 })).toBeVisible();
  } finally {
    await first.close();
    await second.close();
    await owner.remove();
  }
});
