import { h } from './dom';
import type { Settings } from '../settings';

export interface SettingsActions { change(s: Settings, key: keyof Settings): void; close(): void; click(): void }

/** Settings & accessibility. Every option is live (texture resolution applies on next launch). */
export class SettingsPanel {
  readonly root: HTMLDivElement;
  private body = h('div');
  constructor(parent: HTMLElement, private s: Settings, private actions: SettingsActions) {
    this.root = h('div', { class: 'screen', onclick: (e: Event) => { if (e.target === this.root) actions.close(); } },
      h('div', { class: 'settings panel', role: 'dialog', 'aria-label': 'Settings' },
        h('h2', { class: 'screen-title' }, 'Settings'), this.body,
        h('div', { class: 'row', style: 'margin-top:18px' }, h('button', { class: 'btn', onclick: () => { actions.click(); actions.close(); } }, 'Close'))));
    this.root.style.background = 'rgba(0,0,0,0.35)';
    parent.append(this.root);
    this.build();
  }

  private toggle(key: keyof Settings, label: string) {
    const inp = h('input', { type: 'checkbox' }) as HTMLInputElement;
    inp.checked = this.s[key] as boolean;
    inp.onchange = () => { (this.s[key] as boolean) = inp.checked; this.actions.change(this.s, key); };
    return h('label', {}, label, inp);
  }
  private slider(key: keyof Settings, label: string) {
    const inp = h('input', { type: 'range', min: 0, max: 1, step: 0.05 }) as HTMLInputElement;
    inp.value = String(this.s[key]);
    inp.oninput = () => { (this.s[key] as number) = Number(inp.value); this.actions.change(this.s, key); };
    return h('label', {}, label, inp);
  }
  private select(key: keyof Settings, label: string, opts: [string, string][]) {
    const sel = h('select', {}, ...opts.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
    sel.value = String(this.s[key]);
    sel.onchange = () => { (this.s as unknown as Record<string, string>)[key] = sel.value; this.actions.change(this.s, key); };
    return h('label', {}, label, sel);
  }

  private build() {
    const name = h('input', { type: 'text', maxlength: 20, value: this.s.username }) as HTMLInputElement;
    name.onchange = () => { const v = name.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 20); if (v.length >= 2) { this.s.username = v; this.actions.change(this.s, 'username'); } name.value = this.s.username; };
    this.body.append(
      h('h3', {}, 'Play'),
      h('label', {}, 'Name', name),
      this.select('animationMode', 'Move animation', [['cinematic', 'Cinematic (slow hands)'], ['standard', 'Standard'], ['competitive', 'Competitive (instant)']]),
      this.toggle('showMoveHints', 'Show legal move marks'),
      h('h3', {}, 'Accessibility'),
      this.toggle('reducedMotion', 'Reduced motion'),
      this.toggle('reducedCamera', 'Reduced camera movement'),
      this.toggle('reducedHorror', 'Reduced horror effects'),
      this.toggle('highContrastPieces', 'Increased piece contrast'),
      this.toggle('largerBoard', 'Larger board'),
      this.toggle('simplifiedEnvironment', 'Simplified environment'),
      h('h3', {}, 'Sound'),
      this.slider('sfxVolume', 'Sound effects'),
      this.slider('ambienceVolume', 'Ambience'),
      this.slider('musicVolume', 'Music'),
      h('h3', {}, 'Graphics'),
      this.select('quality', 'Quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]),
      this.toggle('depthOfField', 'Depth of field (high quality)'),
    );
  }

  show(v: boolean) { this.root.classList.toggle('hidden', !v); }
}
