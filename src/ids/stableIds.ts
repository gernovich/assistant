export function makeEventKey(calendarId: string, uid: string): string {
  return `${calendarId}:${uid}`;
}

// Deterministic short id to keep filenames stable but still readable.
// FNV-1a 32-bit -> base36 padded.
export function shortStableId(input: string, len = 6): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // unsigned
  const u = h >>> 0;
  const s = u.toString(36);
  return s.padStart(len, "0").slice(0, len);
}

