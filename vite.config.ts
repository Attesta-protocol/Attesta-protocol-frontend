import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The WASM prover is loaded lazily from src/lib/prover; keep it out of the
// main chunk so the wallet shell stays fast even before proving is needed.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
  },
});
