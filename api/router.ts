import type { VercelRequest, VercelResponse } from '@vercel/node';
import ai from './_route-ai';
import ask from './_route-ask';
import challenge from './_route-challenge';
import documents from './_route-documents';
import download from './_route-download';
import folders from './_route-folders';
import health from './_route-health';
import hint from './_route-hint';
import note from './_route-note';
import notes from './_route-notes';
import revisions from './_route-revisions';
import tokenQuestion from './_route-token-question';
import tokens from './_route-tokens';
import upload from './_route-upload';
import usage from './_route-usage';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

/**
 * Single-function API router (Vercel Hobby plans allow max 12 Serverless
 * Functions per deployment; the app has 15 endpoints). Production rewrites
 * `/api/<name>` → `/api/router?route=<name>` (see vercel.json); local dev
 * resolves the `_route-*` modules directly via dev-api.ts.
 */
const ROUTES: Record<string, Handler> = {
  ai,
  ask,
  challenge,
  documents,
  download,
  folders,
  health,
  hint,
  note,
  notes,
  revisions,
  'token-question': tokenQuestion,
  tokens,
  upload,
  usage,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.route;
  const route = Array.isArray(raw) ? raw[0] : raw;
  const fn = (route && ROUTES[route]) || null;
  if (!fn) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await fn(req, res);
}
