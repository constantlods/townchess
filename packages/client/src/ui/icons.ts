/** Original line icons (stroke-based, slightly irregular to suit the aged UI). */
const svg = (body: string, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  handshake: svg('<path d="M2.5 11.5l3.2-3.4 3.6 1.1 2.7-1.6 4.2.4 5.3 3.6"/><path d="M5.6 8.2l-3.1 3.4 4.9 5.2"/><path d="M21.5 11.5l-4.6 5.1"/><path d="M9.2 12.6l2.4 2.3c.6.6 1.5.6 2 0 .5-.5.5-1.3 0-1.8"/><path d="M11 16.4l1.2 1.1c.6.5 1.4.5 1.9-.1.5-.5.4-1.3-.1-1.8"/><path d="M8.3 15.1l1.6 1.5"/><path d="M12.5 9.7l3.6 3.4c.5.5 1.3.5 1.8 0 .5-.5.5-1.3 0-1.8"/>'),
  flag: svg('<path d="M5 21V3.5"/><path d="M5 4.2c3.2-1.4 5.6 1.6 8.6.4 1.7-.7 3.1-.8 4.9-.3v8.4c-1.8-.5-3.2-.4-4.9.3-3 1.2-5.4-1.8-8.6-.4"/>'),
  gear: svg('<circle cx="12" cy="12" r="3.1"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.4"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h11"/>'),
  rating: svg('<path d="M12 3v18"/><path d="M8 7c0-2 8-2 8 0s-8 2-8 4 8 2 8 4-8 2-8 0"/>'),
  hand: svg('<path d="M7 13V6.5a1.5 1.5 0 013 0V12"/><path d="M10 11V4.5a1.5 1.5 0 013 0V11"/><path d="M13 11V5.5a1.5 1.5 0 013 0V12"/><path d="M16 12V8.5a1.5 1.5 0 013 0V14c0 4-3 7-7 7-2.6 0-4.3-1.2-5.6-3.3L4 13.4a1.4 1.4 0 012.3-1.5L7 13"/>'),
  room: svg('<path d="M3 20h18M5 20V6l7-3 7 3v14"/><path d="M9 20v-6h6v6"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
};

/** Promotion piece glyphs (original silhouettes, filled). */
const pg = (d: string) => `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg>`;
export const PIECE_ICONS: Record<'q' | 'r' | 'b' | 'n', string> = {
  q: pg('M8 33h24v3H8zM10 31l-3-17 6.5 7 3-11 3.5 9 3.5-9 3 11 6.5-7-3 17zM7 12.5a2 2 0 110-.1zM13.5 8a2 2 0 110-.1zM20 6a2 2 0 110-.1zM26.5 8a2 2 0 110-.1zM33 12.5a2 2 0 110-.1z'),
  r: pg('M9 33h22v3H9zM12 31l1.5-14h13L28 31zM11 15V8h4v3h3V8h4v3h3V8h4v7z'),
  b: pg('M9 33h22v3H9zM13 31c1-4 3-7 3-10h8c0 3 2 6 3 10zM20 20c-5-1-6-5-4-9 1-2 3-4 4-5 1 1 3 3 4 5l-4 4 1 1 3.6-3.2c1 3.4-.6 6.6-4.6 7.2zM20 4.5a1.8 1.8 0 110-.1z'),
  n: pg('M10 33h22v3H10zM12 31c0-6 4-8 6-11-3 1-5 2-7 1l-1-3c2-2 3-5 6-8 1-2 1-4 1-5 2 1 3 2 4 3 6 1 10 7 10 15v8z'),
};
