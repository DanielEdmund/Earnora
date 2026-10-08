// The whole API surface for the deployed site: every /api/* request lands on
// this catch-all route handler.
//
//  - On Vercel: the NestJS app runs in-process (src/serverless.ts) so the
//    browser keeps talking same-origin /api/* — no CORS, no second host.
//  - Off Vercel (local `npm run dev` / `next start`): requests are forwarded
//    to the standalone API process (API_PROXY_ORIGIN, default :3000), which is
//    exactly what the next.config.mjs rewrite did before.
//
// Built from plain JS on purpose: the heavy lifting lives in ../dist
// (compiled by `nest build`), which sidesteps Next's compiler settings for
// Nest's decorators (emitDecoratorMetadata).
import { after } from 'next/server';
import { handleWebRequest, maybeTick } from '../../../../dist/serverless.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function handle(req) {
  // Background drain (outbox relay / payout batcher / task janitor) after the
  // response — throttled, no-op outside Vercel, idempotent everywhere.
  after(() => maybeTick());
  return handleWebRequest(req, '/api');
}

export function GET(req) {
  return handle(req);
}
export function HEAD(req) {
  return handle(req);
}
export function POST(req) {
  return handle(req);
}
export function PUT(req) {
  return handle(req);
}
export function PATCH(req) {
  return handle(req);
}
export function DELETE(req) {
  return handle(req);
}
export function OPTIONS(req) {
  return handle(req);
}
