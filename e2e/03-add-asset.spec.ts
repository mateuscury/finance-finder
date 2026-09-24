import { expect, test } from "@playwright/test";
import { PACKS } from "../packs";
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

    // SPEC §9.4: a market-priced holding with no source key says WHY it has no
    // price. The reason is written by an ingest attempt, so press Refresh: the
    // server under test has no BRAPI_TOKEN, so ingestion preflights, records
    // `missing_env:BRAPI_TOKEN` on the source, and never calls upstream.
    await page.goto("/assets");
    await page.getByRole("button", { name: /refresh|atualizar/i }).click();
    await expect(async () => {
      await page.goto("/assets");
      await expect(page.locator("main")).toContainText(/BRAPI_TOKEN/);
    }).toPass({ timeout: 60_000 });
  } finally {
    await owner.remove();
  }
});
