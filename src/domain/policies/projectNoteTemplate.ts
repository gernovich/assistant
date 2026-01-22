/**
 * Policy: шаблон карточки проекта (markdown).
 */
export function renderProjectCardMarkdown(params: {
  id: string;
  title: string;
  keys: {
    assistantType: string;
    projectId: string;
    owner: string;
    tags: string;
    protocols: string;
  };
  escape: (s: string) => string;
}): string {
  const title = String(params.title ?? "").trim();
  return [
    "---",
    `${params.keys.assistantType}: project`,
    `${params.keys.projectId}: ${params.escape(params.id)}`,
    `title: ${params.escape(title)}`,
    "status: ",
    `${params.keys.owner}:`,
    "  person_id: ",
    "  display_name: ",
    "  email: ",
    `${params.keys.tags}: []`,
    `${params.keys.protocols}: []`,
    "---",
    "",
    `## ${title || "Новый проект"}`,
    "",
    "### Заметки",
    "",
    "- (пока пусто)",
    "",
    "### Обещания",
    "",
    "- (пока пусто)",
    "",
    "### Статусы",
    "",
    "- (пока пусто)",
    "",
    "### Описание",
    "",
    "- (пока пусто)",
    "",
    "### Цели / результаты",
    "",
    "- (пока пусто)",
    "",
    "### Связи",
    "",
    "- Люди: ",
    "- Встречи: ",
    "- Протоколы: ",
    "",
  ].join("\n");
}

