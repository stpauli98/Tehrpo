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
    // Git worktrees žive fizički u repou; ne lintuj njihove kopije (lažne greške iz root lint-a).
    ".claude/**",
  ]),
  // Tehpro project-wide rules
  {
    rules: {
      "no-await-in-loop": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/(?<![a-zA-Z])(sm|md):/]",
          message: "Tehpro je desktop-only. Koristi lg:/xl:/2xl: ili bez breakpoint-a.",
        },
        {
          selector: "TemplateElement[value.raw=/(?<![a-zA-Z])(sm|md):/]",
          message: "Tehpro je desktop-only. Koristi lg:/xl:/2xl: ili bez breakpoint-a.",
        },
      ],
    },
  },
  // scripts/ override — bulk operacije su OK tamo
  {
    files: ["scripts/**/*"],
    rules: {
      "no-await-in-loop": "off",
    },
  },
]);

export default eslintConfig;
