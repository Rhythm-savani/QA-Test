// chrome.storage.local wrappers (options, page lists, pending run requests).
import { DEFAULT_OPTIONS, sanitizeOptions } from './options';
import type { Options, RunConfig } from './types';

const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage?.local;
const mem = new Map<string, unknown>();

async function get<T>(key: string): Promise<T | undefined> {
  if (!hasChrome) return mem.get(key) as T | undefined;
  const r = await chrome.storage.local.get(key);
  return r[key] as T | undefined;
}
async function set(key: string, value: unknown): Promise<void> {
  if (!hasChrome) {
    mem.set(key, value);
    return;
  }
  await chrome.storage.local.set({ [key]: value });
}
async function remove(key: string): Promise<void> {
  if (!hasChrome) {
    mem.delete(key);
    return;
  }
  await chrome.storage.local.remove(key);
}

export async function loadOptions(): Promise<Options> {
  const raw = await get<unknown>('options');
  return raw === undefined ? structuredClone(DEFAULT_OPTIONS) : sanitizeOptions(raw);
}
export async function saveOptions(o: Options): Promise<void> {
  await set('options', o);
}
export async function patchOptions(patch: Partial<Options>): Promise<Options> {
  const next = sanitizeOptions({ ...(await loadOptions()), ...patch });
  await saveOptions(next);
  return next;
}

export async function loadPages(origin: string): Promise<string[]> {
  const all = (await get<Record<string, string[]>>('pagesByOrigin')) ?? {};
  return all[origin] ?? [];
}
export async function savePages(origin: string, pages: string[]): Promise<void> {
  const all = (await get<Record<string, string[]>>('pagesByOrigin')) ?? {};
  all[origin] = pages;
  await set('pagesByOrigin', all);
}

export interface LastRunInfo {
  runId: string;
  at: number;
  errors: number;
  warnings: number;
}
export async function loadLastRun(origin: string): Promise<LastRunInfo | undefined> {
  const all = (await get<Record<string, LastRunInfo>>('lastRunByOrigin')) ?? {};
  return all[origin];
}
export async function saveLastRun(origin: string, info: LastRunInfo): Promise<void> {
  const all = (await get<Record<string, LastRunInfo>>('lastRunByOrigin')) ?? {};
  all[origin] = info;
  await set('lastRunByOrigin', all);
}

export interface PendingRun {
  id: string;
  config: RunConfig;
  /** Tab to analyse in Live tab mode. */
  liveTabId?: number;
  createdAt: number;
}
export async function setPendingRun(p: PendingRun): Promise<void> {
  await set(`pending:${p.id}`, p);
}
export async function takePendingRun(id: string): Promise<PendingRun | undefined> {
  const p = await get<PendingRun>(`pending:${id}`);
  if (p) await remove(`pending:${id}`);
  return p;
}
