import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RigConfig } from './config.js';
import { parseLine } from './digest/read.js';
import type { RunStatus } from './digest/types.js';
import { lastBeat, type Beat } from './heartbeat.js';

// Per-line counts of one night's run log. Lines that do not parse are in none of them.
export type Counts = Record<RunStatus, number>;

export type NightOnBoard = {
  night: string;
  // null when the file cannot be read: the board shows `—`, never drops the night.
  counts: Counts | null;
};

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: NightOnBoard[];
};

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// Counts every parseable line of runs/<night>.jsonl by its status. Blank lines are not runs.
export function countNight(runsDir: string, night: string): Counts | null {
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch {
    return null;
  }
  const counts: Counts = { ok: 0, retry: 0, fail: 0 };
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (line) counts[line.status] += 1;
  }
  return counts;
}

export function readStatus(config: RigConfig): Status {
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights: nightsOnDisk(config.runsDir).map((night) => ({ night, counts: countNight(config.runsDir, night) })),
  };
}
