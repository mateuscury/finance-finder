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
]);

export default eslintConfig;
