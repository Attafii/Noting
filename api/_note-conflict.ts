/**
 * Optimistic-concurrency version comparison for note saves.
 *
 * The old check compared `String(dbUpdatedAt) !== clientAnchor` — raw string
 * equality. The DB driver can return the same instant in a different shape
 * than what the client echoes back (Date object vs ISO string, microsecond
 * vs millisecond precision), so equality could fail forever and every save
 * 409'd into an unresolvable "changed on another device" loop. Comparing
 * parsed epoch milliseconds with a small tolerance fixes the format skew
 * and also absorbs the autosave double-submit race (two saves <1s apart).
 */

/** Differences at or under this are the same version (autosave races, precision skew). */
export const VERSION_CONFLICT_TOLERANCE_MS = 1000;

export function parseVersionTs(value: unknown): number | null {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

/**
 * True when the server version genuinely moved past the client's anchor.
 * Fail-closed: unparseable input counts as a conflict (never silently clobber).
 */
export function isConflictingVersion(currentUpdatedAt: unknown, baseUpdatedAt: unknown): boolean {
  const current = parseVersionTs(currentUpdatedAt);
  const base = parseVersionTs(baseUpdatedAt);
  if (current === null || base === null) return true;
  return Math.abs(current - base) > VERSION_CONFLICT_TOLERANCE_MS;
}
