import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // PACKS.md §7 rule 1 and §11.7: packs use ctx.http only, add no npm
    // dependencies, and never reach into kernel internals.
    files: ["packs/**/*.ts"],
    ignores: ["packs/**/*.test.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Packs must use ctx.http (rate limit, retries, fixtures). See PACKS.md §7." },
        { name: "XMLHttpRequest", message: "Packs must use ctx.http. See PACKS.md §7." },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "axios", message: "Packs must use ctx.http. See PACKS.md §7." },
            { name: "node-fetch", message: "Packs must use ctx.http. See PACKS.md §7." },
            { name: "undici", message: "Packs must use ctx.http. See PACKS.md §7." },
            { name: "got", message: "Packs must use ctx.http. See PACKS.md §7." },
            { name: "decimal.js", message: "Values cross the pack boundary as strings; the kernel owns decimal math." },
          ],
          patterns: [
            { group: ["**/lib/**", "@/lib/**"], message: "lib/ is kernel-only. Packs supply data, not math (PACKS.md §1)." },
          ],
        },
      ],
    },
  },
  {
    // docs/milestone-2-plan.md "Arithmetic": the kernel is PURE. It may import
    // decimal.js, zod, the kernel-owned pack contracts (@/packs/types, schema,
    // decimal-text) and its own files. Anything that reaches a database, a
    // framework, the runtime or a specific pack is banned here, tests included,
    // so `pnpm test:calc` can never depend on infrastructure.
    files: ["lib/calc/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "next", message: "lib/calc is pure: no framework imports." },
            { name: "react", message: "lib/calc is pure: no framework imports." },
            { name: "react-dom", message: "lib/calc is pure: no framework imports." },
            { name: "@/packs", message: "The kernel knows the pack CONTRACT, never the registry or a specific pack (PACKS.md §1). Take a registry as a parameter." },
            { name: "@/packs/index", message: "The kernel knows the pack CONTRACT, never the registry or a specific pack (PACKS.md §1). Take a registry as a parameter." },
          ],
          patterns: [
            {
              group: ["next/*", "react/*", "react-dom/*", "@supabase/*"],
              message: "lib/calc is pure: no framework or database imports.",
            },
            {
              group: [
                "@/lib/packs", "@/lib/packs/*", "**/lib/packs/**",
                "@/lib/supabase", "@/lib/supabase/*", "**/lib/supabase/**",
                "@/lib/cron", "@/lib/cron/*", "**/lib/cron/**",
                "@/app/*", "**/app/**",
              ],
              message: "lib/calc is pure: it never reaches the pack runtime, the store, the crons or the routes.",
            },
            {
              group: ["@/packs/br", "@/packs/br/*", "**/packs/br/**", "@/packs/global", "@/packs/global/*", "**/packs/global/**", "@/packs/conformance/*", "**/packs/conformance/**"],
              message: "The kernel knows the pack CONTRACT, never a specific pack (PACKS.md §1).",
            },
          ],
        },
      ],
    },
  },
  {
    // Float arithmetic on values is banned in kernel source. Tests are exempt
    // from the SYNTAX bans only (they still cannot import infrastructure).
    // `parseInt` on a regex-validated date component is the one integer
    // parse the kernel legitimately needs and stays allowed.
    files: ["lib/calc/**/*.ts"],
    ignores: ["lib/calc/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: "Values are decimal strings and Decimal, never a float. Use Money.parse / the kernel Decimal.",
        },
        {
          selector: "CallExpression[callee.name='Number']",
          message: "Values are decimal strings and Decimal, never a float. Use Money.parse / the kernel Decimal.",
        },
        {
          selector: "MemberExpression[object.name='Math']",
          message: "Math.* is float arithmetic. Use Decimal methods; for integer min/max write the comparison.",
        },
        {
          selector: "CallExpression[callee.object.name='Decimal'][callee.property.name='set']",
          message: "Never configure the global Decimal (action at a distance). Use the kernel-private clone from lib/calc/decimal.ts.",
        },
      ],
    },
  },
]);

export default eslintConfig;
