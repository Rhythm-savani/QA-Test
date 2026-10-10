// IndexedDB persistence for runs and evidence screenshots (survives service-worker suspension).
import type { RunRecord } from './types';

const DB_NAME = 'storefront-qa';
const VERSION = 1;

export interface ScreenshotRecord {
  id: string;
  runId: string;
  findingId: string;
  viewport: string;
  severity: number; // 0 error, 1 warning, 2 info — used when enforcing the per-run cap
  dataUrl: string;
  w: number;
  h: number;
}

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('runs')) {
        const s = db.createObjectStore('runs', { keyPath: 'id' });
        s.createIndex('origin', 'config.origin');
      }
      if (!db.objectStoreNames.contains('screenshots')) {
        const s = db.createObjectStore('screenshots', { keyPath: 'id' });
        s.createIndex('runId', 'runId');
      }
      if (!db.objectStoreNames.contains('baselines')) {
        db.createObjectStore('baselines', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function putRun(run: RunRecord): Promise<void> {
  const db = await open();
  await wrap(db.transaction('runs', 'readwrite').objectStore('runs').put(run));
}
export async function getRun(id: string): Promise<RunRecord | undefined> {
  const db = await open();
  return wrap(db.transaction('runs').objectStore('runs').get(id));
}
export async function listRuns(origin?: string): Promise<RunRecord[]> {
  const db = await open();
  const all = await wrap(db.transaction('runs').objectStore('runs').getAll());
  return (all as RunRecord[])
    .filter((r) => !origin || r.config.origin === origin)
    .sort((a, b) => b.startedAt - a.startedAt);
}
export async function putScreenshot(s: ScreenshotRecord): Promise<void> {
  const db = await open();
  await wrap(db.transaction('screenshots', 'readwrite').objectStore('screenshots').put(s));
}
export async function getScreenshot(id: string): Promise<ScreenshotRecord | undefined> {
  const db = await open();
  return wrap(db.transaction('screenshots').objectStore('screenshots').get(id));
}
export async function screenshotsForRun(runId: string): Promise<ScreenshotRecord[]> {
  const db = await open();
  return wrap(
    db.transaction('screenshots').objectStore('screenshots').index('runId').getAll(runId),
  );
}
export async function deleteScreenshot(id: string): Promise<void> {
  const db = await open();
  await wrap(db.transaction('screenshots', 'readwrite').objectStore('screenshots').delete(id));
}
export async function deleteRun(id: string): Promise<void> {
  const db = await open();
  for (const s of await screenshotsForRun(id)) await deleteScreenshot(s.id);
  await wrap(db.transaction('runs', 'readwrite').objectStore('runs').delete(id));
}
/** RPT-8: keep the newest `keep` runs per origin. */
export async function pruneHistory(origin: string, keep: number): Promise<void> {
  const runs = await listRuns(origin);
  for (const r of runs.slice(keep)) await deleteRun(r.id);
}
