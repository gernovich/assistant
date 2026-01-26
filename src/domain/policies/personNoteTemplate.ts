/**
 * Политика: шаблон карточки человека (markdown).
 */
export function renderPersonCardMarkdown(params: {
  id: string;
  displayName: string;
  email?: string;
  keys: {
    assistantType: string;
    personId: string;
    displayName: string;
    firstName: string;
    lastName: string;
    middleName: string;
    nickName: string;
    gender: string;
    photo: string;
    birthday: string;
    voiceprint: string;
    emails: string;
    phones: string;
    companies: string;
    positions: string;
    mailboxes: string;
    messengers: string;
  };
  escape: (s: string) => string;
}): string {
  const dn = String(params.displayName ?? "").trim();
  const title = dn || "Новый человек";

  return [
    "---",
    `${params.keys.assistantType}: person`,
    `${params.keys.personId}: ${params.escape(params.id)}`,
    `${params.keys.displayName}: ${params.escape(dn)}`,
    `${params.keys.firstName}: `,
    `${params.keys.lastName}: `,
    `${params.keys.middleName}: `,
    `${params.keys.nickName}: `,
    `${params.keys.gender}: `,
    `${params.keys.photo}: `,
    `${params.keys.birthday}: `,
    `${params.keys.voiceprint}: `,
    `${params.keys.emails}: ${params.email ? `[${params.escape(params.email)}]` : "[]"}`,
    `${params.keys.phones}: []`,
    `${params.keys.companies}: []`,
    `${params.keys.positions}: []`,
    `${params.keys.mailboxes}: []`,
    `${params.keys.messengers}: []`,
    "---",
    "",
    `## ${title}`,
    "",
    "### Контакты",
    "",
    "- Email: ",
    "- Телефон: ",
    "- Мессенджеры: ",
    "",
    "### Досье",
    "",
    "- (пока пусто)",
    "",
    "### Факты",
    "",
    "- (пока пусто)",
    "",
    "### Связи",
    "",
    "- Проекты: ",
    "- Встречи: ",
    "",
  ].join("\n");
}
