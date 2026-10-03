// Injected into umingle.com. Hosts the hand-detector iframe and clicks the
// site's Really?/Skip buttons whenever the detector reports a right swipe.
import { isFrameEnvelope, PAGE_SOURCE, type PageMessage, type StatusState } from '../shared/messages';
import { loadSettings, saveSetting } from '../shared/storage';
import { ButtonFinder, describe, press, pressEscape } from './buttons';
import { Panel } from './panel';
import { pickElement } from './picker';
import { performSkip } from './skip';

function init(): void {
  if (window.top !== window || document.getElementById('swipe-skip-frame')) return;

  const extOrigin = new URL(chrome.runtime.getURL('')).origin;
  const panel = new Panel(chrome.runtime.getURL('detector.html'));
  const finder = new ButtonFinder(document, panel.frame);
  let busy = false; // skipping or picking

  const log = (...args: unknown[]): void =>
    console.log('[swipe-skip]', ...args.map((a) => (a instanceof Element ? describe(a) : a)));

  function toFrame(msg: PageMessage): void {
    panel.frame.contentWindow?.postMessage({ source: PAGE_SOURCE, ...msg }, extOrigin);
  }
  const status = (text: string, state: StatusState): void => toFrame({ type: 'status', text, state });

  void loadSettings(['skipSelector', 'panelPos']).then(({ skipSelector, panelPos }) => {
    finder.skipSelector = skipSelector;
    if (panelPos) panel.place(panelPos.left, panelPos.top);
  });

  async function skip(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await performSkip({
        findConfirm: () => finder.findConfirm(),
        findSkip: () => finder.findSkip(),
        press,
        pressEscape: () => pressEscape(document),
        status,
        log,
      });
    } finally {
      busy = false;
    }
  }

  async function pick(): Promise<void> {
    if (busy) return;
    busy = true;
    status('Click the skip button… (Esc cancels)', 'loading');
    try {
      const result = await pickElement(document);
      if (!result) {
        status('Pick cancelled', 'ready');
        return;
      }
      finder.skipSelector = result.selector;
      saveSetting('skipSelector', result.selector);
      log('picked skip button', result.selector);
      status(`Saved: ${result.label.slice(0, 16) || 'button'}`, 'ready');
    } finally {
      busy = false;
    }
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== extOrigin || e.source !== panel.frame.contentWindow || !isFrameEnvelope(e.data)) return;
    const msg = e.data;
    switch (msg.type) {
      case 'swipe':
        void skip();
        break;
      case 'pick':
        void pick();
        break;
      case 'drag':
        panel.moveBy(msg.dx, msg.dy);
        break;
      case 'drag-end':
        saveSetting('panelPos', panel.position);
        break;
      case 'resize':
        panel.resize(msg.width, msg.height);
        break;
    }
  });
}

init();
