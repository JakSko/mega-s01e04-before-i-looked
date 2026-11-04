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
