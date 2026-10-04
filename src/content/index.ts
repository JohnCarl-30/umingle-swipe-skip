// Injected into umingle.com. Hosts the hand-detector iframe and clicks the
// site's Really?/Skip buttons whenever the detector reports a skip gesture.
// Also feeds the stranger's video to the detector, which sends them the
// jumpscare when they show a hand.
import { filtersActive } from '../shared/filters';
import {
  FILTERING_EVENT,
  FRAME_READY_EVENT,
  isFrameEnvelope,
  PAGE_SOURCE,
  type PageMessage,
  type StatusState,
} from '../shared/messages';
import { FILTER_KEYS, loadSettings, saveSetting } from '../shared/storage';
import { ButtonFinder, describe, press, pressEscape } from './buttons';
import { Panel } from './panel';
import { pickElement } from './picker';
import { performSkip } from './skip';
import { StrangerWatcher } from './stranger';

function init(): void {
  if (window.top !== window || document.getElementById('swipe-skip-frame')) return;

  const extOrigin = new URL(chrome.runtime.getURL('')).origin;
  const panel = new Panel(chrome.runtime.getURL('detector.html'));
  document.dispatchEvent(new CustomEvent(FRAME_READY_EVENT)); // lets the camera hook connect
  const finder = new ButtonFinder(document, panel.frame);
  let busy = false; // skipping or picking

  const log = (...args: unknown[]): void =>
    console.log('[swipe-skip]', ...args.map((a) => (a instanceof Element ? describe(a) : a)));

  function toFrame(msg: PageMessage): void {
    panel.frame.contentWindow?.postMessage({ source: PAGE_SOURCE, ...msg }, extOrigin);
  }
  const status = (text: string, state: StatusState): void => toFrame({ type: 'status', text, state });

  // ---------- jumpscare: feed the stranger's video to the detector ----------

  const watcher = new StrangerWatcher(
    (bitmap) =>
      panel.frame.contentWindow?.postMessage({ source: PAGE_SOURCE, type: 'stranger-frame', bitmap }, extOrigin, [bitmap]),
    (found) => toFrame({ type: 'stranger-video', found }),
  );
  function setScareEnabled(on: boolean): void {
    if (on) watcher.start();
    else watcher.stop();
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.scare) return;
    setScareEnabled(changes.scare.newValue === true);
  });

  void loadSettings(['skipSelector', 'panelPos', 'scare']).then(({ skipSelector, panelPos, scare: on }) => {
    finder.skipSelector = skipSelector;
    if (panelPos) panel.place(panelPos.left, panelPos.top);
    setScareEnabled(on);
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

// Runs at document_start. Tell the camera hook right away whether filters are
// on, so umingle never gets the unfiltered camera while the panel loads.
if (window.top === window) {
  void loadSettings(FILTER_KEYS).then((filters) => {
    document.dispatchEvent(new CustomEvent(FILTERING_EVENT, { detail: filtersActive(filters) ? 'on' : 'off' }));
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
