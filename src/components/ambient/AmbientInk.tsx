import { lazy } from 'react';

/**
 * Lazy handle for the ink-and-ember shader. Every screen that shows it
 * (welcome, unlock, invite) imports THIS — the WebGL module lands in its
 * own async chunk and never ships in the workspace's main bundle.
 */
export const AmbientInk = lazy(() => import('./InkField').then((m) => ({ default: m.InkField })));
