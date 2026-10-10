// Service worker: intentionally thin. It owns the keyboard command and nothing else. The run
// itself is orchestrated from the report page, which stays open and therefore cannot be
// suspended mid-run (RUN-9).
import { loadOptions, loadPages, setPendingRun } from '../shared/storage';
import { buildRunConfig, type ActiveTabInfo } from '../shared/run-config';

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'run-check') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const options = await loadOptions();
  const info: ActiveTabInfo = {
    tabId: tab?.id,
    url: tab?.url,
    isHttp: !!tab?.url && /^https?:\/\//i.test(tab.url),
    origin: tab?.url && /^https?:\/\//i.test(tab.url) ? new URL(tab.url).origin : undefined,
  };
  const pages = info.origin ? await loadPages(info.origin) : [];
  const cfg = buildRunConfig(options, info, options.lastMode, pages);
  if ('error' in cfg) {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#B42318' });
    setTimeout(() => void chrome.action.setBadgeText({ text: '' }), 4000);
    return;
  }
  const id = crypto.randomUUID();
  await setPendingRun({
    id,
    config: cfg,
    liveTabId: cfg.mode === 'live' ? info.tabId : undefined,
    createdAt: Date.now(),
  });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`report.html?run=${id}`) });
});
