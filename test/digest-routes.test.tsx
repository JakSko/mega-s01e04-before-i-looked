import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';

// Synthetic nights in a temp dir: runs/ is read-only, and these tests must never write there.
const NORMAL = '2026-10-28'; // three jobs, written out of order, one null owner, one fail
const EMPTY = '2026-10-29'; // an empty file: a night that ran nothing
const BAD = '2026-10-30'; // one good line for each of two jobs, plus one line that does not parse
const MISSING = '2026-11-01'; // no file at all

let runsDir = '';
let config: RigConfig;

const line = (o: object) => JSON.stringify(o);

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  writeFileSync(
    join(runsDir, `${NORMAL}.jsonl`),
    [
      line({ at: '2026-10-28T22:00:00+01:00', job: 'zeta/sync', status: 'ok', owner: 'rook' }),
      line({ at: '2026-10-28T23:00:00+01:00', job: 'alpha/build', status: 'retry', owner: null, error: 'timeout' }),
      line({ at: '2026-10-28T23:05:00+01:00', job: 'alpha/build', status: 'ok', owner: null }),
      line({ at: '2026-10-28T23:30:00+01:00', job: 'mid/render', status: 'fail', owner: 'ada', error: 'boom' }),
      '',
    ].join('\n'),
  );
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  writeFileSync(
    join(runsDir, `${BAD}.jsonl`),
    [
      line({ at: '2026-10-30T23:00:00+01:00', job: 'zeta/sync', status: 'ok', owner: 'rook' }),
      'this line is not json',
      line({ at: '2026-10-30T23:10:00+01:00', job: 'alpha/build', status: 'ok', owner: 'rook' }),
      '',
    ].join('\n'),
  );
  config = {
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  };
});

afterAll(() => rmSync(runsDir, { recursive: true, force: true }));

const get = (path: string) => createApp(config).request(path);

describe('GET /digest/:night', () => {
  it('answers 200 HTML for a night with a file, with each job in the table', async () => {
    const res = await get(`/digest/${NORMAL}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(html).toContain('alpha/build');
    expect(html).toContain('mid/render');
    expect(html).toContain('zeta/sync');
  });

  it('lists the jobs sorted A to Z', async () => {
    const html = await (await get(`/digest/${NORMAL}`)).text();
    const at = ['alpha/build', 'mid/render', 'zeta/sync'].map((job) => html.indexOf(job));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('shows unreadable lines: 0 for a night with no bad line', async () => {
    const html = await (await get(`/digest/${NORMAL}`)).text();
    expect(html).toContain('unreadable lines: 0');
  });

  it('shows unreadable lines: 1 and still renders the rows for a night with a bad line', async () => {
    const res = await get(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('unreadable lines: 1');
    expect(html).toContain('alpha/build');
    expect(html).toContain('zeta/sync');
  });

  it('says "nothing ran" for an empty night', async () => {
    const res = await get(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).toContain('unreadable lines: 0');
  });

  it('answers 404 for a night with no file', async () => {
    expect((await get(`/digest/${MISSING}`)).status).toBe(404);
  });

  it.each(['not-a-date', '2026-1-1', '2026-10-28x'])('answers 404 for a :night that is not YYYY-MM-DD (%s)', async (night) => {
    expect((await get(`/digest/${night}`)).status).toBe(404);
  });
});

describe('GET /api/digest/:night', () => {
  it('answers 200 JSON with the night, its rows sorted by job, and badLines 0', async () => {
    const res = await get(`/api/digest/${NORMAL}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual({
      night: NORMAL,
      rows: [
        {
          job: 'alpha/build',
          owner: null,
          runs: 2,
          retries: 1,
          lastStatus: 'ok',
          lastError: 'timeout',
          firstAt: '2026-10-28T23:00:00+01:00',
          lastAt: '2026-10-28T23:05:00+01:00',
        },
        {
          job: 'mid/render',
          owner: 'ada',
          runs: 1,
          retries: 0,
          lastStatus: 'fail',
          lastError: 'boom',
          firstAt: '2026-10-28T23:30:00+01:00',
          lastAt: '2026-10-28T23:30:00+01:00',
        },
        {
          job: 'zeta/sync',
          owner: 'rook',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-28T22:00:00+01:00',
          lastAt: '2026-10-28T22:00:00+01:00',
        },
      ],
      badLines: 0,
    });
  });

  it('counts the bad line and keeps the rows for a night with one', async () => {
    const res = await get(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { night: string; rows: { job: string }[]; badLines: number };
    expect(body.night).toBe(BAD);
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['alpha/build', 'zeta/sync']);
  });

  it('answers 200 with no rows and badLines 0 for an empty night', async () => {
    const res = await get(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: EMPTY, rows: [], badLines: 0 });
  });

  it('answers 404 with { "error": "no such night" } for a night with no file', async () => {
    const res = await get(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such night' });
  });

  it.each(['not-a-date', '2026-1-1', '..%2F..%2Fpackage'])(
    'answers 404 with { "error": "no such night" } for a :night that is not YYYY-MM-DD (%s)',
    async (night) => {
      const res = await get(`/api/digest/${night}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'no such night' });
    },
  );

  it('lists the same jobs, in the same order, as the page, for each night', async () => {
    for (const night of [NORMAL, BAD]) {
      const body = (await (await get(`/api/digest/${night}`)).json()) as { rows: { job: string }[] };
      const html = await (await get(`/digest/${night}`)).text();
      const at = body.rows.map((r) => html.indexOf(r.job));
      expect(at.every((i) => i >= 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    }
  });
});
