import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Single lint policy (errors vs. warnings), enforced identically by every
// package `lint` script, by `pnpm lint` and by CI:
//   1. lint errors always fail the gate and are never baselined;
//   2. lint warnings are allowed only up to the frozen per-package baseline
//      declared in that package's `lint` script (`--max-warnings <baseline>`);
//   3. baselines may only ratchet down — raising one requires lead approval.
// Pre-existing lint/type debt exposed by these real gates is owned by AAA-16.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/playwright-traces/**",
      "**/*.d.ts",
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
      "**/*.map",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["apps/desk-web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
  }
);
