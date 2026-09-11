# Tweet Voice Cloner

Give an X handle → get tweet drafts in that person's voice.

An end-to-end LLM product: multi-stage style analysis, provider-failover
generation with quality gates, moderation, shadow validation, durable
idempotency, and cost governance — all backed by tests and observable in
production.

Next.js 14 App Router · NextAuth v5 · Drizzle + Neon Postgres · Tailwind · vitest (103 tests) · zod

---

## System design overview

The codebase is a **modular monolith with a layered, ports-and-adapters
architecture**. Every dependency direction is deliberate:

```
Controller (src/app/api)      HTTP only: validation, auth, rate limits, responses.
   │                           No SQL, no business rules.
   ▼
Service (src/modules)         Business logic. Depends on repository INTERFACES,
   │                          never on a concrete driver.
   ▼
Repository (src/repositories) interfaces.ts (contracts) + drizzle.ts (only
   │                          place that builds queries) + index.ts (composition root).
   ▼
Postgres (Neon)               Typed via Drizzle schema; migrations tracked in _migrations.
```

**Why this matters (the interview answers):**

- **Testability without a database.** Services depend on interfaces, so the
  test suite swaps in an in-memory fake (`tests/helpers/fake-db.ts`) that
  implements Drizzle's query-builder surface — 103 tests run in <1s with zero
  network. Tests can never touch production data by accident because the
  vitest setup file strips `DATABASE_URL` and substitutes a canary.
- **Swappable vendors.** External services sit behind ports:
  `TweetSource` (implemented by `XApiTweetSource`, `MockTweetSource`, and a
  paste-parser fallback) and `LlmClient` (implemented by `OpenRouterClient`).
  Adding a provider means implementing one interface — no service code changes.
- **Controllers stay thin.** Every route handler does: authenticate → rate
  limit → validate (zod) → call one service → shape the response. That's it.
  This makes the HTTP layer reviewable in seconds and keeps business rules in
  one place.

### The four-layer request path (example: generate)

```
POST /api/generate
  → requireUser()            (session → users table backstop)
  → rateLimit()              (in-memory fixed window)
  → assertWithinBudget()     (FinOps gate: kill switch + per-user token caps)
  → generation-orchestrator  (service: job lifecycle, LLM router, shadow
   │                          validation, moderation, quality floor, persistence)
  → repositories             (generation jobs, drafts — typed, tested, swappable)
```

---

## Good decisions, and the reasoning behind each

### 1. Layered architecture with interface/implementation split

Every persistence touchpoint goes through a repository interface
(`src/repositories/interfaces.ts`): `UserRepository`, `VoiceProfileRepository`,
`TweetRepository`, `DraftRepository`, `GenerationJobRepository`,
`IdempotencyRepository`. The Drizzle implementations are the *only* code in the
repo that constructs queries.

Why it matters: the day Neon is replaced with anything else, services and
controllers are untouched. In the meantime, the test suite is the immediate
beneficiary — fast, hermetic, and impossible to pollute with prod writes.

### 2. Controller / Service / Repository separation

- `app/api/**/route.ts` — HTTP concerns exclusively
- `modules/**` — business logic (analysis, generation, moderation, FinOps)
- `repositories/**` — persistence

Cross-cutting utilities live framework-free in `lib/` (logger, rate limiter,
circuit breaker, metrics, env). Services never import Next.js.

### 3. Ports & adapters at every volatile boundary

- `TweetSource` port → `MockTweetSource` (fixture-backed), `XApiTweetSource`
  (live, with timeout/retry), paste-parser fallback
- `LlmClient` port → `OpenRouterClient`
- Cost-bearing paths are server-side-resolved: the client can never trigger
  live X API spend by sending a flag.

### 4. Deterministic-first LLM pipeline (PASS 1 + PASS 2)

Style analysis runs **deterministic factor modules first** (syntax, lexical,
topics, engagement, emoji format, tone — all pure functions, all unit-tested),
then optionally merges a single LLM refinement pass, re-validated with zod.

Why: LLM output is probabilistic and expensive; deterministic analysis is free,
testable, and reproducible. The LLM is used only where it adds signal (tone
nuance, topic clusters), never for what regexes can do better.

### 5. Provider-failover LLM router with circuit breakers

`LlmRouter` wraps a provider chain (`LLM_PROVIDERS` env, tried in priority
order). Each provider gets an independent **circuit breaker**
(closed → open → half-open, threshold + cooldown, per-key). Failures advance to
the next provider; open breakers fail fast instead of burning latency on a dead
endpoint.

Why: free-tier LLM endpoints are flaky. Per-provider breakers turn a
provider outage into a graceful failover instead of a user-facing 500.

### 6. Retry with backoff on transient failure — at the right layers

- Generation service retries malformed/empty LLM output (3 attempts,
  linear backoff) because free models intermittently return truncated JSON.
- X API client has a 30s `AbortController` timeout and bounded retries with
  backoff, honoring `Retry-After` on 429s, retrying only transient failures
  (never 4xx auth/404).

### 7. Durable idempotency with a TOCTOU-safe claim

Client-supplied idempotency keys are claimed via `INSERT ... ON CONFLICT DO
NOTHING`, ownership decided by affected-row count — **no check-then-act
window**. A concurrent duplicate can never overwrite the winner's
`in_progress` row (a naive upsert allowed exactly that; it caused duplicate
LLM execution and was fixed). An in-process `Set` is only a fast-path guard;
the DB constraint is the durable backstop across serverless instances.

### 8. Atomic multi-write persistence

Profile creation replaces the corpus and rewrites the profile in **one
transaction** (`db.batch()` — a single non-interactive transaction on Neon
HTTP). The old delete→update→insert sequence had a crash window that left a
profile with a stale style profile and no corpus; that's structurally
impossible now.

### 9. Data integrity in the schema itself

- **Foreign keys with `ON DELETE CASCADE`** — tweets/drafts/jobs cannot
  reference a missing profile; deleting a profile cleans up its children.
- **Orphan purge before constraint creation** in the migration (guarded,
  idempotent).
- **Indexes matched to query patterns**: composite `(voice_profile_id, likes)`
  for corpus reads, `(user_id, created_at)` for job history, unique
  `(user_id, handle)` for one-profile-per-handle, functional `lower()`
  indexes as a normalization backstop.
- **Case handling at the write boundary**: emails and handles are stored
  normalized (lowercase) so lookups are plain indexed `eq()` — no runtime
  case-folding over full tables.
- **Migration discipline**: append-only, statement arrays (never split on
  semicolons), each migration + its ledger row applied in a single
  non-interactive transaction via the Neon client — a failed migration leaves
  no half-applied state.

### 10. Three quality gates before a draft reaches the user

1. **Coherence check** (deterministic, free) — drops objectively broken model
   output (doubled words, garbage chars, symbol-heavy, truncation) without
   flagging authentic voice quirks.
2. **Blended style score** — profile gate score + distribution-aware
   deviation score, averaged.
3. **Quality floor (55/100)** — below-floor drafts are dropped before
   persistence, with the drop count logged.

Plus **moderation** on every draft: all AI content is labeled
`synthetic_content` (stored in a JSONB column), and hard categories
(violence, hate, self-harm, etc.) are rejected pre-persistence.

### 11. Shadow validation ("LLM madness validator")

After generation, a *secondary* model from the router chain (skipping the
generator — an independent judge) answers one yes/no question: was the output
on-topic and coherent? It is **non-blocking** — validator failure degrades to
`unknown`, never fails the request. The verdict is persisted on the job row.

Why: it's a cheap independent quality signal with no user-facing latency cost
beyond the timeout cap, and it creates an audit trail of model sanity over time.

### 12. FinOps: token ledger, budget caps, kill switch

Every LLM call writes a ledger row (user, provider, tokens in/out) to a
dedicated table — the durable source of truth for spend. Before any paid call:

- `LLM_KILL_SWITCH=true` hard-blocks all paid paths (explicit env kill switch)
- Per-user hourly/daily token caps (`TOKEN_CAP_HOURLY`, `TOKEN_CAP_DAILY`)
  return 429 before the call executes

**Fail-open policy, deliberately:** if the ledger itself is unavailable, the
budget check logs loudly and *allows* generation — an observability guard must
never take down the core feature. The kill switch is the only hard gate.

### 13. Observability without infrastructure

- **Metrics registry** (`lib/metrics.ts`): counters, timings, gauges —
  instrumented at the LLM router (latency per provider, token counts,
  breaker transitions) and the rate limiter (rejections by family).
- **`/api/health`**: DB round-trip, breaker states, kill-switch state,
  deploy version. 200/503 — ready for uptime checks.
- **`/api/metrics`** (auth-scoped): JSON snapshot of process metrics plus
  durable per-user spend vs caps.
- **`/analytics` dashboard**: spend-vs-cap bars, per-provider latency table,
  breaker events, rate-limit rejections — a real UI, not hand-built diagnostics.
- **Structured JSON logging** with consistent fields (`jobId`, `userId`,
  `error`) — greppable in Vercel logs.

The tradeoff is stated honestly: in-process metrics reset on cold start
(serverless reality); anything money-related is durable in the ledger table.

### 14. Rate limiting and abuse resistance

In-memory fixed-window limiter per key (`generate:userId`,
`profiles:create:userId`, `register:ip`, `signin:email`), with memory-sweep to
prevent unbounded growth. Authenticated limits are per-user; anonymous ones
per-IP. Documented tradeoff: not shared across instances — acceptable at this
scale, and the limiter interface makes a Redis swap trivial.

### 15. Input validation at every trust boundary

- zod schemas on request bodies (`/api/auth/register`, PATCH drafts) —
  unknown fields rejected, immutable fields protected, sizes bounded
- Handle validation (`^[A-Za-z0-9_]{1,15}$`) before any source call
- zod-validated `StyleProfile` contract on every read from the DB
- Env validated at startup via zod schema with fail-fast behavior

### 16. Test isolation as a hard rule

`tests/setup-env.ts` deletes `OPENROUTER_API_KEY`, `BEARER_TOKEN`, and
replaces `DATABASE_URL` with a canary **before any test runs** — the suite
physically cannot spend money or touch the production DB. Integration tests
run against the in-memory fake; unit tests never see a DB at all.
Credentials are stripped after dotenv load, so even a leaked `.env.local`
can't cause a paid call from CI.

### 17. Security posture

- bcrypt-style password hashing (`password.ts`), never stored plaintext
- Auth-scoped queries everywhere: every profile/draft query filters on
  `userId` — no cross-user data path exists
- Per-user rate limits on every mutating endpoint
- Brute-force guard on sign-in (10 attempts / 5 min per email)
- Secrets only via env; `.env.local` gitignored; a documented `.env.example`

### 18. Graceful degradation everywhere

- No `OPENROUTER_API_KEY` → clear 503 with actionable message; a failed
  `generation_jobs` row is still recorded; everything else works
- No `BEARER_TOKEN` → paste-mode fallback
- Shadow validator down → `unknown` verdict, generation proceeds
- Ledger down → budget check fails open (see #12)
- Thin corpus (<20 samples) → flagged in the API response, prompt adjusted

---

## Architecture in detail

```
src/
  app/                    CONTROLLERS (HTTP only)
    api/
      profiles/route.ts     create profile (idempotency-key aware, mode-enforced)
      generate/route.ts     FinOps gate → orchestrator (LLM pipeline)
      drafts/[id]/          GET · PATCH (zod-validated) · approve · reject
      auth/                 NextAuth route + registration (zod, rate-limited)
      health/route.ts       DB probe, breaker states, kill-switch, version
      metrics/route.ts      observability snapshot (auth-scoped)
      demo/route.ts         10-stage guided demo of the REAL pipeline
    analytics/              📊 dashboard: spend vs caps, latency, breakers
    page.tsx / new/ /profile/[handle] /login /demo
  modules/                SERVICES (business logic, no Next.js imports)
    auth/                   users service · password hashing · NextAuth config
    ingestion/              TweetSource port · mock/live/paste adapters
    analysis/               analyzer + factor modules + coherence + evaluation
    voice/                  generation service · orchestrator · moderation · prompt-builder
    llm/                    router (failover) · openrouter adapter · shadow validator
                            · idempotency (TOCTOU-safe) · token ledger (FinOps)
    profiles/               create-service (fetch → analyze → atomic persist)
    drafts/                 drafts + profiles service
    demo/                   tour definition (stage contract)
  repositories/           INTERFACE layer
    interfaces.ts           6 repository contracts — the only DB surface
    drizzle.ts              Drizzle implementations (only query builders here)
    index.ts                composition root (dependency wiring)
  db/
    schema.ts               Drizzle schema: users, voice_profiles, tweets,
                            generation_jobs, drafts, idempotency_keys, token_ledger
    migrations.ts           append-only, statement-array migrations
    migrate.ts              runner: one atomic transaction per migration
    index.ts                connection factory (pooled Neon HTTP driver)
  lib/                      framework-free utilities
    metrics.ts circuit-breaker.ts rate-limit.ts logger.ts env.ts require-user.ts
```

## DB schema design

```
users            id PK · email (unique, lowercase-normalized) · name · password_hash
voice_profiles   id PK · user_id · handle (unique per user, lowercase) · style_profile (JSON contract) ·
                 sample_count · corpus_fetched_at
tweets           id PK (profileId:tweetId) · voice_profile_id FK→profiles CASCADE · text · metrics…
generation_jobs  id PK · user_id · voice_profile_id FK→profiles · status · shadow_verdict/validator
drafts           id PK · generation_id FK→jobs (CASCADE) · voice_profile_id FK→profiles (CASCADE) ·
                 text · edited_text · status · style_match · moderation_flags (JSONB) · moderation_label
idempotency_keys (scope, key) PK · status · result · error        — durable claim table
token_ledger     id PK · user_id · provider · tokens_in/out · created_at  — FinOps ledger
```

Design points worth noticing:

- **Every child table is FK-linked with an explicit delete policy** — no
  orphaned rows are possible under normal operation, and removing a profile
  cleans up its whole subtree in Postgres rather than in app code.
- **Indexes mirror access patterns**: corpus reads by `(voice_profile_id,
  likes)`, job history by `(user_id, created_at)`, handle lookups by
  `handle` (plus a `lower(handle)` functional index), drafts by
  `(voice_profile_id, created_at)` and `generation_id`.
- **Composite PK on idempotency_keys `(scope, key)`** — the scope namespaces
  keys per operation type and per user, preventing cross-feature collisions.
- **JSONB for moderation flags** — schemaless flags with type-safe reads
  (`$type<string[]>()` in Drizzle), no join table for a bounded enum list.
- **Denormalized `moderation_label`** on drafts — the label is read on every
  dashboard render; storing it avoids re-running moderation on read.

## The generation pipeline (what actually runs)

```
POST /api/generate {handle, count, topic?}
  1. auth + per-user rate limit (20/hour)
  2. FinOps gate: kill switch → hourly cap → daily cap   (fail-open on ledger errors)
  3. load profile (auth-scoped) + corpus, zod-parse stored StyleProfile
  4. job row created (status=running)                     — durable audit trail
  5. LlmRouter.complete(): try providers in priority order
       per-provider circuit breaker · 30s timeout · token metrics
       retry ×3 on malformed JSON (free models truncate often)
  6. quality gates, in order:
       coherence   → drop broken output (repeated words, garbage, truncation)
       style score → mean(profile gate, distribution-aware deviation)
       quality floor → drop < 55/100 before persistence
       moderation  → label synthetic_content; hard-block harmful categories
  7. shadow validation: independent secondary model yes/no (non-blocking)
  8. drafts persisted with moderation metadata; job → done
  9. token spend → durable ledger row
```

Provider chain order (from a measured bake-off): `z-ai/glm-5.3-flash` (paid,
cleanest JSON) → `nex-agi/nex-n2.5-pro:free` → `nvidia/nemotron-3-ultra-550b-a55b:free`.

## Observability

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | DB latency, breaker states, kill switch, deploy SHA — uptime-probe ready |
| `GET /api/metrics` | per-instance counters (LLM latency/ok/fail/tokens, breaker transitions, rate-limit rejections) + durable ledger spend vs caps |
| `/analytics` UI | the same data, presentable: budget bars, provider latency table, breaker events |

Instrumented: LLM calls (per-provider latency histograms, ok/fail, tokens in/out),
breaker transitions (opened / blocked), rate-limit rejections by family.
In-process metrics reset on cold start (documented tradeoff); the token ledger
is the durable record.

## Testing strategy

103 tests across 15 files, all hermetic (<1s, no network, no DB):

- **Unit**: each analysis factor, coherence rules, moderation rules,
  prompt-builder selection, JSON extraction robustness, X API URL/parsing,
  circuit breaker state machine, metrics registry, kill switch
- **Integration** (route handlers called directly): profile creation end-to-end
  with fixture source, idempotency replay, auth scoping (404 for other users),
  401 paths, draft persistence + moderation columns, PATCH validation
- **Concurrency**: idempotency TOCTOU race test (concurrent claim, one winner)
- **Isolation**: setup strips all credentials and the real DB URL before any
  test runs; integration tests use the in-memory fake

```bash
npm test          # vitest
npm run build     # production build (type-checks the whole tree)
```

## Cost model (by design)

- Profile analysis: PASS 1 is free (deterministic). PASS 2 is one LLM call.
- Generation: ~1 LLM call per request (~8s on the free fallback tier), gated by
  per-user token caps and a kill switch.
- X API (live mode only): ~$0.005/post read — corpus is cached in Postgres, so
  repeat generations cost $0 extra. Default corpus is 30 tweets (~$0.15/handle).
- Every spend event is in `token_ledger` and visible on `/analytics`.

## Run

```bash
npm install
cp .env.example .env.local   # set DATABASE_URL (Neon pooled string) + USE_MOCK_X=true
npm run db:migrate           # idempotent, atomic per migration, tracked in _migrations
npm run dev                  # http://localhost:3000
```

Login at `/login` (dev credentials form; Google/GitHub activate when their env
vars are set).

### Env

| Var | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon *pooled* connection string |
| `USE_MOCK_X` | dev | `true` = fixture-backed mock source, zero X API spend |
| `BEARER_TOKEN` | no | X API v2 bearer; only for live mode |
| `OPENROUTER_API_KEY` | no | LLM generation (chain via `LLM_PROVIDERS`) |
| `LLM_PROVIDERS` | no | Comma-separated model chain with per-provider breakers |
| `TOKEN_CAP_HOURLY` / `TOKEN_CAP_DAILY` | no | Per-user FinOps caps (defaults 200k / 2M) |
| `LLM_KILL_SWITCH` | no | `true` hard-disables all paid LLM paths |
| `AUTH_SECRET` | yes (prod) | NextAuth secret |

## Modes

- **Mock (`USE_MOCK_X=true`)** — default for dev/tests. `MockTweetSource`
  replays saved real X API payloads from `../test-fixtures/`. Zero spend.
- **Live (`USE_MOCK_X=false` + `BEARER_TOKEN`)** — real X API v2 with 30s
  timeout, bounded retries, `Retry-After` honored. Server-side mode
  enforcement: the client cannot trigger live spend.
- **Paste fallback** — no API at all.