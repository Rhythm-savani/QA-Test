import type { GroupId, Options, RunConfig, RunMode } from './types';
import { enabledViewports } from './options';
import { validateCustomRules } from './options';

export interface ActiveTabInfo {
  tabId?: number;
  url?: string;
  origin?: string;
  isHttp: boolean;
  isShopify?: boolean;
  themeName?: string;
  themeId?: number;
  themeRole?: string;
}

export function groupsFor(o: Options): Record<GroupId, boolean> {
  const g = { ...o.groups };
  // Custom rules only run when rules exist (CHK-18 default "on if rules exist").
  if (validateCustomRules(o.customRules).rules.length === 0) g.custom = false;
  return g;
}

export function buildRunConfig(
  options: Options,
  tab: ActiveTabInfo,
  mode: RunMode,
  pages: string[],
): RunConfig | { error: string } {
  if (!tab.isHttp || !tab.url || !tab.origin) {
    return { error: 'Open an http(s) page of the storefront first.' };
  }
  if (mode === 'pages' && pages.length === 0) {
    return { error: 'Add at least one page to the Pages list.' };
  }
  return {
    mode,
    startUrl: tab.url,
    origin: tab.origin,
    pages: mode === 'pages' ? pages : undefined,
    viewports: mode === 'live' ? ['desktop'] : enabledViewports(options),
    groups: groupsFor(options),
    options,
  };
}

/** Permissions needed before a run can start (SAF-8: asked at the moment of use). */
export function permissionsNeeded(cfg: RunConfig): {
  permissions: chrome.runtime.ManifestPermission[];
  origins: string[];
  reasonDebugger: boolean;
} {
  const needsDebugger =
    cfg.mode !== 'live' && (cfg.viewports.some((v) => v !== 'desktop') || cfg.options.screenshots);
  const o = new URL(cfg.origin);
  // Match patterns ignore ports, so the pattern is host-only.
  const origin = `${o.protocol}//${o.hostname}/*`;
  return {
    permissions: needsDebugger ? ['debugger'] : [],
    origins: cfg.mode === 'live' ? [] : [origin],
    reasonDebugger: needsDebugger,
  };
}
