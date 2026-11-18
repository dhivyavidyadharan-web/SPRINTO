import { defineConfig } from "vitest/config";
import path from "path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
  test: { environment: "node", include: ["tests/**/*.test.ts"], env: { MY_EMAIL: "me@example.com", SENDER_NAME: "Test Sender" } },
});
