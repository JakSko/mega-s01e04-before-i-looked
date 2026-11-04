import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from './read.js';

// Synthetic nights go to a temp dir: runs/ is read-only.
const dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function night(name: string, lines: (object | string)[]): string {
  const body = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n');
  writeFileSync(join(dir, `${name}.jsonl`), body ? `${body}\n` : '');
  return name;
}

const row = (n: string, job: string) => readNight(dir, n)?.rows.find((r) => r.job === job);

describe('readNight on runs/2026-10-28.jsonl', () => {
  const n = readNight('runs', '2026-10-28');

  it('has 5 jobs and 1 bad line', () => {
    expect(n?.rows).toHaveLength(5);
    expect(n?.badLines).toBe(1);
  });

  it('sorts rows by job', () => {
    expect(n?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('folds a job into one row', () => {
    expect(n?.rows.find((r) => r.job === 'lane/sync')).toEqual({
      job: 'lane/sync',
      owner: 'rook',
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'lock held',
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
    expect(n?.rows.find((r) => r.job === 'fixtures/refresh')).toMatchObject({ runs: 4, retries: 3 });
    expect(n?.rows.find((r) => r.job === 'notes/backup')).toMatchObject({
      lastStatus: 'fail',
      lastError: 'quota exceeded',
    });
    expect(n?.rows.find((r) => r.job === 'digest/render')?.owner).toBeNull();
  });
});

describe('readNight', () => {
  it('keeps a row whose owner is null', () => {
    night('2026-01-01', [{ at: '2026-01-01T01:00:00+01:00', job: 'a', status: 'ok', owner: null }]);
    expect(readNight(dir, '2026-01-01')?.rows).toEqual([
      {
        job: 'a',
        owner: null,
        runs: 1,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-01-01T01:00:00+01:00',
        lastAt: '2026-01-01T01:00:00+01:00',
      },
    ]);
  });

  it('keeps the last error after a later ok, and counts runs and retries', () => {
    night('2026-01-02', [
      { at: '2026-01-02T01:00:00+01:00', job: 'a', status: 'retry', owner: 'x', error: 'first' },
      { at: '2026-01-02T01:01:00+01:00', job: 'a', status: 'retry', owner: 'x', error: 'second' },
      { at: '2026-01-02T01:02:00+01:00', job: 'a', status: 'fail', owner: 'x', error: 'third' },
      { at: '2026-01-02T01:03:00+01:00', job: 'a', status: 'ok', owner: 'x' },
    ]);
    expect(row('2026-01-02', 'a')).toMatchObject({ runs: 4, retries: 2, lastStatus: 'ok', lastError: 'third' });
  });

  it('keeps the log offset on first and last time, never UTC', () => {
    night('2026-01-03', [
      { at: '2026-01-03T23:30:00-05:00', job: 'a', status: 'ok', owner: 'x' },
      { at: '2026-01-04T06:15:00+09:00', job: 'a', status: 'ok', owner: 'x' },
    ]);
    expect(row('2026-01-03', 'a')).toMatchObject({
      firstAt: '2026-01-03T23:30:00-05:00',
      lastAt: '2026-01-04T06:15:00+09:00',
    });
  });

  it('counts bad lines without throwing, and ignores blank lines', () => {
    night('2026-01-05', [
      { at: '2026-01-05T01:00:00+01:00', job: 'a', status: 'ok', owner: 'x' },
      '{"at":"2026-01-05T02:00:00+01:00","job":"a"', // cut off
      'not json',
      '',
      '[1,2]',
      { at: '2026-01-05T03:00:00+01:00', job: 'a', status: 'done', owner: 'x' }, // unknown status
      { at: 'later', job: 'a', status: 'ok', owner: 'x' }, // not a time
      { at: '2026-01-05T04:00:00+01:00', status: 'ok', owner: 'x' }, // no job
      { at: '2026-01-05T05:00:00+01:00', job: 'a', status: 'ok', owner: 7 }, // owner not a string
    ]);
    const n = readNight(dir, '2026-01-05');
    expect(n?.badLines).toBe(7);
    expect(n?.rows).toHaveLength(1);
    expect(n?.rows[0]?.runs).toBe(1);
  });

  it('reads CRLF lines', () => {
    writeFileSync(
      join(dir, '2026-01-06.jsonl'),
      '{"at":"2026-01-06T01:00:00+01:00","job":"a","status":"ok","owner":"x"}\r\n',
    );
    expect(readNight(dir, '2026-01-06')).toMatchObject({ badLines: 0, rows: [{ job: 'a', runs: 1 }] });
  });

  it('returns zero rows for an empty file', () => {
    night('2026-01-07', []);
    expect(readNight(dir, '2026-01-07')).toEqual({ night: '2026-01-07', rows: [], badLines: 0 });
  });

  it('returns null for a night with no file, so the page can 404', () => {
    expect(readNight(dir, '1999-12-31')).toBeNull();
    expect(readNight(join(dir, 'nope'), '2026-01-01')).toBeNull();
  });

  it('returns null for a night that is not YYYY-MM-DD', () => {
    expect(readNight(dir, '../2026-01-01')).toBeNull();
    expect(readNight(dir, '2026-01-01.jsonl')).toBeNull();
  });
});
