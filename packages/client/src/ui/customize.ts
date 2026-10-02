import type { Cosmetics } from '@hc/shared';
import { h } from './dom';

type Cat = keyof Cosmetics;
const OPTIONS: Record<Cat, [string, string][]> = {
  hands: [['bare', 'Bare'], ['dirty', 'Dirty'], ['scarred', 'Scarred'], ['tattooed', 'Tattooed']],
  gloves: [['none', 'No Gloves'], ['leather', 'Leather Gloves'], ['worn', 'Worn Gloves']],
  sleeves: [['none', 'Bare Arms'], ['institutional', 'Institutional Sleeves'], ['jacket', 'Work Jacket'], ['rolled', 'Rolled Sleeves']],
  accessories: [['none', 'None'], ['watch', 'Watch'], ['strap', 'Leather Strap'], ['bandage', 'Bandage']],
};
const TAB_LABEL: Record<Cat, string> = { hands: 'Hands', gloves: 'Gloves', sleeves: 'Sleeves', accessories: 'Accessories' };

export interface CustomizeActions {
  select(c: Cosmetics): void;
  /** Render (or fetch cached) preview image for these cosmetics. */
  preview(c: Cosmetics): Promise<string>;
  back(): void;
  click(): void;
}

/** Hand customization: tabs + preview cards. Selection updates the real first-person hands. */
export class Customize {
  readonly root: HTMLDivElement;
  private tab: Cat = 'hands';
  private tabs = new Map<Cat, HTMLButtonElement>();
  private grid = h('div', { class: 'grid' });
  private current!: Cosmetics;
  private gen = 0;

  constructor(parent: HTMLElement, private actions: CustomizeActions) {
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    for (const c of Object.keys(OPTIONS) as Cat[]) {
      const b = h('button', { class: 'tab', role: 'tab', onclick: () => { actions.click(); this.setTab(c); } }, TAB_LABEL[c]);
      this.tabs.set(c, b);
      tabs.append(b);
    }
    this.root = h('div', { class: 'screen' },
      h('div', { class: 'side panel' },
        h('h2', { class: 'screen-title' }, 'Hand Customization'),
        tabs, this.grid,
        h('div', { class: 'footer' }, h('button', { class: 'btn', onclick: () => { actions.click(); actions.back(); } }, 'Done'))));
    parent.append(this.root);
  }

  show(v: boolean, c?: Cosmetics) {
    this.root.classList.toggle('hidden', !v);
    if (v && c) { this.current = { ...c }; this.setTab(this.tab); }
  }

  private setTab(c: Cat) {
    this.tab = c;
    for (const [k, b] of this.tabs) { b.classList.toggle('sel', k === c); b.setAttribute('aria-selected', String(k === c)); }
    this.render();
  }

  private render() {
    const gen = ++this.gen;
    this.grid.replaceChildren();
    for (const [val, label] of OPTIONS[this.tab]) {
      const cos = { ...this.current, [this.tab]: val } as Cosmetics;
      const ph = h('div', { class: 'ph' });
      const card = h('button', { class: 'card' + ((this.current[this.tab] as string) === val ? ' sel' : ''), onclick: () => {
        this.actions.click();
        this.current = cos;
        this.actions.select(cos);
        this.render();
      } }, ph, h('div', { class: 'nm' }, label));
      this.grid.append(card);
      void this.actions.preview(cos).then((url) => {
        if (gen !== this.gen) return;
        const img = h('img', { src: url, alt: label });
        ph.replaceWith(img);
      });
    }
  }
}
