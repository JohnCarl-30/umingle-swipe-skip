// The floating, draggable iframe that hosts the detector UI.

import type { PanelPosition } from '../shared/storage';

const MARGIN = 12;

export class Panel {
  readonly frame: HTMLIFrameElement;
  private pos: PanelPosition;

  constructor(src: string) {
    const frame = document.createElement('iframe');
    frame.id = 'swipe-skip-frame';
    frame.src = src;
    frame.allow = 'camera; autoplay'; // autoplay: lets the scream play on your speakers
    this.pos = { left: MARGIN, top: Math.max(MARGIN, window.innerHeight - 420 - MARGIN) };
    Object.assign(frame.style, {
      position: 'fixed',
      left: `${this.pos.left}px`,
      top: `${this.pos.top}px`,
      width: '262px',
      height: '420px',
      border: '0',
      borderRadius: '16px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      zIndex: '2147483647',
      background: 'transparent',
      colorScheme: 'normal',
    });
    document.documentElement.appendChild(frame);
    this.frame = frame;
    window.addEventListener('resize', () => this.place(this.pos.left, this.pos.top));
  }

  get position(): PanelPosition {
    return { ...this.pos };
  }

  /** Move to (left, top), keeping the panel fully on screen. */
  place(left: number, top: number): void {
    this.pos = {
      left: Math.min(Math.max(0, left), Math.max(0, window.innerWidth - this.frame.offsetWidth)),
      top: Math.min(Math.max(0, top), Math.max(0, window.innerHeight - this.frame.offsetHeight)),
    };
    this.frame.style.left = `${this.pos.left}px`;
    this.frame.style.top = `${this.pos.top}px`;
  }

  moveBy(dx: number, dy: number): void {
    this.place(this.pos.left + dx, this.pos.top + dy);
  }

  resize(width: number, height: number): void {
    this.frame.style.width = `${width}px`;
    this.frame.style.height = `${height}px`;
    this.place(this.pos.left, this.pos.top);
  }
}
