import { describe, expect, it } from 'vitest';

import {
  isConflictingVersion,
  parseVersionTs,
  VERSION_CONFLICT_TOLERANCE_MS,
} from './_note-conflict';

describe('parseVersionTs', () => {
  it('parses ISO strings, Dates, and epoch numbers', () => {
    expect(parseVersionTs('2026-09-16T12:00:00.000Z')).toBe(Date.UTC(2026, 8, 16, 12, 0, 0));
    expect(parseVersionTs(new Date('2026-09-16T12:00:00.000Z'))).toBe(
      Date.UTC(2026, 8, 16, 12, 0, 0),
    );
    expect(parseVersionTs(1_787_654_400_000)).toBe(1_787_654_400_000);
  });

  it('returns null for garbage', () => {
    expect(parseVersionTs(undefined)).toBeNull();
    expect(parseVersionTs(null)).toBeNull();
    expect(parseVersionTs('')).toBeNull();
    expect(parseVersionTs('not-a-date')).toBeNull();
    expect(parseVersionTs({})).toBeNull();
    expect(parseVersionTs(Number.NaN)).toBeNull();
  });
});

describe('isConflictingVersion (optimistic-concurrency anchor)', () => {
  it('accepts identical anchors', () => {
    expect(isConflictingVersion('2026-09-16T12:00:00.000Z', '2026-09-16T12:00:00.000Z')).toBe(
      false,
    );
  });

  it('accepts the same instant in different shapes (driver skew)', () => {
    const iso = '2026-09-16T12:00:00.123Z';
    // Date object as some drivers return it.
    expect(isConflictingVersion(new Date(iso), iso)).toBe(false);
    // Microsecond precision as Postgres can emit it.
    expect(isConflictingVersion('2026-09-16T12:00:00.123456Z', iso)).toBe(false);
    // Date#toString shape vs ISO (the old String() comparison always 409'd here).
    expect(isConflictingVersion(new Date(iso).toString(), iso)).toBe(false);
  });

  it('absorbs the autosave double-submit race (sub-second drift)', () => {
    expect(isConflictingVersion('2026-09-16T12:00:00.000Z', '2026-09-16T12:00:00.900Z')).toBe(
      false,
    );
  });

  it('flags genuine moves past the tolerance', () => {
    expect(isConflictingVersion('2026-09-16T12:05:00.000Z', '2026-09-16T12:00:00.000Z')).toBe(true);
    const base = Date.parse('2026-09-16T12:00:00.000Z');
    expect(
      isConflictingVersion(
        new Date(base + VERSION_CONFLICT_TOLERANCE_MS + 1).toISOString(),
        new Date(base).toISOString(),
      ),
    ).toBe(true);
  });

  it('fails closed on unparseable input (never silently clobber)', () => {
    expect(isConflictingVersion('garbage', '2026-09-16T12:00:00.000Z')).toBe(true);
    expect(isConflictingVersion('2026-09-16T12:00:00.000Z', undefined)).toBe(true);
  });
});
