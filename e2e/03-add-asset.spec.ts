import { expect, test } from "@playwright/test";
import { PACKS } from "../packs";
import { createDbTestClient } from "../lib/testing/stack";
import { createOwner, REQUIRED_METADATA, signIn } from "./helpers";

/**
 * Marina registers what she holds (US-004): the form is generated from the
 * pack's own zod schemas (decision 55), so every kind the registry declares
 * must be addable without a line of screen code per kind. That is the claim
 * this journey tests — all seven BR kinds through one form.
 *
 * The server under test runs without `BRAPI_TOKEN` (playwright.config.ts), so
 * a market-priced holding lands unpriced with the reason naming the variable,
 * deterministically and with no upstream call.
 */
const brKinds = PACKS.find((p) => p.id === "br")!.instruments;

test("every registered instrument kind can be added through the generated form", async ({ page }) => {
  test.setTimeout(240_000);
  const owner = await createOwner();
  const admin = createDbTestClient();
  try {
    await signIn(page, owner);

    for (const [i, kind] of brKinds.entries()) {
      await page.goto("/assets");
      // The create panel is open only while the list is empty, so it must be
      // opened again for every asset after the first.
      const panel = page.locator("details.panel").first();
      if (!(await panel.evaluate((el: HTMLDetailsElement) => el.open))) await panel.locator("summary").click();
      await page.selectOption("select[name=instrument_kind]", kind.id);
      const identifier = kind.identifier === "ticker" ? `TEST${i}1` : `test-${kind.id.replace(".", "-")}-${i}`;
      await page.fill("input[name=identifier]", identifier);
      await page.fill("input[name=name]", `${kind.label} ${i}`);
      for (const [field, value] of Object.entries(REQUIRED_METADATA[kind.id] ?? {})) {
        await page.fill(`[name=meta_${field}]`, value);
      }
      await page
        .locator("form")
        .filter({ has: page.locator("select[name=instrument_kind]") })
        .getByRole("button", { name: /add|save|adicionar|salvar/i })
        .click();
      await expect(page.locator("tbody"), `${kind.id} was added`).toContainText(identifier);
    }

    // SPEC §9.4: a market-priced holding with no price says WHY, and the
    // reason "comes from `ingest_cursors.last_error`". The cursor is written
    // here rather than by pressing Refresh: Refresh schedules the ingest job
    // AFTER the response, and that job talks to every source this asset's
    // kinds need. A journey that waits on it is waiting on the network, which
    // is how this assertion passed locally (on a cursor an earlier run had
    // left behind) and failed in CI on a clean database. What the journey
    // owns is the SCREEN: given that state, the row names the variable.
    await admin
      .from("ingest_cursors")
      .upsert({ source_id: "br.brapi", last_error: "missing_env:BRAPI_TOKEN", last_run_at: new Date().toISOString() });
    await page.goto("/assets");
    await expect(page.locator("main")).toContainText(/BRAPI_TOKEN/);

    // And §9.4's two actions are both offered beside it.
    const row = page.locator("tbody tr").filter({ hasText: "TEST51" });
    await expect(row.getByRole("button", { name: /retry|tentar de novo/i })).toBeVisible();
    await expect(row.getByRole("link", { name: /enter a price|informar um preço/i })).toBeVisible();
  } finally {
    await admin.from("ingest_cursors").delete().eq("source_id", "br.brapi");
    await owner.remove();
  }
});
