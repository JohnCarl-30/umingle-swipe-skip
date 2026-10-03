// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ButtonFinder, press, pressEscape } from '../src/content/buttons';
import { cssPath } from '../src/content/picker';
import { performSkip, type SkipResult } from '../src/content/skip';

beforeAll(() => {
  // jsdom has no layout: give every element a size and a text-based innerText.
  HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 50, height: 20 }) as DOMRect;
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent ?? '';
    },
  });
});

let events: string[];
beforeEach(() => {
  document.body.innerHTML = '';
  events = [];
});

function runSkip(finder = new ButtonFinder(document)): Promise<SkipResult> {
  return performSkip({
    findConfirm: () => finder.findConfirm(),
    findSkip: () => finder.findSkip(),
    press,
    pressEscape: () => pressEscape(document),
    status: () => {},
    timeoutMs: 1500,
  });
}

describe('performSkip on umingle-like pages', () => {
  it('handles a Skip button that turns into Really?', async () => {
    document.body.innerHTML = '<div class="btn"><span>Skip</span><small>Esc</small></div>';
    const btn = document.querySelector<HTMLElement>('.btn')!;
    let armed = false;
    btn.addEventListener('click', () => {
      armed = !armed;
      btn.innerHTML = armed ? '<span>Really?</span>' : '<span>Skip</span>';
      events.push(armed ? 'armed' : 'SKIPPED');
    });
    await runSkip();
    expect(events).toEqual(['armed', 'SKIPPED']);
  });

  it('waits for a Really? that appears late', async () => {
    document.body.innerHTML = '<button id="skip">⏭ Skip</button><div id="slot"></div>';
    document.getElementById('skip')!.addEventListener('click', () => {
      events.push('asked');
      setTimeout(() => {
        const really = document.createElement('div');
        really.textContent = 'Really?';
        really.addEventListener('click', () => events.push('SKIPPED'));
        document.getElementById('slot')!.append(really);
      }, 600);
    });
    await runSkip();
    expect(events).toEqual(['asked', 'SKIPPED']);
  });

  it('presses Really? first when it is showing, then Skip', async () => {
    document.body.innerHTML = '<div id="really">Really?</div>';
    const skip = document.createElement('div');
    skip.textContent = 'Skip';
    let confirmed = false;
    document.getElementById('really')!.addEventListener('click', (e) => {
      confirmed = true;
      events.push('really');
      (e.currentTarget as Element).remove();
      document.body.append(skip);
    });
    skip.addEventListener('click', () => events.push(confirmed ? 'SKIPPED' : 'skip-too-early'));
    const result = await runSkip();
    expect(events).toEqual(['really', 'SKIPPED']);
    expect(result).toMatchObject({ confirmed: true, skipped: true });
  });

  it('presses Really? before Skip when both are visible', async () => {
    document.body.innerHTML = '<button id="r">Really?</button><button id="s">Skip</button>';
    let confirmed = false;
    document.getElementById('r')!.addEventListener('click', () => {
      confirmed = true;
      events.push('really');
    });
    document.getElementById('s')!.addEventListener('click', () => events.push(confirmed ? 'SKIPPED' : 'skip-too-early'));
    await runSkip();
    expect(events).toEqual(['really', 'SKIPPED']);
  });

  it('sends Esc twice when there is no button', async () => {
    document.body.innerHTML = '<p>Looking for someone you can chat with… please wait while we connect</p>';
    document.addEventListener('keydown', (e) => events.push(e.key), { once: false });
    const result = await runSkip();
    expect(events).toEqual(['Escape', 'Escape']);
    expect(result.usedEscape).toBe(true);
  });

  it('uses a picked selector for icon-only buttons', async () => {
    document.body.innerHTML = '<div class="bar"><i class="ico a"></i><i class="ico b"></i></div>';
    const target = document.querySelector<HTMLElement>('.ico.b')!;
    target.addEventListener('click', () => events.push('SKIPPED'));
    const finder = new ButtonFinder(document);
    finder.skipSelector = cssPath(target);
    expect(document.querySelector(finder.skipSelector)).toBe(target);
    await runSkip(finder);
    expect(events).toEqual(['SKIPPED']);
  });

  it('never clicks the excluded panel', () => {
    document.body.innerHTML = '<div id="panel">Skip</div>';
    const finder = new ButtonFinder(document, document.getElementById('panel'));
    expect(finder.findSkip()).toBeNull();
  });
});
