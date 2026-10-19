// 模拟 OpenChamber 宿主：在 happy-dom 里运行打包好的 panel/main.js，按 SDK 协议回应它发出的每条消息。
// 写法照 OpenChamber 自己的 packages/ui/src/lib/guests/sdk-examples.test.ts。
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { guestMessageSchema } from '@openchamber/sdk/schemas';
import type { GuestMessage, HostMessage, HostReadyContext, HostResultPayload } from '@openchamber/sdk';

export const context: HostReadyContext = {
  locale: 'zh-CN', directory: '/opt/classroom', session: null, surface: 'panel', connection: { connected: true, account: 'tester' }, settings: {}, item: null,
  features: { browserTabs: true },
  theme: { mode: 'light', tokens: {
    background: '#fff', elevated: '#fff', foreground: '#111', muted: '#666', subtle: '#eee', border: '#ccc', hover: '#eee',
    selection: '#ddd', focus: '#444', primary: '#444', font: 'sans-serif', mutedSurface: '#eee', elevatedForeground: '#111',
    active: '#ddd', selectionForeground: '#111', primaryForeground: '#fff', primaryText: '#444', successText: '#444',
    warningText: '#444', errorText: '#444', infoText: '#444', success: '#444', warning: '#444', error: '#444', info: '#444', mono: 'monospace', radius: '8px',
  } },
};

/** 回应一条带 id 的消息：返回结果载荷；抛出的错误按失败结果发回（带上 code）。 */
export type Handler = (message: GuestMessage) => Promise<HostResultPayload | undefined> | HostResultPayload | undefined;

export class HostError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const bundle = new URL('../panel/main.js', import.meta.url);
const windows: Window[] = [];

export async function closeAll(): Promise<void> {
  for (const window of windows.splice(0)) await window.happyDOM.close();
}

export async function loadPanel(handler: Handler) {
  const parent = new Window();
  const window = new Window({ url: 'https://guest.invalid/panel/index.html', settings: { disableJavaScriptEvaluation: false } });
  windows.push(window, parent);
  Object.defineProperty(window, 'parent', { value: parent });
  window.document.body.innerHTML = '<div id="root"></div>';
  const messages: GuestMessage[] = [];
  const send = (message: HostMessage) => window.dispatchEvent(new window.MessageEvent('message', { source: parent as never, data: message }));
  parent.postMessage = ((data: unknown) => {
    const message = guestMessageSchema.parse(data);
    messages.push(message);
    if (!('id' in message)) return;
    Promise.resolve()
      .then(() => handler(message))
      .then(
        (payload) => send({ channel: 'openchamber.sdk', v: 1, type: 'result', id: message.id, ok: true, ...(payload ? { payload } : {}) } as HostMessage),
        (error: unknown) => send({ channel: 'openchamber.sdk', v: 1, type: 'result', id: message.id, ok: false,
          error: error instanceof Error ? error.message : String(error), code: error instanceof HostError ? error.code : undefined } as HostMessage),
      );
  }) as never;
  runInNewContext(await readFile(bundle, 'utf8'), {
    window, document: window.document, self: window, console, URL, crypto, performance, TextEncoder,
    HTMLElement: window.HTMLElement, HTMLVideoElement: window.HTMLVideoElement, HTMLInputElement: window.HTMLInputElement,
    HTMLStyleElement: window.HTMLStyleElement, HTMLAnchorElement: window.HTMLAnchorElement, MessageEvent: window.MessageEvent, Event: window.Event,
    ResizeObserver: window.ResizeObserver, setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
  });
  const document = window.document;
  return {
    window,
    document,
    messages,
    ready: (next: Partial<HostReadyContext> = {}) => send({ channel: 'openchamber.sdk', v: 1, type: 'ready', payload: { ...context, ...next } } as HostMessage),
    send,
    /** happy-dom 的节点类型和 DOM 库的不一样，测试里按 DOM 类型用。 */
    q: <T = HTMLElement>(selector: string) => document.querySelector(selector) as unknown as T,
    of: <T extends GuestMessage['type']>(type: T) => messages.filter((message): message is Extract<GuestMessage, { type: T }> => message.type === type),
    button: (label: string) => {
      const found = [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === label);
      if (!found) throw new Error(`没有按钮：${label}；现有：${[...document.querySelectorAll('button')].map((element) => element.textContent?.trim()).join(' / ')}`);
      return found as unknown as HTMLButtonElement;
    },
  };
}

export async function waitFor<T>(probe: () => T | null | undefined | false, timeout = 3000, label = '条件'): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`等不到${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
