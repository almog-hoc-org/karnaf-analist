/**
 * One night job at a time.
 *
 * Collection (00:30) and the cleaning pipeline (02:30) ran with no lock
 * between them: the collector's 100-minute budget only stops it STARTING
 * sources, a source started at 02:10 may run to 03:40, and Persistent=
 * timers fire both at once after downtime. The pipeline then aggregated a
 * population that was still moving. The collector holds this lock while it
 * runs; the pipeline waits for it (up to a bound) before its first stage.
 *
 * A lock file, not flock: the two processes are separate `docker exec`s and
 * a file in the data directory is what they share. A lock older than
 * STALE_MS is ignored — the process that wrote it was killed without the
 * chance to remove it.
 */
import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve(process.env.KARNAF_DATA_DIR ?? "./data");
export const COLLECT_LOCK = path.join(DATA_DIR, ".collect.lock");
const STALE_MS = 3 * 60 * 60_000;

/** Age of a live lock in ms, or null when there is none (or it is stale). */
export function lockAgeMs(file = COLLECT_LOCK, now = Date.now()): number | null {
  try {
    const age = now - fs.statSync(file).mtimeMs;
    return age < STALE_MS ? age : null;
  } catch {
    return null;
  }
}

export function acquire(file = COLLECT_LOCK): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${process.pid} ${new Date().toISOString()}\n`);
}

export function release(file = COLLECT_LOCK): void {
  try { fs.unlinkSync(file); } catch { /* already gone */ }
}

/** Wait until the lock is gone, polling; resolves false if it is still held at the deadline. */
export async function waitFor(maxMs: number, file = COLLECT_LOCK, pollMs = 30_000): Promise<boolean> {
  const t0 = Date.now();
  while (lockAgeMs(file) != null) {
    if (Date.now() - t0 >= maxMs) return false;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return true;
}
