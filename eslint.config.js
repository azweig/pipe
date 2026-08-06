// Flat config (ESLint 9). PRAGMATIC ruleset for a large, existing vanilla-ESM codebase:
// catch real bugs, keep style rules to a warn, and disable the recommended rules that would
// drown a working tree in noise. This is a first pass — `npm run lint` is allowed to fail in CI.
import js from "@eslint/js"
import globals from "globals"

export default [
  {
    ignores: [
      "node_modules/**",
      "data/**",
      "auth/**",
      "vault/**",
      "media/**",
      "public/vendor/**",
      "public/**/*.min.js",
      "wa-go/**",
      "**/*.min.js",
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // Style-ish → warn, not error. `_`-prefixed and unused function args are fine.
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      // 240+ intentional empty catches in this tree → warn, and allow empty catch blocks.
      "no-empty": ["warn", { allowEmptyCatch: true }],

      // Real-bug rules — keep as errors.
      "no-undef": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-func-assign": "error",
      "no-unsafe-negation": "error",
      "valid-typeof": "error",
      "use-isnan": "error",
      "no-cond-assign": ["error", "except-parens"],
      "no-unreachable": "warn",

      // Too noisy for this codebase (regex-heavy parsers, dynamic checks) → off.
      "no-control-regex": "off",
      "no-useless-escape": "off",
      "no-prototype-builtins": "off",
      "no-constant-condition": ["warn", { checkLoops: false }],
      "no-empty-pattern": "warn",
    },
  },
]
