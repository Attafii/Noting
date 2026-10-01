import fs from 'node:fs';
import path from 'node:path';

/**
 * Smoke-test credentials without any ceremony: `npm run test:smoke` works out
 * of the box on this machine because .env.local (gitignored) already carries
 * the workspace token as OWNER_TOKEN and the security answer as SMOKE_NTA.
 * CI or another machine can instead export SMOKE_NTK / SMOKE_NTA directly —
 * real environment variables always win.
 */
const envFile = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

export const SMOKE_TOKEN = process.env.SMOKE_NTK ?? process.env.OWNER_TOKEN ?? '';
export const SMOKE_ANSWER = process.env.SMOKE_NTA ?? '';

if (!SMOKE_TOKEN || !SMOKE_ANSWER) {
  throw new Error(
    'Smoke credentials missing — set SMOKE_NTK and SMOKE_NTA (or keep OWNER_TOKEN + SMOKE_NTA in .env.local)',
  );
}
