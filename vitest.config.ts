import { defineConfig } from "vitest/config";
import path from "path";

/**
 * The first automated tests this project has ever had.
 *
 * Scope is deliberate: PURE functions only — no database, no Next runtime, no
 * network. Everything that touches sqlite is already covered by the pipeline's
 * verification gates, which re-derive the cleaning rules from scratch against
 * a million real rows and are a far better test than any fixture would be.
 * What had no coverage at all was the small arithmetic and parsing everything
 * else is built on, where a silent sign error or an off-by-one produces a
 * plausible wrong number rather than a crash.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
