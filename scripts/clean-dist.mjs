// Empties dist/ before a build, so a module deleted from src/ cannot linger in
// the published package.
import fs from 'node:fs';

fs.rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
