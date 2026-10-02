import { h } from './dom';
import { ENVIRONMENTS, type EnvId } from '../scene/environment';

export interface EnvActions {
  select(id: EnvId): void;
  thumbnail(id: EnvId): Promise<string>;
  back(): void;
  click(): void;
}

/** Board environment selector: thumbnail, name, short description. */
export class EnvironmentPicker {
  readonly root: HTMLDivElement;
  private grid = h('div', { class: 'grid env' });
  private cards = new Map<EnvId, HTMLButtonElement>();
  private status = h('div', { class: 'msg', 'aria-live': 'polite' });

  constructor(parent: HTMLElement, private actions: EnvActions) {
    for (const e of ENVIRONMENTS) {
      const ph = h('div', { class: 'ph' });
      const card = h('button', { class: 'card', onclick: () => { actions.click(); actions.select(e.id); } }, ph, h('div', { class: 'nm' }, e.name), h('div', { class: 'ds' }, e.description));
      card.dataset.id = e.id;
      this.cards.set(e.id, card);
      this.grid.append(card);
    }
    this.root = h('div', { class: 'screen' },
      h('div', { class: 'side panel' },
        h('h2', { class: 'screen-title' }, 'Board Environments'),
        this.grid, this.status,
        h('div', { class: 'footer' }, h('button', { class: 'btn', onclick: () => { actions.click(); actions.back(); } }, 'Done'))));
    parent.append(this.root);
  }

  private loaded = false;
  show(v: boolean, current?: EnvId) {
    this.root.classList.toggle('hidden', !v);
    if (current) this.setCurrent(current);
    if (v && !this.loaded) {
      this.loaded = true;
      // sequential so thumbnails don't compete with the game for the workers
      (async () => {
        for (const e of ENVIRONMENTS) {
          const url = await this.actions.thumbnail(e.id);
          const card = this.cards.get(e.id)!;
          card.querySelector('.ph')?.replaceWith(h('img', { src: url, alt: e.name }));
        }
      })();
    }
  }

  setCurrent(id: EnvId) { for (const [k, c] of this.cards) c.classList.toggle('sel', k === id); }
  setStatus(t: string) { this.status.textContent = t; }
}
