// Plan morning-digest § 1. The shape every part of § 2 (page, JSON, board link) builds on.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One job's night, folded from its lines in runs/<night>.jsonl.
export type DigestRow = {
  job: string;
  // null = the log said "no owner". Views show it as `—`; never drop the row.
  owner: string | null;
  // The job's lines.
  runs: number;
  // Its lines with status `retry`.
  retries: number;
  // Status of the job's last line.
  lastStatus: RunStatus;
  // The last error seen for the job, even when its last status is `ok`. null if it never erred.
  lastError: string | null;
  // `at` of the job's first and last line, exactly as logged: the log's offset, never UTC.
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string;
  // One row per job, sorted by job, so the page and the JSON agree on the order.
  rows: DigestRow[];
  // Lines that did not parse. Counted, never thrown.
  badLines: number;
};

// Reads `<runsDir>/<night>.jsonl`. Returns null when there is no such night (no file, or `night`
// is not YYYY-MM-DD), so a route can answer 404. An empty file is a night with zero rows.
export type ReadNight = (runsDir: string, night: string) => Night | null;
