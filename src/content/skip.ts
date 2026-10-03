// The click sequence that moves umingle on to the next stranger.

import type { StatusState } from '../shared/messages';

export interface SkipDeps {
  findConfirm: () => HTMLElement | null;
  findSkip: () => HTMLElement | null;
  press: (el: HTMLElement) => void;
  pressEscape: () => void;
  status: (text: string, state: StatusState) => void;
  log?: (...args: unknown[]) => void;
  timeoutMs?: number;
}

export interface SkipResult {
  confirmed: boolean;
  skipped: boolean;
  usedEscape: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * umingle needs both a "Really?" click and a "Skip" click. The order depends
 * on the page state, so press whichever is showing until both are done.
 */
export async function performSkip(deps: SkipDeps): Promise<SkipResult> {
  const { findConfirm, findSkip, press, pressEscape, status, log = () => {}, timeoutMs = 2500 } = deps;
  let confirmed = false;
  let skipped = false;
  const end = performance.now() + timeoutMs;

  while (!(confirmed && skipped) && performance.now() < end) {
    const confirm = confirmed ? null : findConfirm();
    const btn = confirm || skipped ? null : findSkip();
    if (confirm) {
      log('pressing Really', confirm);
      press(confirm);
      confirmed = true;
      status(skipped ? 'Skipped ✓' : 'Really ✓ — now Skip…', 'loading');
      await sleep(250);
    } else if (btn) {
      log('pressing Skip', btn);
      press(btn);
      skipped = true;
      status(confirmed ? 'Skipped ✓' : 'Skip ✓ — now Really…', 'loading');
      await sleep(250);
    } else if (!confirmed && !skipped) {
      break; // nothing to press at all
    } else {
      await sleep(100);
    }
  }

  if (!confirmed && !skipped) {
    log('no Really/Skip button found; sending Esc twice');
    pressEscape();
    await sleep(150);
    pressEscape();
    status('No Skip button — sent Esc', 'error');
    return { confirmed, skipped, usedEscape: true };
  }

  log(`done: Really=${confirmed} Skip=${skipped}`);
  if (confirmed && skipped) status('Skipped ✓', 'ready');
  else status(confirmed ? 'Pressed Really, no Skip seen' : 'Pressed Skip, no Really seen', 'error');
  return { confirmed, skipped, usedEscape: false };
}
