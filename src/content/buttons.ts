// Finding and pressing umingle's buttons by their visible labels.

/** Button labels that mean "go to the next stranger", best first. */
export const SKIP_LABELS: readonly RegExp[] = [/\bskip\b/i, /\bnext\b/i, /\bnew( chat)?\b/i, /\bstart\b/i];
/** umingle wants a "Really?" click as well as a Skip click. */
export const CONFIRM_LABEL = /\b(really|are you sure|confirm)\b/i;
const MAX_LABEL_LENGTH = 24; // ignore paragraphs that merely mention "skip"

export const CLICKABLE = 'button, [role="button"], a, input[type="button"], input[type="submit"], [onclick]';

export function labelOf(el: Element): string {
  const h = el as HTMLElement & { value?: unknown };
  const value = typeof h.value === 'string' ? h.value : '';
  return (h.innerText || value || el.getAttribute('aria-label') || h.title || '').trim();
}

export function describe(el: Element): string {
  return `<${el.tagName.toLowerCase()}> "${labelOf(el).slice(0, 20)}" ${el.outerHTML.slice(0, 160)}`;
}

export class ButtonFinder {
  /** CSS selector of a skip button the user picked by hand, if any. */
  skipSelector: string | null = null;

  /** @param exclude our own UI, never treated as a site button */
  constructor(
    private readonly doc: Document,
    private readonly exclude: Element | null = null,
  ) {}

  isVisible(el: Element | null): el is HTMLElement {
    if (!el || !el.isConnected || el === this.exclude) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = this.doc.defaultView!.getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && !(el as HTMLButtonElement).disabled;
  }

  /**
   * Every visible element with a short label. Sites often build buttons from
   * plain <div>s with JS listeners, so we can't rely on <button> tags.
   */
  labelled(): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const el of this.doc.body.querySelectorAll('*')) {
      if (el === this.exclude || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      const text = labelOf(el);
      if (text && text.length <= MAX_LABEL_LENGTH && this.isVisible(el)) out.push(el);
    }
    return out;
  }

  /**
   * The innermost element whose label matches, lifted to its clickable
   * ancestor when there is one (clicks on the leaf bubble up anyway).
   */
  findByLabel(re: RegExp, els: HTMLElement[] = this.labelled()): HTMLElement | null {
    const hits = els.filter((el) => re.test(labelOf(el)));
    const leaf = hits.find((el) => !hits.some((o) => o !== el && el.contains(o)));
    return leaf ? (leaf.closest<HTMLElement>(CLICKABLE) ?? leaf) : null;
  }

  findConfirm(): HTMLElement | null {
    return this.findByLabel(CONFIRM_LABEL);
  }

  findSkip(): HTMLElement | null {
    if (this.skipSelector) {
      const saved = this.doc.querySelector(this.skipSelector);
      if (this.isVisible(saved)) return saved;
    }
    const els = this.labelled();
    for (const re of SKIP_LABELS) {
      const hit = this.findByLabel(re, els);
      if (hit) return hit;
    }
    // Icon-only buttons: look at id/class names.
    return (
      [...this.doc.querySelectorAll<HTMLElement>(CLICKABLE)].find(
        (el) => this.isVisible(el) && /skip|next/i.test(`${el.id} ${el.className}`),
      ) ?? null
    );
  }
}

export function press(el: HTMLElement): void {
  const view = el.ownerDocument.defaultView!;
  const r = el.getBoundingClientRect();
  const opts: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    clientX: r.x + r.width / 2,
    clientY: r.y + r.height / 2,
  };
  const Pointer = view.PointerEvent ?? view.MouseEvent; // jsdom lacks PointerEvent
  el.dispatchEvent(new Pointer('pointerdown', opts));
  el.dispatchEvent(new view.MouseEvent('mousedown', opts));
  el.dispatchEvent(new Pointer('pointerup', opts));
  el.dispatchEvent(new view.MouseEvent('mouseup', opts));
  el.click();
}

export function pressEscape(doc: Document): void {
  const opts: KeyboardEventInit & { keyCode: number; which: number } = {
    key: 'Escape',
    code: 'Escape',
    keyCode: 27,
    which: 27,
    bubbles: true,
    cancelable: true,
  };
  const target = doc.activeElement ?? doc.body;
  const view = doc.defaultView!;
  target.dispatchEvent(new view.KeyboardEvent('keydown', opts));
  target.dispatchEvent(new view.KeyboardEvent('keyup', opts));
}
