// Worker bootstrap: registers the tsx loader inside the worker thread (the server runs TypeScript via tsx in dev,
// tests and production), then loads the real worker. Kept as .mjs so Node can start it without any loader.
import { register } from 'tsx/esm/api';
register();
await import('./aiWorker.ts');
