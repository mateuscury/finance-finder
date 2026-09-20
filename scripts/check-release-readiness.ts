/**
 * A deliberately strict production-data gate.
 *
 * Normal CI proves that the scaffold is internally consistent. This command
 * answers the different question: "is it safe to deploy and enter real
 * portfolio data?" It must remain red while draft packs, skipped financial
 * evidence, missing recovery, or placeholder UX remain.
 */
import fs from "node:fs";
import path from "node:path";
import { PACKS } from "../packs";

const root = path.resolve(__dirname, "..");
const blockers: string[] = [];

const requiredKernelFiles = [
  "lib/packs/http.ts",
  "lib/packs/activate.ts",
  "lib/packs/ingest.ts",
  "lib/calc/money.ts",
  "lib/calc/positions.ts",
  "lib/calc/fx.ts",
  "lib/calc/twr.ts",
  "lib/calc/mwr.ts",
  "lib/backup/schema.ts",
  "lib/backup/restore.ts",
  "lib/backup/roundtrip.dbtest.ts",
  "app/login/page.tsx",
];
for (const file of requiredKernelFiles) {
  if (!fs.existsSync(path.join(root, file))) blockers.push(`missing required implementation: ${file}`);
}

for (const pack of PACKS) {
  if (pack.status !== "supported") blockers.push(`pack '${pack.id}' is ${pack.status}, not supported`);

  for (const source of pack.sources) {
    if (source.fetch.toString().includes("not implemented")) {
      blockers.push(`source '${source.id}' is still a stub`);
    }
    for (const fixture of ["success", "empty", "upstream_5xx", "rate_limited_429"]) {
      const file = path.join(root, "packs", pack.id, "fixtures", "http", source.id, `${fixture}.json`);
      if (!fs.existsSync(file)) blockers.push(`source '${source.id}' lacks ${fixture}.json`);
    }
  }

  if (pack.instruments.length > 0) {
    const portfolioFile = path.join(root, "packs", pack.id, "fixtures", "portfolio.json");
    const expectedFile = path.join(root, "packs", pack.id, "fixtures", "expected.json");
    const portfolio = fs.existsSync(portfolioFile) ? JSON.parse(fs.readFileSync(portfolioFile, "utf8")) : null;
    const expected = fs.existsSync(expectedFile) ? JSON.parse(fs.readFileSync(expectedFile, "utf8")) : null;
    if (!portfolio || !Array.isArray(portfolio.transactions) || portfolio.transactions.length === 0) {
      blockers.push(`pack '${pack.id}' has no golden portfolio transactions`);
    }
    for (const key of ["valuation", "twr", "mwr"]) {
      if (!expected || expected[key] === null || expected[key] === undefined) {
        blockers.push(`pack '${pack.id}' has no golden ${key} result`);
      }
    }
  }
}

for (const file of ["specs/SPEC.md", "specs/PERSONAS.md"]) {
  const content = fs.readFileSync(path.join(root, file), "utf8");
  if (/\[(Persona Name|Short Title|Constraint 1|Metric 1)/.test(content)) {
    blockers.push(`${file} still contains UX/acceptance-criteria placeholders`);
  }
}

if (blockers.length > 0) {
  console.error("NOT READY FOR REAL PORTFOLIO DATA\n");
  for (const blocker of [...new Set(blockers)]) console.error(`- ${blocker}`);
  process.exit(1);
}

console.log("Release readiness checks passed.");
