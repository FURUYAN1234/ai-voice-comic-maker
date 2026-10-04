import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Separate from Vite's public tree; Remotion receives this directory explicitly.
export const RUNTIME_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.runtime');
