import '@fontsource/courier-prime/400.css';
import '@fontsource/courier-prime/700.css';
import '@fontsource/ibm-plex-sans-condensed/400.css';
import '@fontsource/ibm-plex-sans-condensed/500.css';
import './ui/styles.css';
import { App } from './app';

const app = new App(new URLSearchParams(location.search));
app.boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('ui')!;
  el.innerHTML = `<div class="loading"><div class="inner"><div class="t">THE ROOM COULD NOT BE PREPARED</div><div class="s">${String(e).replace(/</g, '&lt;')}</div></div></div>`;
});
