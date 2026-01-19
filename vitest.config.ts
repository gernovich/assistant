import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, "tests/stubs/obsidian.ts"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Считаем покрытие для “чистых” модулей, которые реально можно покрывать unit-тестами без Obsidian UI.
      // UI (settings/views) и main.ts сюда не включаем, чтобы не делать хрупкие DOM/Obsidian-интеграционные тесты.
      include: [
        "src/calendar/ics.ts",
        "src/notifications/**/*.ts",
        "src/log/**/*.ts",
        "src/ids/**/*.ts",
        "src/vault/**/*.ts",
        "src/caldav/caldavReadiness.ts",
        "src/caldav/requestUrlFetch.ts",
        "src/calendar/store/**/*.ts",
        "src/calendar/constants.ts",
      ],
      exclude: ["tests/**", "src/**/__mocks__/**"],
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 50,
        branches: 25,
      },
    },
  },
});
