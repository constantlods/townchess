import { formatClock, type Color, type Promotion } from '@hc/shared';
import { h } from './dom';
import { ICONS, PIECE_ICONS } from './icons';
import { drawPortrait } from './portrait';
import type { PresenterUI } from '../game/presenter';
import { clockAt, type SessionState } from '../game/session';

export interface HudActions {
  offerDraw(): void;
  resign(): void;
  settings(): void;
  rematch(): void;
  lobby(): void;
  click(): void;
}

/** In-game interface: two player plates with clocks, the left control strip, prompts, game over. */
export class Hud implements PresenterUI {
  readonly root: HTMLDivElement;
  private me = this.plate('me');
  private them = this.plate('them');
  private controls: HTMLDivElement;
  private toastEl = h('div', { class: 'toast panel' });
  private toastTimer = 0;
  private gameover: HTMLDivElement;
  private goTitle = h('div', { class: 'title' });
  private goResult = h('div', { class: 'result' });
  private goDetail = h('div', { class: 'detail' });
  private promptEl: HTMLDivElement | null = null;
  private state: SessionState | null = null;
  private myColor: Color = 'w';
  private lastSecond: Record<Color, number> = { w: -1, b: -1 };

  constructor(parent: HTMLElement, private actions: HudActions) {
    const act = (fn: () => void) => () => { actions.click(); fn(); };
    const menuBtn = h('button', { class: 'ctl menu-btn', 'aria-label': 'Menu', html: ICONS.menu, onclick: () => { actions.click(); this.controls.classList.toggle('open'); } });
    this.controls = h('div', { class: 'controls' },
      menuBtn,
      h('button', { class: 'ctl', onclick: act(() => actions.offerDraw()) }, this.icon(ICONS.handshake), 'Offer Draw'),
      h('button', { class: 'ctl', onclick: act(() => this.confirmResign()) }, this.icon(ICONS.flag), 'Resign'),
      h('button', { class: 'ctl', onclick: act(() => actions.settings()) }, this.icon(ICONS.gear), 'Settings'),
    );
    this.gameover = h('div', { class: 'gameover' }, this.goTitle, this.goResult, this.goDetail,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: act(() => actions.rematch()) }, 'Rematch'),
        h('button', { class: 'btn', onclick: act(() => actions.lobby()) }, 'Return to Lobby')));
    this.root = h('div', { class: 'screen hud' }, this.me.el, this.them.el, this.controls, this.toastEl, this.gameover);
    this.root.style.pointerEvents = 'none';
    for (const el of [this.controls, this.gameover]) el.style.pointerEvents = 'auto';
    parent.append(this.root);
  }

  private icon(svg: string) { const s = h('span', { html: svg }); s.style.display = 'contents'; return s; }

  private plate(side: 'me' | 'them') {
    const avatar = h('canvas', { class: 'avatar', width: 104, height: 104 });
    const name = h('div', { class: 'name' });
    const rating = h('div', { class: 'rating' });
    const clock = h('div', { class: 'clock' }, '05:00');
    const status = h('div', { class: 'status' });
    const el = h('div', { class: `plate ${side}` },
      h('div', { class: 'id panel' }, avatar, h('div', {}, name, rating)), clock, status);
    return { el, avatar, name, rating, clock, status };
  }

  show(v: boolean) { this.root.classList.toggle('hidden', !v); }

  setPlayers(state: SessionState, myColor: Color) {
    const first = !this.state || this.state.id !== state.id;
    this.state = state;
    this.myColor = myColor;
    const mine = myColor === 'w' ? state.white : state.black;
    const theirs = myColor === 'w' ? state.black : state.white;
    this.me.name.textContent = mine?.username ?? '—';
    this.me.rating.innerHTML = ICONS.rating + `<span>${mine?.rating ?? ''}</span>`;
    this.them.name.textContent = theirs?.username ?? 'Waiting…';
    this.them.rating.innerHTML = ICONS.rating + `<span>${theirs?.rating ?? ''}</span>`;
    if (first) {
      drawPortrait(this.me.avatar, 'patient', 3);
      drawPortrait(this.them.avatar, theirs?.id === 'ai' ? 'masked' : 'unknown', 9);
    }
    this.them.status.textContent = state.opponentDisconnected ? 'Disconnected' : '';
  }

  setStatus(text: string) { this.me.status.textContent = text; }

  /** Per-frame clock refresh; returns true when a whole second ticked on the running clock. */
  tickClocks(now: number): boolean {
    const s = this.state;
    if (!s) return false;
    let ticked = false;
    for (const c of ['w', 'b'] as Color[]) {
      const ms = clockAt(s, c, now);
      const el = c === this.myColor ? this.me.clock : this.them.clock;
      const txt = formatClock(ms);
      if (el.textContent !== txt) el.textContent = txt;
      el.classList.toggle('active', s.running === c);
      el.classList.toggle('low', ms < 30_000);
      const sec = Math.ceil(ms / 1000);
      if (s.running === c && sec !== this.lastSecond[c]) { ticked = this.lastSecond[c] !== -1 && ms < 10_000; this.lastSecond[c] = sec; }
    }
    return ticked;
  }

  askPromotion(color: Color): Promise<Promotion | null> {
    return new Promise((resolve) => {
      this.closePrompt();
      const done = (p: Promotion | null) => { this.closePrompt(); resolve(p); };
      const box = h('div', { class: 'promo panel', role: 'dialog', 'aria-label': 'Choose a promotion piece' },
        h('div', { class: 'label' }, 'Choose a piece:'),
        h('div', { class: 'choices' }, ...(['q', 'r', 'b', 'n'] as const).map((p) =>
          h('button', { 'aria-label': { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[p], html: PIECE_ICONS[p], onclick: () => { this.actions.click(); done(p); } }))),
        h('button', { class: 'btn ghost', onclick: () => done(null) }, 'Cancel'));
      (box.querySelector('.btn') as HTMLElement).style.cssText = 'height:28px;margin-top:10px;font-size:12px;width:100%';
      box.style.color = color === 'w' ? '#e6dcc2' : '#8a7a68';
      this.promptEl = box;
      this.root.append(box);
      (box.querySelector('button') as HTMLButtonElement).focus();
    });
  }

  showDrawOffer(onAccept: () => void, onDecline: () => void) {
    this.closePrompt();
    const box = h('div', { class: 'prompt panel' }, 'Your opponent offers a draw.',
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { this.closePrompt(); onAccept(); } }, 'Accept'),
        h('button', { class: 'btn ghost', onclick: () => { this.closePrompt(); onDecline(); } }, 'Decline')));
    this.promptEl = box;
    this.root.append(box);
  }

  private confirmResign() {
    this.closePrompt();
    const box = h('div', { class: 'prompt panel' }, 'Resign this game?',
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { this.closePrompt(); this.actions.resign(); } }, 'Resign'),
        h('button', { class: 'btn ghost', onclick: () => this.closePrompt() }, 'Keep playing')));
    this.promptEl = box;
    this.root.append(box);
  }

  private closePrompt() { this.promptEl?.remove(); this.promptEl = null; }

  showGameOver(title: string, result: string, detail: string) {
    this.closePrompt();
    this.goTitle.textContent = title;
    this.goTitle.classList.toggle('draw', result === 'Draw');
    this.goResult.textContent = result;
    this.goDetail.textContent = detail;
    this.gameover.classList.remove('hidden');
    requestAnimationFrame(() => this.gameover.classList.add('show'));
  }

  hideGameOver() {
    this.gameover.classList.remove('show');
    this.closePrompt();
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2600);
  }
}
