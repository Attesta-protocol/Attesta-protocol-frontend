#!/usr/bin/env node
/**
 * Build the WASM prover (prover/ → src/lib/prover/pkg) with wasm-pack.
 *
 * The prover is a first-class build artifact: `npm run build:prover` must run
 * before `npm run dev`/`npm run build` for real proving. If the Rust
 * toolchain or wasm-pack is missing, this script explains how to install
 * them and exits successfully so frontend-only contributors can still work —
 * the proving worker then falls back to a clearly-labelled mock backend
 * (dev builds only; production builds refuse mock proofs).
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const proverDir = join(root, "prover");
const outDir = join(root, "src", "lib", "prover", "pkg");

function has(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore", shell: "/bin/bash" });
    return true;
  } catch {
    return false;
  }
}

if (!existsSync(proverDir)) {
  console.error("prover/ crate not found — are you running from the repo root?");
  process.exit(1);
}

if (!has("cargo")) {
  console.warn(
    "\n[build:prover] Rust toolchain not found — skipping WASM prover build.\n" +
      "The dev server will use the MOCK prover backend (fake, labelled proofs).\n" +
      "To build the real prover:\n" +
      "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh\n" +
      "  cargo install wasm-pack\n" +
      "  npm run build:prover\n",
  );
  process.exit(0);
}

if (!has("wasm-pack")) {
  console.warn(
    "\n[build:prover] wasm-pack not found — skipping WASM prover build.\n" +
      "Install it with `cargo install wasm-pack`, then re-run `npm run build:prover`.\n",
  );
  process.exit(0);
}

console.log("[build:prover] building prover crate with wasm-pack…");
const result = spawnSync(
  "wasm-pack",
  ["build", "--target", "web", "--out-dir", outDir, "--out-name", "attesta_prover"],
  { cwd: proverDir, stdio: "inherit" },
);
process.exit(result.status ?? 1);
