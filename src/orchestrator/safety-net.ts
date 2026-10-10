// Network-level enforcement of the safety rules (SAF-1..3): declarativeNetRequest session rules
// scoped to QA tab ids, so even a bug in click selection cannot reach checkout or mutate the cart.
export interface NetGuardOptions {
  allowCartMutation: boolean;
  allowContactPost: boolean;
}

const RULE_BASE = 9000;

export async function installNetGuard(tabIds: number[], opts: NetGuardOptions): Promise<void> {
  if (!chrome.declarativeNetRequest?.updateSessionRules) return;
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  let id = RULE_BASE;
  const nav = ['main_frame', 'sub_frame'] as chrome.declarativeNetRequest.ResourceType[];
  const all = [
    'main_frame',
    'sub_frame',
    'xmlhttprequest',
    'other',
  ] as chrome.declarativeNetRequest.ResourceType[];
  const block = (
    regexFilter: string,
    resourceTypes: chrome.declarativeNetRequest.ResourceType[],
    method?: string,
  ) =>
    rules.push({
      id: id++,
      priority: 1,
      action: { type: 'block' as chrome.declarativeNetRequest.RuleActionType },
      condition: {
        regexFilter,
        resourceTypes,
        tabIds,
        ...(method
          ? { requestMethods: [method as chrome.declarativeNetRequest.RequestMethod] }
          : {}),
      },
    });
  block('^https?://[^/]+(/[a-zA-Z-]{2,5})?/(checkouts?|cart/c)(/|\\?|$)', nav);
  block('^https?://[^/]+/\\d+/checkouts/', nav);
  block('^https?://[^/]+(/[a-zA-Z-]{2,5})?/account/logout', nav);
  if (!opts.allowCartMutation) {
    block(
      '^https?://[^/]+(/[a-zA-Z-]{2,5})?/cart/(add|change|update|clear)(\\.js|\\.json)?(\\?|$)',
      all,
      'post',
    );
  }
  if (!opts.allowContactPost) {
    block('^https?://[^/]+(/[a-zA-Z-]{2,5})?/contact(\\?|$|#)', all, 'post');
  }
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: Array.from({ length: 12 }, (_, i) => RULE_BASE + i),
    addRules: rules,
  });
}

export async function removeNetGuard(): Promise<void> {
  if (!chrome.declarativeNetRequest?.updateSessionRules) return;
  await chrome.declarativeNetRequest
    .updateSessionRules({ removeRuleIds: Array.from({ length: 12 }, (_, i) => RULE_BASE + i) })
    .catch(() => undefined);
}
