# Earnora — Micro-Task, Gig & Affiliate Platform

Production-oriented reference implementation of the architecture blueprint:
NestJS modular monolith with an **idempotent double-effect ledger**, **admin-approved
paid task-access plans** (Beginner ₦3,000 / Intermediate ₦6,500 / Extreme ₦10,500 —
they gate the task feed and withdrawals), **flat plan-rate referral bonuses**,
**controlled withdrawal windows** with an async payout batcher, and **bot/fraud
guardrails** (device-fingerprint mesh, IP /24 farm flags, proof-of-work claim gating,
dwell-time + duplicate-proof checks).

Runs with **zero external infrastructure** out of the box (embedded Postgres via PGlite
+ in-process cache), and switches to real PostgreSQL/Redis/Kafka-style relays purely
via env vars — the module boundaries match the blueprint's microservice seams.

## Plans (the product model)

| Plan | Price (one-time, no expiry) | Tasks/day | Per task | Per referral who joins |
|---|---|---|---|---|
| Beginner | ₦3,000 | 3 | ₦200 | ₦200 |
| Intermediate | ₦6,500 | 6 | ₦300 | ₦400 |
| Extreme | ₦10,500 | 10 | ₦400 | ₦600 |

- Source of truth: `src/plans/plans.ts` (API) + `web/lib/plans.ts` (UI), catalog at `GET /plans`.
- Purchasing a plan settles through `/payments/initialize` (manual bank transfer,
  recorded as confirmed) + **admin approval** (`POST /admin/payments/:ref/approve`);
  approval assigns `users.plan`, flips status to `active`, and funds the flat
  referral bonus. Self-attested payments grant nothing until the owner verifies
  the money landed — the PSP webhook only runs when `PSP_MODE` is a real provider.
- Daily task quotas reset at midnight Africa/Lagos; per-task payout is the claimer's
  **plan rate**, not the task's listed reward (advertiser budgets must cover ₦400 × quota).
- Referral bonus: paid on the referred user's plan purchase to their **direct referrer**,
  at the **referrer's own plan rate** (no plan → no bonus). One plan per account.
- Withdrawals require a plan; minimum **₦15,000** (`MIN_WITHDRAWAL_KOBO`).

## Quick start

```bash
npm install
cd web && npm install && cd ..     # one-time

npm run dev      # starts BOTH servers and keeps them alive:
                 #   API → http://localhost:3000  (auto-restarts if it dies)
                 #   Web → http://localhost:3001  (phone: http://<your-IP>:3001)
npm test         # unit + integration tests (in-memory Postgres)
```

Production build of both:

```bash
npm run build && npm start           # API on :3000
cd web && npm run build && npm start # Web on :3001
```

(In production run each under a process manager, e.g. `pm2 start npm --name api -- run start:prod`
and `pm2 start npm --name web -- start` inside `web/`, with `pm2 save` — same auto-restart
behaviour as `npm run dev`.)

### Frontend (`web/` — Next.js 15 + React 19, zero extra deps)

| Route | What it does |
|---|---|
| `/login` | Login / register (prefills referral code from `?ref=` links) |
| `/dashboard` | Balance hero + plan status, quick actions, stats, **plan pricing cards** (Buy → deposit popup with Opay account) |
| `/tasks` | Task feed — **mines the proof-of-work challenge in the browser** (WebCrypto), daily-quota meter, claim → dynamic proof form driven by each task's `validation_rules`; locked until a plan is bought |
| `/wallet` | Balance cards, live withdrawal-window indicator, withdraw form (min ₦15,000), full ledger statement; plan banner when locked |
| `/referrals` | Copyable referral link, per-plan bonus rates, network table with each referral's plan |
| `/admin` | Review queue (approve/reject with reason), payout queue, fraud flags, **support inbox** (answer the chatbot's escalations — replies drop back into the user's chat), publish-task form — visible only to `role=admin` |

- Talks to the API **same-origin**: the browser only ever calls `/api/*` on the
  page's own host (PC, phone or production domain) and the Next server proxies
  it to the API (`next.config.mjs` → `API_PROXY_ORIGIN`, default
  `http://localhost:3000`). No CORS, no second port, no wrong-host failures —
  a phone at `http://192.168.x.x:3001` works out of the box. Network blips are
  retried with backoff and surfaced as a clear message, never a raw browser
  error. (`NEXT_PUBLIC_API_URL` set to a non-localhost origin still wins, as an
  escape hatch for split-host deployments.)
- JWTs in `localStorage` with automatic silent refresh on 401.
- Floating **support chat** (FAQ quick-replies + keyword bot): anything the bot
  cannot answer is escalated to `POST /support/messages`, the owner replies from
  the admin Support tab, and the answer is pulled back into the thread
  (`GET /support/messages`, on open + every 25s while open). The bot only ever
  promises a human reply it can actually deliver.
- Light blue-gradient mobile-app theme (Plus Jakarta Sans + Work Sans), no CSS
  framework — one stylesheet (`web/app/globals.css`).

Optional real infra:

```bash
docker compose up -d
# .env → DATABASE_URL=postgres://earnora:earnora@localhost:5432/earnora
#        REDIS_URL=redis://localhost:6379
```

Copy `.env.example` → `.env` to tune windows, fees, fraud limits.

## Demo walkthrough (curl)

```bash
BASE=http://localhost:3000

# 1. referrer registers → save accessToken
ALICE_TOKEN=$(curl -s -X POST $BASE/auth/register -H 'content-type: application/json' \
  -d '{"email":"alice@x.com","password":"password123"}' | jq -r .tokens.accessToken)

# alice shares her referral code
ALICE_CODE=$(curl -s $BASE/referrals -H "authorization: Bearer $ALICE_TOKEN" | jq -r .referralCode)

# 2. referred user registers with alice's code
BOB_TOKEN=$(curl -s -X POST $BASE/auth/register -H 'content-type: application/json' \
  -d "{\"email\":\"bob@x.com\",\"password\":\"password123\",\"referralCode\":\"$ALICE_CODE\"}" \
  | jq -r .tokens.accessToken)

# 3. alice buys her plan first (her plan sets her referral rate).
#    Manual bank-transfer flow: the payment is recorded as confirmed but grants
#    NOTHING until the admin approves it (authorizationUrl is null — there is
#    no external checkout page; /payments/simulate no longer exists).
curl -s -X POST $BASE/payments/initialize -H "authorization: Bearer $ALICE_TOKEN" -H 'content-type: application/json' \
  -d '{"planKey":"beginner"}'
#    → { "reference": "EARN_...", "authorizationUrl": null, "mode": "simulated" }

# 3b. the owner verifies the transfer and releases it (role=admin required)
ADMIN_TOKEN=$(curl -s -X POST $BASE/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@earnora.local","password":"<ADMIN_PASSWORD>"}' | jq -r .tokens.accessToken)
curl -s -X POST $BASE/admin/payments/EARN_yyyy/approve -H "authorization: Bearer $ADMIN_TOKEN"
#    (reject with: .../reject and a JSON body of {"reason":"..."})

# 4. bob buys a plan → same manual flow: initialize, then admin approval
#    settles it ONCE: bob's plan assigned + alice credited the FLAT ₦200 bonus
curl -s -X POST $BASE/payments/initialize -H "authorization: Bearer $BOB_TOKEN" -H 'content-type: application/json' \
  -d '{"planKey":"beginner"}'
curl -s -X POST $BASE/admin/payments/EARN_xxxx/approve -H "authorization: Bearer $ADMIN_TOKEN"
#    (GET /tasks returns 403 until a plan exists; GET /plans lists the catalog)

# 5. bob claims a task (proof-of-work challenge required; daily quota applies)
curl -s "$BASE/tasks/challenge"                      # { challenge, bits }
curl -s -X POST $BASE/tasks/<TASK_ID>/claim \
  -H "authorization: Bearer $BOB_TOKEN" \
  -H 'x-pow-challenge: <challenge>' -H 'x-pow-nonce: <mined-nonce>'

# 6. submit proof (server enforces min dwell time + duplicate-proof detection)
curl -s -X POST $BASE/tasks/<TASK_ID>/submit -H "authorization: Bearer $BOB_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"payload":{"q1":"yes","q2":"weekly","age":"25","__comment":"long enough answer"}}'

# 7. wallet + withdrawal (plan-gated, window-gated; min ₦15,000 = 1500000 kobo)
curl -s $BASE/wallet -H "authorization: Bearer $BOB_TOKEN"
curl -s $BASE/withdrawals/window
curl -s -X POST $BASE/withdrawals -H "authorization: Bearer $BOB_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"amountKobo":1500000,"bankCode":"058","accountNumber":"0123456789"}'
curl -s $BASE/withdrawals -H "authorization: Bearer $BOB_TOKEN"
```

Admin (`admin@earnora.local`, password from `ADMIN_PASSWORD` — dev default
`Admin123!`; production refuses to boot until you set a strong one, and setting
`ADMIN_PASSWORD` re-hashes the stored login on the next boot):

```bash
curl -s $BASE/admin/submissions -H "authorization: Bearer $ADMIN_TOKEN"
curl -s -X POST $BASE/admin/submissions/12/approve -H "authorization: Bearer $ADMIN_TOKEN"
curl -s $BASE/admin/withdrawals/queue -H "authorization: Bearer $ADMIN_TOKEN"
```

## Architecture map (blueprint → code)

| Blueprint component | Implementation |
|---|---|
| API Gateway (rate limit, auth) | `AuthGuard` (JWT) + `PowService` + velocity checks in `fraud/fraud.ts` — swap for Kong/Cloudflare at the edge |
| User Service | `auth/`, `users/` |
| Task & Gigs Service | `tasks/tasks.service.ts` — **plan-gated** feed, daily quota per plan, plan-rate reward snapshot, dwell/proof rules, auto + admin validation |
| Wallet & Ledger Service | `wallet/ledger.ts` — **the only writer of money**; idempotency-keyed `transactions` envelopes, append-only `ledger_entries`, CHECK-constrained balances |
| Event Broker | `common/events.ts` — transactional **outbox** + relay → in-process `EventBus` (Kafka-shaped contract: topic + payload) |
| Referral Service | `referrals/referrals.service.ts` — flat bonus on plan purchase at the referrer's plan rate, idempotent credit + ledger envelope, platform clearing account |
| Plans | `plans/plans.ts` — pricing, daily quotas, plan rewards & referral rates; `GET /plans` catalog |
| Payments | `payments/` - plan checkout init, **manual approval gate** (confirmed → `approval=pending` → admin releases), HMAC-SHA512 webhook verify (real PSP modes only), `webhook_events` dedupe, plan assignment |
| Withdrawals | `withdrawals/` — window gate (`common/time.ts`), reserve-in-tx, `SKIP LOCKED` batcher with retry/reversal |
| Support inbox | `support/` — chatbot escalations (`support_messages`), admin reply at `POST /admin/support/:id/reply`, delivered back into the chat thread; 10/user/hour rate window |
| Fraud prevention | device fingerprint mesh + IP /24 flags, PoW claim challenges, min dwell, duplicate proof hashes, trust-score review routing |
| Primary DB | PostgreSQL (schema in `migrations/001_init.sql`), embedded PGlite locally |
| Cache | Redis via `REDIS_URL`, TTL map fallback (locks, velocity counters, proofs) |

## Money-safety invariants

1. **Idempotency everywhere** — every movement sits behind a unique
   `transactions.idempotency_key` (`pay:`, `commission:`, `reward:`, `wd:` prefixes);
   replays collapse to one effect (proved in `test/integration.spec.ts`).
2. **Single writer** — only `wallet/ledger.ts` touches balances, always inside the
   caller's transaction.
3. **Append-only ledger** — `ledger_entries` never updates; `balance_after` snapshots
   power statements.
4. **Solvency via constraints** — `CHECK (available_kobo >= 0)` turns overdrafts into
   transaction rollbacks, not drift.
5. **Outbox atomicity** — events are written in the same transaction as state, so
   nothing is emitted for rolled-back work.

## Scaling path (phase 2+)

- Extract `wallet/ledger.ts` behind an internal gRPC/HTTP API (module boundary already
  enforces single-writer discipline).
- Point `OutboxRelay` at Kafka and add consumer groups per worker pool.
- Split DBs per bounded context; add read replicas for `GET /tasks`.
- Autoscale `PayoutBatcher` + relay on queue lag (KEDA), not CPU.
- Push window flags/rate limits to edge (Cloudflare) to shed the 17:00 spike before
  it reaches the app.

## Operational notes

- `GET /health` — db/cache probes.
- `GET /plans` — public plan catalog + current min withdrawal.
- Withdrawal windows: `WITHDRAWAL_WINDOW=17:00-19:00`, `WITHDRAWAL_TZ=Africa/Lagos`.
- Minimum withdrawal: `MIN_WITHDRAWAL_KOBO` (default `1500000` = ₦15,000).
- Failed transfers retry up to `WITHDRAWAL_MAX_ATTEMPTS`, then auto-reverse to the user
  with a ledger entry (`withdrawal_reversal`).
- Simulated bank failures: any account number starting with `99`.
- Schema: `migrations/001_init.sql` (core) + `migrations/002_plans.sql` (plan columns).
