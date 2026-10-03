// "Pick skip button" mode: the user clicks the site's button once and we
// remember a CSS selector for it.

import { labelOf } from './buttons';

// CSS.escape, with a fallback for environments that lack it (jsdom).
const cssEscape = (s: string): string =>
  typeof globalThis.CSS?.escape === 'function' ? CSS.escape(s) : s.replace(/^(\d)/, '\\3$1 ').replace(/[^\w-]/g, '\\$&');

/** A selector that uniquely matches `el` in its document, preferring short ones. */
export function cssPath(el: Element): string {
  const doc = el.ownerDocument;
  if (el.id && doc.querySelectorAll(`#${cssEscape(el.id)}`).length === 1) return `#${cssEscape(el.id)}`;
  const parts: string[] = [];
  for (let node: Element | null = el; node && node !== doc.documentElement; node = node.parentElement) {
    let part = node.tagName.toLowerCase();
    const classes = [...node.classList].filter((c) => !/^(active|hover|focus|disabled)/i.test(c)).slice(0, 3);
    if (classes.length) part += classes.map((c) => `.${cssEscape(c)}`).join('');
    parts.unshift(part);
    const sel = parts.join(' > ');
    if (doc.querySelectorAll(sel).length === 1) return sel;
    const parent: Element | null = node.parentElement;
    if (parent) {
      const tag = node.tagName;
      const same = [...parent.children].filter((c) => c.tagName === tag);
      if (same.length > 1) parts[0] += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
  }
  return parts.join(' > ');
}

export interface PickResult {
  selector: string;
  label: string;
}

/** Highlights elements under the mouse; resolves with the clicked one, or null on Esc. */
export function pickElement(doc: Document): Promise<PickResult | null> {
  return new Promise((resolve) => {
    const highlight = doc.createElement('div');
    Object.assign(highlight.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483646',
      outline: '3px solid #3ddc84',
      background: 'rgba(61,220,132,0.15)',
      borderRadius: '4px',
    });
    doc.documentElement.appendChild(highlight);

    const targetOf = (e: Event): Element => {
      const t = e.target as Element;
      return t.closest('button, [role="button"], a, input, [onclick]') ?? t;
    };
    const onMove = (e: MouseEvent): void => {
      const r = targetOf(e).getBoundingClientRect();
      Object.assign(highlight.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    const swallow = (e: Event): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onClick = (e: MouseEvent): void => {
      swallow(e);
      const target = targetOf(e);
      finish({ selector: cssPath(target), label: labelOf(target) });
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      swallow(e);
      finish(null);
    };
    function finish(result: PickResult | null): void {
      highlight.remove();
      doc.removeEventListener('mousemove', onMove, true);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('mousedown', swallow, true);
      doc.removeEventListener('pointerdown', swallow, true);
      doc.removeEventListener('keydown', onKey, true);
      resolve(result);
    }

    doc.addEventListener('mousemove', onMove, true);
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('mousedown', swallow, true);
    doc.addEventListener('pointerdown', swallow, true);
    doc.addEventListener('keydown', onKey, true);
  });
}
