import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // CLAUDE.md §1.7: TypeScript strict — no `any`, no `@ts-ignore`, no non-null assertions.
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": true, "ts-nocheck": true, "ts-expect-error": "allow-with-description" },
      ],
    },
  },
  {
    // CLAUDE.md §3: src/lib is pure logic shared by the browser, scripts and tests.
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react/*", "react-dom", "react-dom/*"],
              message: "src/lib must not import React (CLAUDE.md §3).",
            },
            {
              group: ["next", "next/*"],
              message: "src/lib is framework-free; put Next.js code in src/app or src/components.",
            },
            {
              group: ["@/app", "@/app/*", "@/components", "@/components/*"],
              message: "src/lib must not depend on UI code.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Data, not code:
    "data/raw/**",
    "public/data/**",
  ]),
]);

export default eslintConfig;
