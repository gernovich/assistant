/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2022: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  rules: {
    // В проекте есть отдельная дисциплина через tsc/strict и точечные тесты; включим позже по мере подчистки.
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": "off",

    // В проекте есть неизбежные стыки (Obsidian/Electron/FFmpeg). Ограничиваем дисциплиной точечно, а не глобальным запретом.
    "@typescript-eslint/no-explicit-any": "off",

    // В Obsidian/Electron среде `require()` используется точечно (с eslint-disable в коде); пока не запрещаем глобально.
    "@typescript-eslint/no-var-requires": "off",

    // В проекте есть валидные regex-паттерны для файловых имён/escape; ужесточим позже.
    "no-useless-escape": "off",
    "no-control-regex": "off",
  },
  ignorePatterns: ["dist/", "coverage/", "node_modules/", "recordings/"],
};

