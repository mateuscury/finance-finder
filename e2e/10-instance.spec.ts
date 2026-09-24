import { expect, test } from "@playwright/test";
import { createDbTestClient } from "../lib/testing/stack";
import { createOwner, restoreGoldenWithSnapshots, signIn } from "./helpers";

/**
 * US-016 "Know my instance is alive" and the two write guards the Phase-5
 * review added (`docs/milestone-4-gaps.md`, decisions 58 and 62).
 *
 * `ingest_cursors` has no user column by design, so the failing-source state
 * is global: this journey writes it through the admin client and puts it back
 * afterwards, the way a failing cron would set and clear it.
 */
test("a failing source is named in the strip and on Settings → Instance", async ({ page }) => {
  test.setTimeout(120_000);
  const owner = await createOwner();
  const admin = createDbTestClient();
  let cleanup = async () => {};
  try {
    await signIn(page, owner);
    cleanup = await restoreGoldenWithSnapshots(owner);

    // AC-016.1 — the instance says so where the owner already is. The failure
    // is injected on a KEYLESS source: a source whose env var is unset reads as
    // *disabled* (which is what this server is, by design — see
    // playwright.config.ts), and that state would mask an injected error.
    await admin
      .from("ingest_cursors")
      .upsert({ source_id: "br.bcb_sgs", last_error: "http_503", last_run_at: new Date().toISOString() });
    await page.goto("/");
    // The strip is the shell's one role=status, labelled "Situação"/"Status".
    await expect(page.getByRole("status", { name: /situação|status/i })).toContainText(/br\.bcb_sgs/);

    // AC-016.2 — and it links to the page that explains it, which states each
    // source's last error, or why it cannot run at all.
    await page.goto("/settings#instance");
    await expect(page.locator("#instance")).toBeVisible();
    await expect(page.locator("#instance")).toContainText(/br\.bcb_sgs/);
    await expect(page.locator("#instance")).toContainText(/http_503/);
    await expect(page.locator("#instance"), "a source with no key says which variable").toContainText(/BRAPI_TOKEN/);
  } finally {
    await admin.from("ingest_cursors").delete().eq("source_id", "br.bcb_sgs");
    await cleanup();
    await owner.remove();
  }
});

test("a pack with held assets cannot be disabled, and an oversell is refused", async ({ page }) => {
  test.setTimeout(120_000);
  const owner = await createOwner();
  let cleanup = async () => {};
  try {
    await signIn(page, owner);
    cleanup = await restoreGoldenWithSnapshots(owner);

    // AC-016.3 — unticking a pack whose assets are still held is refused, and
    // the checkbox is still ticked afterwards: the refusal changed nothing.
    await page.goto("/settings");
    const packBox = page.locator("input[name=packs][value=br]");
    await expect(packBox).toBeChecked();
    await packBox.uncheck();
    await page
      .locator("form")
      .filter({ has: page.locator("input[name=packs]") })
      .getByRole("button")
      .click();
    // Scoped to the page's own message: the shell's status strip sits above
    // main and would otherwise match first.
    await expect(page.locator("main [role=alert], main [role=status]").first()).toContainText(
      /pack with held assets|pacote com ativos/i,
    );
    await expect(page.locator("input[name=packs][value=br]")).toBeChecked();

    // AC-015.6 — a sell larger than the position is refused on the field that
    // is wrong, not with a page-level error.
    await page.goto("/transactions");
    // Same collapsing panel as the asset form: open it before filling it.
    const panel = page.locator("details.panel").first();
    if (!(await panel.evaluate((el: HTMLDetailsElement) => el.open))) await panel.locator("summary").click();
    // EVERY field is scoped to this form. The filter row above it (G-U4) has
    // its own `asset_id` and `type` selects, and an unscoped locator fills
    // those instead — the form then submits its default "buy" and the guard
    // under test is never reached.
    const form = panel.locator("form");
    const assetId = await form.locator("select[name=asset_id] option").nth(1).getAttribute("value");
    expect(assetId).toBeTruthy();
    await form.locator("select[name=asset_id]").selectOption(assetId!);
    await form.locator("select[name=type]").selectOption("sell");
    // `trade_date` is required and has no default: without it the browser
    // blocks submission and nothing reaches the guard under test.
    await form.locator("input[name=trade_date]").fill(new Date().toISOString().slice(0, 10));
    // A sell carries a NEGATIVE quantity (the form says so, and the ledger
    // stores it that way). A positive one is refused by field validation
    // before the position guard is ever consulted.
    await form.locator("input[name=quantity]").fill("-100000");
    await form.locator("input[name=unit_price]").fill("1");
    await form.getByRole("button", { name: /save|add|salvar|adicionar/i }).click();
    await expect(page.locator("main")).toContainText(/larger than the position|maior do que a posição/i);
  } finally {
    await cleanup();
    await owner.remove();
  }
});
