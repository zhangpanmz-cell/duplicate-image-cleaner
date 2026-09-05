// Inline worker is intentional: production JS is hosted on Miaoda's CDN, so a
// direct cross-origin Worker URL would be rejected. No external script or upload.
import HashWorker from './sha256.worker?worker&inline';
import { createHashPool } from './sha256-pool';

export const createBrowserHashService = () => createHashPool(() => new HashWorker(), 4);
