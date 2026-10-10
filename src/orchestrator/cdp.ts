// Thin wrapper around chrome.debugger for QA tabs. Only ever attached to tabs this run owns
// (or the active tab in Live tab mode, and then without emulation).
import type { NetFailure, ViewportDef } from '../shared/types';

export const BINDING = '__sqaBinding';

type Handler = (method: string, params: Record<string, unknown>) => void;
const sessions = new Map<number, CdpSession>();
let listening = false;

function ensureListener() {
  if (listening) return;
  listening = true;
  chrome.debugger.onEvent.addListener((src, method, params) => {
    if (src.tabId === undefined) return;
    sessions.get(src.tabId)?.dispatch(method, (params ?? {}) as Record<string, unknown>);
  });
  chrome.debugger.onDetach.addListener((src) => {
    if (src.tabId !== undefined) sessions.get(src.tabId)?.markDetached();
  });
}

export interface RpcRequest {
  id: number;
  op: string;
  [k: string]: unknown;
}

export class CdpSession {
  attached = false;
  failures: NetFailure[] = [];
  docStatus: number | undefined;
  private mainFrameId = '';
  private urls = new Map<string, { url: string; type?: string }>();
  private extra: Handler[] = [];
  rpcHandler: ((req: RpcRequest) => Promise<unknown>) | null = null;

  constructor(readonly tabId: number) {
    ensureListener();
    sessions.set(tabId, this);
  }

  async attach(): Promise<void> {
    await chrome.debugger.attach({ tabId: this.tabId }, '1.3');
    this.attached = true;
    await this.send('Page.enable');
    const tree = await this.send<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree');
    this.mainFrameId = tree.frameTree.frame.id;
    await this.send('Network.enable');
    await this.send('Runtime.enable');
    await this.send('Runtime.addBinding', { name: BINDING });
    // Keep rendering and focus alive even though the QA window is not focused.
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
  }

  async injectEarly(source: string): Promise<void> {
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source });
  }

  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T> {
    return chrome.debugger.sendCommand({ tabId: this.tabId }, method, params) as Promise<T>;
  }

  async emulate(vp: ViewportDef): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: vp.dpr,
      mobile: vp.mobile,
    });
    await this.send(
      'Emulation.setTouchEmulationEnabled',
      vp.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
    );
  }

  async clearEmulation(): Promise<void> {
    await this.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined);
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(
      () => undefined,
    );
  }

  resetCollected() {
    this.failures = [];
    this.docStatus = undefined;
    this.urls.clear();
  }

  dispatch(method: string, p: Record<string, unknown>) {
    for (const h of this.extra) h(method, p);
    switch (method) {
      case 'Network.requestWillBeSent': {
        const req = p.request as { url: string } | undefined;
        if (req)
          this.urls.set(String(p.requestId), { url: req.url, type: p.type as string | undefined });
        break;
      }
      case 'Network.responseReceived': {
        const r = p.response as { url: string; status: number } | undefined;
        if (!r) break;
        if (p.type === 'Document' && p.frameId === this.mainFrameId) {
          // only the top-level document matters; subframes are reported like any resource
          this.docStatus ??= r.status;
        }
        if (r.status >= 400) {
          this.failures.push({
            url: r.url,
            status: r.status,
            type: String(p.type ?? ''),
            initiator: String(p.type ?? ''),
          });
        }
        break;
      }
      case 'Network.loadingFailed': {
        if (p.canceled) break;
        const known = this.urls.get(String(p.requestId));
        if (!known) break;
        this.failures.push({
          url: known.url,
          errorText: String(p.errorText ?? ''),
          type: String(p.type ?? known.type ?? ''),
          initiator: String(p.type ?? known.type ?? ''),
        });
        break;
      }
      case 'Page.frameNavigated': {
        const f = p.frame as { id: string; parentId?: string } | undefined;
        if (f && !f.parentId) this.mainFrameId = f.id;
        break;
      }
      case 'Page.javascriptDialogOpening':
        // alert()/confirm() would block the page forever; dismiss and move on.
        void this.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => undefined);
        break;
      case 'Runtime.bindingCalled': {
        if (p.name !== BINDING || !this.rpcHandler) break;
        let req: RpcRequest;
        try {
          req = JSON.parse(String(p.payload)) as RpcRequest;
        } catch {
          break;
        }
        const handler = this.rpcHandler;
        void handler(req)
          .catch(() => null)
          .then((result) => {
            if (req.id) {
              return this.send('Runtime.evaluate', {
                expression: `window.__sqa&&window.__sqa.rpcResolve(${req.id},${JSON.stringify(result ?? null)})`,
              });
            }
            return undefined;
          })
          .catch(() => undefined);
        break;
      }
    }
  }

  onEvent(h: Handler) {
    this.extra.push(h);
  }

  markDetached() {
    this.attached = false;
  }

  async mouseClick(x: number, y: number): Promise<void> {
    const base = { x, y, button: 'left', pointerType: 'mouse' };
    await this.send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved' });
    await this.send('Input.dispatchMouseEvent', {
      ...base,
      type: 'mousePressed',
      clickCount: 1,
      buttons: 1,
    });
    await this.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', clickCount: 1 });
  }

  async keyPress(key: 'Escape'): Promise<void> {
    const p = { key, code: key, windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await this.send('Input.dispatchKeyEvent', { ...p, type: 'keyDown' });
    await this.send('Input.dispatchKeyEvent', { ...p, type: 'keyUp' });
  }

  async detach(): Promise<void> {
    sessions.delete(this.tabId);
    if (!this.attached) return;
    this.attached = false;
    await chrome.debugger.detach({ tabId: this.tabId }).catch(() => undefined);
  }
}
