/**
 * Policy: план перебора источников Linux Native записи.
 *
 * Сейчас поведение простое: пробуем все комбинации mic × monitor в порядке как пришли списки.
 */
export type LinuxNativeSourceAttempt = { mic: string; monitor: string | null };

export function buildLinuxNativeSourceAttemptPlan(params: {
  micCandidates: string[];
  monitorCandidates: string[];
}): LinuxNativeSourceAttempt[] {
  const micCandidates = Array.isArray(params.micCandidates) ? params.micCandidates : [];
  const monitorCandidates = Array.isArray(params.monitorCandidates) ? params.monitorCandidates : [];
  const attempts: LinuxNativeSourceAttempt[] = [];
  for (const mic of micCandidates) {
    const m = String(mic ?? "").trim();
    if (!m) continue;
    for (const mon of monitorCandidates) {
      const mm = String(mon ?? "").trim();
      if (!mm) continue;
      attempts.push({ mic: m, monitor: mm });
    }
  }
  return attempts;
}
