import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src/lib/prover/pkg", "prover/target", "node_modules"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
