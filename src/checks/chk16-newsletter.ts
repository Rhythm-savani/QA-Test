import type { Check, Finding, Rect, RunContext } from '../shared/types';
import { accessibleName, isVisible, rectOf, selectorFor, snippetOf } from '../engine/dom';
import { makeFinding } from './rules';

interface L1 {
  selector: string;
  snippet: string;
  rect?: Rect;
  inputType: string;
  required: boolean;
  hasName: boolean;
  hasSubmit: boolean;
  submitEnabled: boolean;
  action: string;
  method: string;
  hasMessageRegion: boolean;
  emptyInvalid: boolean;
  badInvalid: boolean;
}
interface L2 {
  attempted: boolean;
  email?: string;
  status?: number;
  finalUrl?: string;
  success?: boolean;
  captcha?: boolean;
  error?: string;
}
type Data = {
  found: boolean;
  thirdParty?: string;
  l1?: L1;
  l2?: L2;
};

const THIRD_PARTY =
  'form[action*="list-manage"], form[action*="klaviyo"], form[action*="omnisend"], [id^="mc_embed"], [class*="klaviyo"], [class*="omnisend"], [class*="privy"], [class*="mailchimp"], iframe[src*="klaviyo"], iframe[src*="privy"]';

export const chk16: Check<Data> = {
  id: 'CHK-16',
  title: 'Newsletter form',
  category: 'newsletter',
  group: 'newsletter',
  mutatesState: true,
  defaultEnabled: false,
  needs: ['shopify'],
  viewportScope: 'first',
  passedLabel: 'Newsletter form is well-formed',
  async collect(ctx) {
    const level = Number(ctx.params.newsletterLevel ?? 1);
    const email = String(ctx.params.newsletterEmail ?? '');
    const confirmed = ctx.params.newsletterConfirmed === true;
    const input = document.querySelector<HTMLInputElement>(
      'form input[name="contact[email]"], form.newsletter-form input[type=email]',
    );
    if (!input || !input.form) {
      const tp = document.querySelector(THIRD_PARTY);
      if (tp) return { found: false, thirdParty: selectorFor(tp) };
      return { found: false };
    }
    const form = input.form;
    const submit = form.querySelector<HTMLButtonElement | HTMLInputElement>(
      'button[type=submit], button:not([type]), input[type=submit]',
    );
    const original = input.value;
    input.value = '';
    const emptyInvalid = !input.checkValidity();
    input.value = 'not-an-email';
    const badInvalid = !input.checkValidity();
    input.value = original;
    const hasName = !!(
      accessibleName(input) ||
      (input.labels && input.labels.length > 0 && (input.labels[0].textContent ?? '').trim())
    );
    const l1: L1 = {
      selector: selectorFor(form),
      snippet: snippetOf(input),
      rect: isVisible(form) ? rectOf(form) : undefined,
      inputType: input.type,
      required: input.required,
      hasName:
        hasName &&
        !(
          input.labels?.length === 0 &&
          !input.getAttribute('aria-label') &&
          !input.getAttribute('aria-labelledby') &&
          !input.title
        ),
      hasSubmit: !!submit,
      submitEnabled: !!submit && !submit.disabled,
      action: form.getAttribute('action') ?? '',
      method: (form.getAttribute('method') ?? 'get').toLowerCase(),
      hasMessageRegion: !!form
        .closest('section, footer, div')
        ?.querySelector('.newsletter-form__message, [role=alert], [role=status], [aria-live]'),
      emptyInvalid,
      badInvalid,
    };
    const data: Data = { found: true, l1 };
    if (level === 2 && confirmed && email) {
      const l2: L2 = { attempted: true, email };
      try {
        const body = new FormData(form);
        body.set('contact[email]', email);
        const res = await fetch(form.action || location.href, {
          method: 'POST',
          body,
          credentials: 'same-origin',
          redirect: 'follow',
        });
        l2.status = res.status;
        l2.finalUrl = res.url;
        const html = await res.text();
        l2.captcha = /\/challenge/.test(res.url) || /g-recaptcha|h-captcha|hcaptcha/i.test(html);
        // The redirect parameter alone is not proof: the visitor must actually be shown the message.
        l2.success = /newsletter-form__message--success|form--success|Thanks for subscribing/i.test(
          html,
        );
      } catch (e) {
        l2.error = (e as Error).message;
      }
      data.l2 = l2;
    }
    return data;
  },
  analyze(d: Data, ctx: RunContext): Finding[] {
    const out: Finding[] = [];
    if (!d.found) {
      if (d.thirdParty) {
        out.push(
          makeFinding('CHK-16', ctx, {
            rule: 'newsletter/not-testable',
            severity: 'info',
            message:
              'A third-party newsletter form was detected; it cannot be tested reliably, so it was left alone.',
            selector: d.thirdParty,
          }),
        );
      }
      return out;
    }
    const l = d.l1!;
    const bad = (message: string) =>
      out.push(
        makeFinding('CHK-16', ctx, {
          rule: 'newsletter/form-invalid',
          severity: 'warning',
          message,
          selector: l.selector,
          htmlSnippet: l.snippet,
          rect: l.rect,
        }),
      );
    if (l.inputType !== 'email') bad(`Email input has type="${l.inputType}" instead of "email"`);
    if (!l.required) bad('Email input is not marked required');
    if (!l.hasName) bad('Email input has no accessible name (label or aria-label)');
    if (!l.hasSubmit) bad('Form has no submit control');
    else if (!l.submitEnabled) bad('Submit control is disabled');
    if (l.method !== 'post') bad(`Form method is "${l.method}", expected post`);
    if (l.inputType === 'email' && l.required && !l.emptyInvalid)
      bad('Empty value is accepted by form validation');
    if (l.inputType === 'email' && !l.badInvalid)
      bad('An invalid email address is accepted by form validation');
    if (!l.hasMessageRegion)
      bad('No message region (.newsletter-form__message or aria-live) found for feedback');
    const l2 = d.l2;
    if (l2?.attempted) {
      const note = `Test address submitted: ${l2.email}. It now exists as a real subscriber and must be removed from the store manually.`;
      if (l2.error) {
        out.push(
          makeFinding('CHK-16', ctx, {
            rule: 'newsletter/no-success-state',
            severity: 'error',
            message: `Newsletter submit failed: ${l2.error}. ${note}`,
            selector: l.selector,
            rect: l.rect,
          }),
        );
      } else if (l2.captcha) {
        out.push(
          makeFinding('CHK-16', ctx, {
            rule: 'newsletter/not-testable',
            severity: 'info',
            message: `Blocked by a captcha challenge; cannot test the submit. ${note}`,
            selector: l.selector,
          }),
        );
      } else if (!l2.success) {
        out.push(
          makeFinding('CHK-16', ctx, {
            rule: 'newsletter/no-success-state',
            severity: 'error',
            message: `Submitting the form (HTTP ${l2.status}) did not show a success state. ${note}`,
            selector: l.selector,
            htmlSnippet: l.snippet,
            rect: l.rect,
          }),
        );
      } else {
        out.push(
          makeFinding('CHK-16', ctx, {
            rule: 'newsletter/not-testable',
            severity: 'info',
            title: 'Newsletter submit succeeded',
            message: `Success state shown. ${note}`,
            selector: l.selector,
          }),
        );
      }
    }
    return out;
  },
};
