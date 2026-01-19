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
      // P2: считаем покрытие только для модулей, которые уже покрыты тестами сейчас.
      // По мере добавления тестов расширяем include и поднимаем пороги.
      include: ["src/calendar/ics.ts", "src/notifications/**/*.ts"],
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

