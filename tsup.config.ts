import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/key-pool/index.ts",
    "src/retry/index.ts",
    "src/client/index.ts",
    "src/agent-runtime/index.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
});
