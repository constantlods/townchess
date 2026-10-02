import { TIME_CONTROLS } from '@hc/shared';
import { h } from './dom';
import { ICONS } from './icons';
import { AI_LEVELS, type AiLevel } from '../game/aiClient';

export type PlayMode = 'casual' | 'rated' | 'private' | 'ai';

export interface LobbyActions {
  play(mode: PlayMode, tc: string, opts: { aiLevel: AiLevel; color: 'w' | 'b' | 'random'; joinCode?: string }): void;
  cancel(): void;
  customize(): void;
  environments(): void;
  settings(): void;
  click(): void;
}

/** "Find a game" — minimal, same visual language as the table. */
export class Lobby {
  readonly root: HTMLDivElement;
  private mode: PlayMode = 'ai';
  private optEls = new Map<PlayMode, HTMLButtonElement>();
  private tc: HTMLSelectElement;
  private sub = h('div', { class: 'sub' });
  private msg = h('div', { class: 'msg', 'aria-live': 'polite' });
  private findBtn: HTMLButtonElement;
  private aiLevel: AiLevel = 'patient';
  private color: 'w' | 'b' | 'random' = 'w';
  private joinInput = h('input', { type: 'text', placeholder: 'GAME-XXXXXX', maxlength: 11, 'aria-label': 'Game code' });
  searching = false;

  constructor(parent: HTMLElement, private actions: LobbyActions) {
    const opts: [PlayMode, string, string][] = [['casual', 'Casual', 'online'], ['rated', 'Rated', 'online · rating'], ['private', 'Private Match', 'invite code'], ['ai', 'Play vs AI', 'offline']];
    const list = h('div', { class: 'opts', role: 'radiogroup' });
    for (const [m, label, hint] of opts) {
      const b = h('button', { class: 'opt', role: 'radio', onclick: () => { actions.click(); this.setMode(m); } }, h('span', {}, label), h('span', { class: 'hint' }, hint));
      this.optEls.set(m, b);
      list.append(b);
    }
    this.tc = h('select', { 'aria-label': 'Time control' }, ...Object.keys(TIME_CONTROLS).map((k) => h('option', { value: k }, k.replace('+', ' + '))));
    this.tc.value = '5+0';
    this.findBtn = h('button', { class: 'btn primary find', onclick: () => this.onFind() }, 'Find Match');
    this.root = h('div', { class: 'screen' },
      h('div', { class: 'lobby panel' },
        h('div', { class: 'brand' }, 'HORROR · CHESS'),
        h('h2', { class: 'screen-title' }, 'Find a Game'),
        list, this.sub, this.findBtn,
        h('div', { class: 'tc' },
          h('button', { class: 'btn ghost gear', 'aria-label': 'Settings', html: ICONS.gear, onclick: () => { actions.click(); actions.settings(); } }),
          'Time Control', this.tc),
        this.msg,
        h('div', { class: 'links' },
          h('button', { class: 'btn ghost', onclick: () => { actions.click(); actions.customize(); } }, 'Hand Customization'),
          h('button', { class: 'btn ghost', onclick: () => { actions.click(); actions.environments(); } }, 'Board Environments'))));
    parent.append(this.root);
    this.setMode('ai');
  }

  show(v: boolean) { this.root.classList.toggle('hidden', !v); }

  setMode(m: PlayMode) {
    if (this.searching) return;
    this.mode = m;
    for (const [k, el] of this.optEls) { el.classList.toggle('sel', k === m); el.setAttribute('aria-checked', String(k === m)); }
    this.sub.replaceChildren();
    this.msg.textContent = '';
    if (m === 'ai') {
      const lvl = h('select', { 'aria-label': 'AI strength' }, ...(Object.keys(AI_LEVELS) as AiLevel[]).map((k) => h('option', { value: k }, `${AI_LEVELS[k].label} (${AI_LEVELS[k].rating})`)));
      lvl.value = this.aiLevel;
      lvl.onchange = () => { this.aiLevel = lvl.value as AiLevel; };
      const col = h('select', { 'aria-label': 'Your colour' }, h('option', { value: 'w' }, 'White'), h('option', { value: 'b' }, 'Black'), h('option', { value: 'random' }, 'Random'));
      col.value = this.color;
      col.onchange = () => { this.color = col.value as 'w' | 'b' | 'random'; };
      this.sub.append(h('div', { class: 'row' }, 'Opponent', lvl), h('div', { class: 'row' }, 'Play as', col));
      this.findBtn.textContent = 'Sit Down';
    } else if (m === 'private') {
      this.sub.append(h('div', {}, 'Create a table and share its code, or enter a code to join.'), h('div', { class: 'row' }, this.joinInput));
      this.findBtn.textContent = 'Create / Join';
    } else {
      this.sub.append(h('div', {}, m === 'rated' ? 'Paired by rating. Results change your rating.' : 'Paired with the next player waiting. No rating change.'));
      this.findBtn.textContent = 'Find Match';
    }
  }

  private onFind() {
    this.actions.click();
    if (this.searching) { this.actions.cancel(); return; }
    const code = this.joinInput.value.trim().toUpperCase();
    this.actions.play(this.mode, this.tc.value, { aiLevel: this.aiLevel, color: this.color, joinCode: this.mode === 'private' && code ? code : undefined });
  }

  setSearching(on: boolean, text = '') {
    this.searching = on;
    this.findBtn.textContent = on ? 'Cancel' : this.mode === 'ai' ? 'Sit Down' : this.mode === 'private' ? 'Create / Join' : 'Find Match';
    this.msg.textContent = text;
  }

  setMessage(html: string) { this.msg.innerHTML = html; }
}
