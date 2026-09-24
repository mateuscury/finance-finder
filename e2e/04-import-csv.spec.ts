import { expect, test } from "@playwright/test";
import { createDbTestClient } from "../lib/testing/stack";
import { createOwner, goldenCsvText, REQUIRED_METADATA, signIn } from "./helpers";

/**
 * Marina brings her history in (specs/PERSONAS.md; US-007): a CSV in the
 * canonical format, assets created from the file's own identifiers, one
 * all-or-nothing commit, and a second import of the same file that writes
 * nothing. The file is the golden ledger, generated at test time.
 */
test("a CSV imports once, creates its assets, and a second import writes nothing", async ({ page }) => {
  test.setTimeout(240_000);
  const owner = await createOwner();
  const admin = createDbTestClient();
  const { csv, rows, dividends } = goldenCsvText();
  try {
    await signIn(page, owner);
    await page.goto("/transactions/import");

    const upload = async () => {
      await page.setInputFiles("input[type=file]", {
        name: "transactions.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv, "utf8"),
      });
      await page.getByRole("button", { name: /upload and preview|enviar e visualizar/i }).click();
    };

    await upload();
    await expect(page.locator("main")).toContainText(new RegExp(`${rows} (rows|linhas)`));

    // Every identifier is unresolved on a fresh account: the preview offers to
    // create each asset inline, and refuses to commit until none is left. The
    // inline form is the same generated one the Assets screen uses, so each
    // kind's required metadata has to be filled before it will submit.
    for (let guard = 0; guard < 20; guard++) {
      const block = page
        .locator("details.panel")
        .filter({ has: page.getByRole("button", { name: /create this asset|criar este ativo/i }) })
        .first();
      if ((await block.count()) === 0) break;
      const kind = await block.locator("[name=instrument_kind]").first().inputValue();
      for (const [field, value] of Object.entries(REQUIRED_METADATA[kind] ?? {})) {
        const input = block.locator(`[name=meta_${field}]`);
        if ((await input.count()) > 0) await input.fill(value);
      }
      await block.getByRole("button", { name: /create this asset|criar este ativo/i }).click();
      await page.waitForLoadState("networkidle");
    }
    await expect(page.getByRole("button", { name: /create this asset|criar este ativo/i })).toHaveCount(0);

    await page.getByRole("button", { name: /commit \d+ rows?|confirmar \d+ linhas?/i }).click();
    // The authoritative check is the ledger itself, not a rendered row — and
    // waiting on it is also what keeps the next navigation from aborting the
    // commit still in flight. `waitForLoadState` cannot do this job: on a page
    // that is already idle it resolves before the action's request even
    // starts, which is what made this journey flake.
    const written = async () =>
      (await admin.from("transactions").select("*", { count: "exact", head: true }).eq("user_id", owner.userId))
        .count ?? 0;
    await expect.poll(written, { message: "every row of the file was written, once", timeout: 30_000 }).toBe(rows);

    await page.goto("/transactions");
    await expect(page.locator("tbody tr").first()).toBeVisible();

    // The same file again: every row is a duplicate, so there is nothing to commit.
    await page.goto("/transactions/import");
    await upload();
    await expect(page.locator("main")).toContainText(new RegExp(`${rows} (duplicates|duplicadas)`));
    expect(await written(), "a second import of the same file writes nothing").toBe(rows);

    // US-015 AC-015.5 — the list filters by type, and the count is the
    // fixture's own, not a page of rows that happen to be visible.
    await page.goto("/transactions?type=dividend");
    await expect(page.locator("tbody tr")).toHaveCount(dividends);
  } finally {
    await owner.remove();
  }
});
