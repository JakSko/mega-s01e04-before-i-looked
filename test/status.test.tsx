import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { countNight } from '../src/status.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

function tempRuns(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-status-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

describe('status board', () => {
  it('shows the lane banner and the nights on disk', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('2026-10-28');
  });

  it('links each night to its digest, with its counts beside it', async () => {
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(html).toContain('href="/digest/2026-10-28"');
    expect(html).toContain('href="/digest/2026-10-27"');
    expect(html).toContain('ok 10 · retry 4 · fail 1');
  });

  it('shows a night with no parseable lines as zero counts, not dropped', async () => {
    const dir = tempRuns({ '2026-11-01.jsonl': '' });
    const html = await (await createApp({ ...config, runsDir: dir }).request('/')).text();
    expect(html).toContain('href="/digest/2026-11-01"');
    expect(html).toContain('ok 0 · retry 0 · fail 0');
  });

  it('health answers with the lane id', async () => {
    const res = await createApp(config).request('/health');
    expect(await res.json()).toEqual({ ok: true, lane: 'lane-07' });
  });
});

describe('countNight', () => {
  it('counts the real night: 10 ok, 4 retry, 1 fail; the truncated last line is not counted', () => {
    expect(countNight('runs', '2026-10-28')).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('counts every parseable line by status; bad and blank lines count in none', () => {
    const runs = tempRuns({
      '2026-11-02.jsonl': [
        '{"at":"2026-11-02T01:00:00+01:00","job":"a","status":"ok","owner":null}',
        '{"at":"2026-11-02T01:05:00+01:00","job":"a","status":"retry","owner":"rook","error":"x"}',
        '',
        '{"at":"2026-11-02T01:10:00+01:00","job":"a","status":"retry","owner":"rook"}',
        '{"at":"2026-11-02T01:15:00+01:00","job":"b","status":"fail","owner":"rook"}',
        'not json',
        '{"at":"2026-11-02T01:20:00+01:00","job":"b","status":"maybe","owner":null}',
        '{"at":"2026-11-02T01:25:00+01:00","job":"b","status":"ok","owner":null}',
        '',
      ].join('\n'),
    });
    expect(countNight(runs, '2026-11-02')).toEqual({ ok: 2, retry: 2, fail: 1 });
  });

  it('returns null for a night with no file', () => {
    expect(countNight(tempRuns({}), '2026-11-03')).toBeNull();
  });
});
