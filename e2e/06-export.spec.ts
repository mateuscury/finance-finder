import { expect, test } from "@playwright/test";
import { createDbTestClient } from "../lib/testing/stack";
import { createOwner, restoreGoldenWithSnapshots, signIn } from "./helpers";

/**
 * "Your data" (SPEC §12.3; US-008): both downloads are real files that parse,
 * and taking one is recorded so the strip can stop nagging. The JSON is the
 * backup restore reads; the CSV is the format this app's own import takes
 * back as a no-op, which `04-import-csv.spec.ts` proves separately.
 */
test("both exports download, parse, and stamp last_export_at", async ({ page }) => {
  test.setTimeout(180_000);
  const owner = await createOwner();
  const admin = createDbTestClient();
  let cleanup = async () => {};
  try {
    await signIn(page, owner);
    cleanup = await restoreGoldenWithSnapshots(owner);
    await page.goto("/settings");

    const jsonDownload = page.waitForEvent("download");
    await page.getByRole("link", { name: /download backup|baixar backup/i }).click();
    const json = await jsonDownload;
    const jsonText = await (await json.createReadStream()).toArray();
    const backup = JSON.parse(Buffer.concat(jsonText).toString("utf8"));
    expect(backup.assets.length, "the backup carries the golden's assets").toBeGreaterThan(0);
    expect(backup.transactions.length).toBeGreaterThan(0);

    const csvDownload = page.waitForEvent("download");
    await page.getByRole("link", { name: /download transactions|baixar transações/i }).click();
    const csv = await csvDownload;
    const csvText = Buffer.concat(await (await csv.createReadStream()).toArray()).toString("utf8");
    const [header, ...lines] = csvText.trim().split("\n");
    expect(header).toContain("identifier");
    expect(lines.length).toBe(backup.transactions.length);

    const { data } = await admin.from("user_settings").select("last_export_at").eq("user_id", owner.userId).single();
    expect(data?.last_export_at, "taking an export is recorded").not.toBeNull();
  } finally {
    await cleanup();
    await owner.remove();
  }
});
