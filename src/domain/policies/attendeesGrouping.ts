/**
 * Policy группировки участников (attendees) по статусам PARTSTAT и преобразование email -> person_id.
 *
 * Это чистая функция: все зависимости (генерация person_id) передаются снаружи.
 */

export type AttendeeLike = { email: string; partstat?: string };

export type GroupedAttendeePersonIds = {
  all: string[];
  accepted: string[];
  declined: string[];
  tentative: string[];
  needsAction: string[];
  unknown: string[];
};

export function groupAttendeePersonIds(
  attendees: AttendeeLike[],
  toPersonId: (email: string) => string,
): GroupedAttendeePersonIds {
  const accepted: string[] = [];
  const declined: string[] = [];
  const tentative: string[] = [];
  const needsAction: string[] = [];
  const unknown: string[] = [];
  const allSet = new Set<string>();

  for (const a of attendees ?? []) {
    const email = String(a?.email ?? "").trim();
    if (!email) continue;
    const pid = toPersonId(email);
    allSet.add(pid);

    const ps = String(a?.partstat ?? "")
      .trim()
      .toUpperCase();
    if (ps === "ACCEPTED") accepted.push(pid);
    else if (ps === "DECLINED") declined.push(pid);
    else if (ps === "TENTATIVE") tentative.push(pid);
    else if (ps === "NEEDS-ACTION") needsAction.push(pid);
    else unknown.push(pid);
  }

  const all = Array.from(allSet.values());
  return { all, accepted, declined, tentative, needsAction, unknown };
}

