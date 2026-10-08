import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import serverlessHttp from 'serverless-http';
import { AppModule } from './app.module';
import { assertSecureConfig } from './config';
import { OutboxRelay } from './common/events';
import { TasksService } from './tasks/tasks.service';
import { TasksWorker } from './tasks/tasks.worker';
import { PayoutBatcher } from './withdrawals/payout.batcher';

/**
 * Serverless entry for the whole API.
 *
 * On Vercel the Next.js route handler `web/app/api/[...path]/route.js` calls
 * `handleWebRequest`, which runs the Nest app IN-PROCESS (via serverless-http
 * wrapping the Express instance) — the browser still only talks to /api/* on
 * its own origin.
 *
 * Off Vercel (local `npm run dev` / `next start`) the same route handler
 * forwards to the standalone API process (API_PROXY_ORIGIN, default
 * :3000), so local development keeps the existing two-process workflow and
 * never opens a second embedded database.
 */

type LambdaResult = {
  statusCode: number;
  headers?: Record<string, string | string[]>;
  body?: string;
  isBase64Encoded?: boolean;
  cookies?: string[];
};

interface Runtime {
  nest: NestExpressApplication;
  handler: (event: object, context: object) => Promise<LambdaResult>;
}

let runtimePromise: Promise<Runtime> | null = null;

/** Builds (once per cold start) the Nest app wired into an Express instance. */
async function createRuntime(): Promise<Runtime> {
  // Production refuses dev secrets — same guard as main.ts (may process.exit).
  assertSecureConfig();

  const adapter = new ExpressAdapter();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, adapter, { rawBody: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.enableCors({
    origin: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'x-pow-challenge', 'x-pow-nonce', 'x-device-fingerprint'],
  });
  const instance = app.getHttpAdapter().getInstance();
  instance.set?.('trust proxy', true); // honour X-Forwarded-For from the gateway
  await app.init(); // runs migrations + admin bootstrap

  const handler = serverlessHttp(instance, { binary: ['image/*'] }) as unknown as Runtime['handler'];
  return { nest: app, handler };
}

function getRuntime(): Promise<Runtime> {
  if (!runtimePromise) {
    runtimePromise = createRuntime().catch((err) => {
      runtimePromise = null; // a failed boot must not poison the instance forever
      throw err;
    });
  }
  return runtimePromise;
}

/** Strip the route prefix the browser used (/api) — the API itself is prefix-less. */
function stripBase(url: string, base: string): string {
  if (url === base) return '/';
  if (url.startsWith(base + '/') || url.startsWith(base + '?')) return url.slice(base.length) || '/';
  return url;
}

/** Next Request → AWS HTTP API v2 event (the shape serverless-http understands). */
async function toEvent(req: Request, targetPath: string): Promise<object> {
  const qIdx = targetPath.indexOf('?');
  const rawPath = qIdx === -1 ? targetPath : targetPath.slice(0, qIdx);
  const rawQueryString = qIdx === -1 ? '' : targetPath.slice(qIdx + 1);

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const buf = Buffer.from(await req.arrayBuffer());
  const fwd = (headers['x-forwarded-for'] ?? '').split(',')[0].trim();

  return {
    version: '2.0',
    rawPath,
    rawQueryString,
    headers,
    requestContext: {
      accountId: '123456789012',
      apiId: 'earnora',
      domainName: headers['host'] ?? 'localhost',
      requestId: randomUUID(),
      routeKey: '$default',
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
      http: {
        method: req.method,
        path: rawPath,
        protocol: 'HTTP/1.1',
        sourceIp: headers['x-real-ip'] || fwd || '127.0.0.1',
        userAgent: headers['user-agent'] ?? '',
      },
    },
    body: buf.length > 0 ? buf.toString('base64') : '',
    isBase64Encoded: true,
  };
}

async function invokeNest(req: Request, targetPath: string): Promise<Response> {
  const { handler } = await getRuntime();
  const event = await toEvent(req, targetPath);
  const result = (await handler(event, { getRemainingTimeInMillis: () => 60_000 })) as LambdaResult;

  const status = result?.statusCode ?? 500;
  const headers = new Headers();
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    if (value === undefined) continue;
    const k = key.toLowerCase();
    if (k === 'transfer-encoding' || k === 'content-length') continue; // recomputed by fetch
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else headers.set(key, value);
  }
  for (const cookie of result.cookies ?? []) headers.append('set-cookie', cookie);

  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status, headers });
  }
  const body = result.isBase64Encoded
    ? Buffer.from(result.body ?? '', 'base64')
    : Buffer.from(result.body ?? '', 'utf8');
  return new Response(body, { status, headers });
}

/** Local dev: forward to the standalone API process (what the Next rewrite used to do). */
async function proxyToApi(req: Request, targetPath: string): Promise<Response> {
  const origin = (process.env.API_PROXY_ORIGIN || 'http://localhost:3000').replace(/\/+$/, '');
  const headers = new Headers(req.headers);
  headers.delete('host');
  const method = req.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await req.arrayBuffer();

  const upstream = await fetch(origin + targetPath, { method, headers, body, redirect: 'manual' });
  const out = new Headers(upstream.headers);
  // fetch transparently decompresses — never forward the original encoding/length
  out.delete('content-encoding');
  out.delete('content-length');
  out.delete('transfer-encoding');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

const PROOF_RE = /^\/uploads\/proofs\/([a-f0-9]{64}\.(?:png|jpg|webp|gif))(\?.*)?$/;

/** Proof screenshots are served straight from the DB (content-addressed bytes). */
async function serveProof(file: string): Promise<Response> {
  const { nest } = await getRuntime();
  const shot = await nest.get(TasksService, { strict: false }).getProof(file);
  if (!shot) return Response.json({ statusCode: 404, message: 'Proof not found' }, { status: 404 });
  const bytes = shot.buffer;
  return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
    headers: {
      'content-type': shot.contentType,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}

/** One pass of the background workers (outbox relay, payouts, task janitor). */
export async function runTick(): Promise<object> {
  const { nest } = await getRuntime();
  await nest.get(OutboxRelay, { strict: false }).drain();
  await nest.get(PayoutBatcher, { strict: false }).tick();
  await nest.get(TasksWorker, { strict: false }).tick();
  return { ok: true, at: new Date().toISOString() };
}

let lastPiggyback = 0;

/**
 * Throttled background drain invoked after responses (Next `after`), so queue
 * work progresses even if the cron trigger is unavailable. SKIP LOCKED +
 * claim-on-update keep it safe from any instance at any cadence.
 */
export async function maybeTick(): Promise<void> {
  if (!process.env.VERCEL) return; // local/long-running process has real timers
  const now = Date.now();
  if (now - lastPiggyback < 45_000) return;
  lastPiggyback = now;
  try {
    await runTick();
  } catch (err) {
    console.error('[tick] background pass failed:', (err as Error).message);
  }
}

/**
 * GET /api/cron/tick — safety-net drain. Vercel Cron (daily on the Hobby plan;
 * the per-request piggyback in maybeTick is the real cadence). Also usable by
 * an external pinger: pass the secret as `?secret=…` or `Authorization: Bearer …`.
 */
async function cronTick(req: Request, target: string): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const url = new URL(target, 'http://local');
  const supplied = req.headers.get('authorization') === `Bearer ${secret}`
    ? secret
    : url.searchParams.get('secret');
  if (!secret || supplied !== secret) {
    return Response.json({ ok: false, error: secret ? 'unauthorized' : 'cron disabled' }, { status: secret ? 401 : 404 });
  }
  try {
    return Response.json(await runTick());
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

/**
 * Entry called by the Next route handler for every /api/* request.
 * @param basePath prefix the browser used ('/api')
 */
export async function handleWebRequest(req: Request, basePath: string): Promise<Response> {
  try {
    // A fetch Request's .url is always absolute (http://host/api/…) — normalize
    // to path + query before stripping the browser-visible prefix.
    const parsed = new URL(req.url);
    const target = stripBase(parsed.pathname + parsed.search, basePath);
    const pathname = target.split('?')[0];

    if (pathname === '/cron/tick') return await cronTick(req, target);

    const proof = PROOF_RE.exec(pathname);
    if (proof) {
      if (process.env.VERCEL) return await serveProof(proof[1]);
      return await proxyToApi(req, target); // local: the API serves it (disk/static)
    }

    return process.env.VERCEL ? await invokeNest(req, target) : await proxyToApi(req, target);
  } catch (err) {
    console.error('[api] request failed:', err);
    return Response.json({ statusCode: 500, message: 'Internal server error' }, { status: 500 });
  }
}
