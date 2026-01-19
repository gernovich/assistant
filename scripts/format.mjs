import { spawnSync } from "node:child_process";

/**
 * Форматирование проекта через Prettier.
 *
 * - `npm run format`             → форматирует весь проект (.)
 * - `npm run format -- src`      → форматирует только src
 * - `npm run format -- file.ts`  → форматирует только file.ts
 * - `npm run format:check`       → проверка без записи
 */
function main() {
  const args = process.argv.slice(2);
  const mode = args[0];
  const targets = args.slice(1);

  if (mode !== "--write" && mode !== "--check") {
    console.error("Использование: node scripts/format.mjs --write|--check [файл|директория]");
    process.exit(2);
  }

  const prettierArgs = [mode, ...(targets.length > 0 ? targets : ["."])];

  const r = spawnSync("prettier", prettierArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  process.exit(r.status ?? 1);
}

main();
