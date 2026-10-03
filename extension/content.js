// Injected into umingle.com. Hosts the hand-detector iframe and clicks the
// site's skip button whenever the detector reports a right swipe.
(() => {
  if (window.top !== window || document.getElementById('swipe-skip-frame')) return;

  const EXT_ORIGIN = new URL(chrome.runtime.getURL('')).origin;
  // Button labels that mean "go to the next stranger", best first.
  const LABELS = [/\bskip\b/i, /\bnext\b/i, /\bnew( chat)?\b/i, /\bstart\b/i];
  // umingle wants a "Really?" click as well as a Skip click.
  const CONFIRM_LABEL = /\b(really|are you sure|confirm)\b/i;
  const MAX_LABEL_LENGTH = 24; // ignore paragraphs that merely mention "skip"
  const CONFIRM_WAIT_MS = 2500;

  let skipSelector = null;
  let picking = false;
  let skipping = false;

  const log = (...args) => console.log('[swipe-skip]', ...args);
  const describe = (el) => `<${el.tagName.toLowerCase()}> "${labelOf(el).slice(0, 20)}" ${el.outerHTML.slice(0, 160)}`;

  chrome.storage.local.get('skipSelector').then((s) => { skipSelector = s.skipSelector || null; });

  // ---------- detector iframe ----------

  const frame = document.createElement('iframe');
  frame.id = 'swipe-skip-frame';
  frame.src = chrome.runtime.getURL('detector.html');
  frame.allow = 'camera';
  Object.assign(frame.style, {
    position: 'fixed',
    left: '12px',
    top: `${Math.max(12, window.innerHeight - 272)}px`,
    width: '192px',
    height: '260px',
    border: '0',
    borderRadius: '12px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
    zIndex: '2147483647',
    background: 'transparent',
    colorScheme: 'normal',
  });
  document.documentElement.appendChild(frame);

  function toFrame(type, data = {}) {
    frame.contentWindow?.postMessage({ source: 'swipe-skip-page', type, ...data }, EXT_ORIGIN);
  }

  // ---------- dragging (driven by the panel's header inside the iframe) ----------

  const pos = { left: 12, top: parseFloat(frame.style.top) };

  // Keep the panel fully on screen.
  function place(left, top) {
    pos.left = Math.min(Math.max(0, left), Math.max(0, window.innerWidth - frame.offsetWidth));
    pos.top = Math.min(Math.max(0, top), Math.max(0, window.innerHeight - frame.offsetHeight));
    frame.style.left = `${pos.left}px`;
    frame.style.top = `${pos.top}px`;
  }

  chrome.storage.local.get('panelPos').then(({ panelPos }) => {
    if (panelPos) place(panelPos.left, panelPos.top);
  });
  window.addEventListener('resize', () => place(pos.left, pos.top));

  window.addEventListener('message', (e) => {
    if (e.origin !== EXT_ORIGIN || e.source !== frame.contentWindow) return;
    const msg = e.data;
    if (msg?.source !== 'swipe-skip') return;
    if (msg.type === 'swipe') skip();
    else if (msg.type === 'pick') startPicking();
    else if (msg.type === 'drag') place(pos.left + msg.dx, pos.top + msg.dy);
    else if (msg.type === 'drag-end') chrome.storage.local.set({ panelPos: { ...pos } });
    else if (msg.type === 'resize') {
      frame.style.width = `${msg.width}px`;
      frame.style.height = `${msg.height}px`;
      place(pos.left, pos.top);
    }
  });

  // ---------- finding and pressing skip ----------

  function isVisible(el) {
    if (!el || !el.isConnected || el === frame) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && !el.disabled;
  }

  function labelOf(el) {
    return (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim();
  }

  const CLICKABLE = 'button, [role="button"], a, input[type="button"], input[type="submit"], [onclick]';

  // Every visible element with a short label. Sites often build buttons from
  // plain <div>s with JS listeners, so we can't rely on <button> tags.
  function labelled() {
    const out = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el === frame || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      const text = labelOf(el);
      if (text && text.length <= MAX_LABEL_LENGTH && isVisible(el)) out.push(el);
    }
    return out;
  }

  // The innermost element whose label matches, lifted to its clickable
  // ancestor when there is one (clicks on the leaf bubble up anyway).
  function findByLabel(re, els = labelled()) {
    const hits = els.filter((el) => re.test(labelOf(el)));
    const leaf = hits.find((el) => !hits.some((o) => o !== el && el.contains(o)));
    return leaf ? leaf.closest(CLICKABLE) || leaf : null;
  }

  function findSkipButton() {
    if (skipSelector) {
      const saved = document.querySelector(skipSelector);
      if (isVisible(saved)) return saved;
    }
    const els = labelled();
    for (const re of LABELS) {
      const hit = findByLabel(re, els);
      if (hit) return hit;
    }
    // Icon-only buttons: look at id/class names.
    return [...document.querySelectorAll(CLICKABLE)]
      .find((el) => isVisible(el) && /skip|next/i.test(`${el.id} ${el.className}`)) || null;
  }


  function press(el) {
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  function pressEscape() {
    const opts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    const target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // umingle needs both a "Really?" click and a "Skip" click. The order depends
  // on the page state, so press whichever is showing until both are done.
  async function skip() {
    if (picking || skipping) return;
    skipping = true;
    try {
      let confirmed = false;
      let skipped = false;
      const end = performance.now() + CONFIRM_WAIT_MS;

      while (!(confirmed && skipped) && performance.now() < end) {
        const confirm = !confirmed && findByLabel(CONFIRM_LABEL);
        const btn = !confirm && !skipped && findSkipButton();
        if (confirm) {
          log('pressing Really', describe(confirm));
          press(confirm);
          confirmed = true;
          toFrame('status', { text: skipped ? 'Skipped ✓' : 'Really ✓ — now Skip…', state: 'loading' });
          await sleep(250);
        } else if (btn) {
          log('pressing Skip', describe(btn));
          press(btn);
          skipped = true;
          toFrame('status', { text: confirmed ? 'Skipped ✓' : 'Skip ✓ — now Really…', state: 'loading' });
          await sleep(250);
        } else if (!confirmed && !skipped) {
          break; // nothing to press at all
        } else {
          await sleep(100);
        }
      }

      if (confirmed || skipped) {
        log(`done: Really=${confirmed} Skip=${skipped}`);
        toFrame('status', {
          text: confirmed && skipped ? 'Skipped ✓' : confirmed ? 'Pressed Really, no Skip seen' : 'Pressed Skip, no Really seen',
          state: confirmed && skipped ? 'ready' : 'error',
        });
      } else {
        log('no Really/Skip button found; sending Esc twice');
        pressEscape();
        await sleep(150);
        pressEscape();
        toFrame('status', { text: 'No Skip button — sent Esc', state: 'error' });
      }
    } finally {
      skipping = false;
    }
  }

  // ---------- "pick skip button" mode ----------

  function cssPath(el) {
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`;
    const parts = [];
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      const classes = [...node.classList].filter((c) => !/^(active|hover|focus|disabled)/i.test(c)).slice(0, 3);
      if (classes.length) part += classes.map((c) => `.${CSS.escape(c)}`).join('');
      parts.unshift(part);
      const sel = parts.join(' > ');
      if (document.querySelectorAll(sel).length === 1) return sel;
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) parts[0] += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
    }
    return parts.join(' > ');
  }

  function startPicking() {
    if (picking) return;
    picking = true;
    toFrame('status', { text: 'Click the skip button… (Esc cancels)', state: 'loading' });

    const highlight = document.createElement('div');
    Object.assign(highlight.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: '2147483646',
      outline: '3px solid #3ddc84', background: 'rgba(61,220,132,0.15)', borderRadius: '4px',
    });
    document.documentElement.appendChild(highlight);

    const targetOf = (e) => e.target.closest('button, [role="button"], a, input, [onclick]') || e.target;
    const onMove = (e) => {
      const r = targetOf(e).getBoundingClientRect();
      Object.assign(highlight.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    const swallow = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const onClick = (e) => {
      swallow(e);
      skipSelector = cssPath(targetOf(e));
      chrome.storage.local.set({ skipSelector });
      finish(`Saved: ${labelOf(targetOf(e)).slice(0, 16) || 'button'}`, 'ready');
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      swallow(e);
      finish('Pick cancelled', 'ready');
    };
    function finish(text, state) {
      picking = false;
      highlight.remove();
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mousedown', swallow, true);
      document.removeEventListener('pointerdown', swallow, true);
      document.removeEventListener('keydown', onKey, true);
      toFrame('status', { text, state });
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', swallow, true);
    document.addEventListener('pointerdown', swallow, true);
    document.addEventListener('keydown', onKey, true);
  }
})();
