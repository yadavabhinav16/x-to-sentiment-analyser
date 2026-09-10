/**
 * Guided Demo/Tour — stage definitions.
 *
 * Single source of truth shared by the /demo UI (client) and the test suite.
 * Each stage documents the architectural decision it showcases so the demo
 * is a self-narrating architecture walkthrough, live in test mode.
 */

export interface TourStage {
  id: string;
  n: number;
  title: string;
  /** What the evaluator sees happen live. */
  liveAction: string;
  /** Module(s) of the codebase this stage exercises. */
  modules: string[];
  /** Enterprise-grade design decisions highlighted at this stage. */
  decisions: Array<{ title: string; detail: string }>;
  /** Which pipeline step the UI runner executes for this stage. */
  action:
    | "auth"
    | "ingest"
    | "analyze"
    | "resilience"
    | "generate"
    | "quality"
    | "moderate"
    | "shadow"
    | "persist"
    | "done";
}

export const TOUR_STAGES: TourStage[] = [
  {
    id: "architecture",
    n: 1,
    title: "Architecture — modular monolith with ports & adapters",
    liveAction:
      "Every stage below runs the REAL code paths against the running server — nothing in this tour is scripted output.",
    modules: ["src/modules/*", "src/app/api/*"],
    decisions: [
      {
        title: "Modular monolith, not microservices",
        detail:
          "Seven modules (auth, ingestion, analysis, voice, llm, drafts, profiles) behind typed service boundaries. Extraction to services later is a deployment concern, not a rewrite — module boundaries are already the service boundaries.",
      },
      {
        title: "Ports & adapters at every I/O boundary",
        detail:
          "TweetSource is an interface; MockTweetSource (fixtures) and XApiTweetSource (live) are interchangeable adapters. The same pipeline runs in test mode with zero external spend and in production mode unchanged.",
      },
      {
        title: "Server-rendered pages + typed API routes",
        detail:
          "Next.js App Router with force-dynamic pages, Zod-validated payloads at every route boundary, and per-user authorization enforced server-side (never trusted from the client).",
      },
    ],
    action: "done",
  },
  {
    id: "auth",
    n: 2,
    title: "Authentication — NextAuth v5, JWT sessions, brute-force defense",
    liveAction:
      "Registering and signing in a demo account through the real Credentials provider. Watch the server logs: the request passes the rate limiter before it ever reaches a password check.",
    modules: ["modules/auth", "lib/rate-limit", "lib/require-user"],
    decisions: [
      {
        title: "JWT sessions with a DB backstop",
        detail:
          "Stateless JWT for scale, but requireUser() re-verifies the user row on every request — deleted users lose access immediately even with a valid token.",
      },
      {
        title: "Brute-force guard in the auth provider itself",
        detail:
          "10 sign-in attempts / 5 min per email via the shared rate limiter — an attacker cannot parallelize guesses, and the limit lives in authorize() so it cannot be bypassed by calling a different route.",
      },
      {
        title: "Ownership scoping is a service-level invariant",
        detail:
          "Every profile/draft query takes userId and filters on it; there is no code path that fetches another user's data by ID.",
      },
    ],
    action: "auth",
  },
  {
    id: "ingestion",
    n: 3,
    title: "Ingestion — fixture-backed test mode, cost-controlled live mode",
    liveAction:
      "Creating a voice profile from a handle in TEST mode: the MockTweetSource adapter serves 100 saved real API posts. Zero X API spend, identical code path to production.",
    modules: ["modules/ingestion", "modules/profiles"],
    decisions: [
      {
        title: "Mode is enforced server-side, per request",
        detail:
          "The UI sends mode='test'|'realtime', but the route resolves the adapter itself. A client cannot trigger live X API spend unless the server decides to — the metered API is never reachable from test mode.",
      },
      {
        title: "Idempotent profile creation",
        detail:
          "Callers pass an idempotencyKey; duplicate submissions return the cached result (with replayed=true) instead of re-running a paid pipeline. Backed by a durable (scope,key) table plus an in-process lock against concurrent duplicates.",
      },
      {
        title: "Upsert semantics per (user, handle)",
        detail:
          "Re-analyzing a handle replaces corpus and profile atomically under a unique index — no duplicate-profile drift, no orphaned tweets.",
      },
    ],
    action: "ingest",
  },
  {
    id: "analysis",
    n: 4,
    title: "Analysis — deterministic PASS 1, LLM-refined PASS 2",
    liveAction:
      "The profile you just created was analyzed live: 6 deterministic factors ran first, then the LLM refined tone/topics/voice. The profile below is the real stored StyleProfile.",
    modules: ["modules/analysis", "modules/analysis/factors"],
    decisions: [
      {
        title: "Never depend on the LLM for correctness",
        detail:
          "Syntax, lexical, topics, engagement, emoji/format and tone-baseline are computed deterministically. If the LLM fails, times out, or the key is missing, the app degrades to a complete, useful PASS-1 profile — never an error page.",
      },
      {
        title: "LLM output is merged, not trusted",
        detail:
          "PASS 2 results are spread over the deterministic baseline and the whole profile is re-parsed with Zod (styleProfileSchema) before persistence — malformed model output cannot corrupt stored data.",
      },
      {
        title: "Six focused factor modules",
        detail:
          "Each factor is independently unit-tested (89-test suite) and independently swappable; the analyzer is a composition, not a monolith prompt.",
      },
      {
        title: "Signature phrases must carry content",
        detail:
          "Bigram mining for signature phrases filters through a FUNCTION_WORDS stoplist: a candidate phrase must contain at least one content word on each side, so grammar like \"this is\" or \"want to\" — which win on raw frequency — never pollutes the identity signal.",
      },
    ],
    action: "analyze",
  },
  {
    id: "resilience",
    n: 5,
    title: "LLM infrastructure — provider chain, failover, circuit breakers",
    liveAction:
      "Querying the live router health: the provider chain is built from the LLM_PROVIDERS env var (paid glm-5.3-flash primary, then free fallbacks), each behind its own circuit breaker. Failures fail over in priority order.",
    modules: ["modules/llm/router", "lib/circuit-breaker", "modules/llm/idempotency"],
    decisions: [
      {
        title: "Env-configurable provider chain",
        detail:
          "buildLlmRouter reads LLM_PROVIDERS (comma-separated model slugs, tried in order) and falls back to the baked-in default chain with glm-5.3-flash as the paid primary. Swapping providers is a config change, never a code change — ops can rebalance the chain without a deploy.",
      },
      {
        title: "Priority-ordered provider failover",
        detail:
          "LlmRouter wraps N providers; failures record on the per-provider circuit breaker and the next provider is tried. AllProvidersFailedError carries the full attempt log for diagnostics.",
      },
      {
        title: "Circuit breakers fail fast",
        detail:
          "After repeated failures a provider's breaker opens and requests skip it without network latency, until the probe window succeeds again.",
      },
      {
        title: "Structured logging, not console.log",
        detail:
          "Every pipeline step logs through one logger with context (handle, jobId, provider) — the same fields an on-call engineer would filter on in production.",
      },
    ],
    action: "resilience",
  },
  {
    id: "generation",
    n: 6,
    title: "Generation — prompt building, exemplar selection, scored drafts",
    liveAction:
      "Generating 5 drafts for the demo profile through the live LLM (OpenRouter). Each draft comes back with a deterministic styleMatch score computed from the StyleProfile.",
    modules: ["modules/voice", "modules/llm/openrouter"],
    decisions: [
      {
        title: "Exemplar selection, not prompt stuffing",
        detail:
          "selectExemplars picks high-engagement, representative posts from the corpus as few-shot examples — the prompt carries the account's actual voice, not a description of it.",
      },
      {
        title: "Quality gate is deterministic and testable",
        detail:
          "evaluateDraft() scores 0-100 against the profile (length, casing, emoji policy, punctuation, signature phrases) with unit tests. Draft quality is measurable without another LLM call.",
      },
      {
        title: "Generation jobs are first-class rows",
        detail:
          "Every generation writes a generation_jobs row (running → done/failed) with tokens in/out — auditable, debuggable, and rate-limitable.",
      },
      {
        title: "Transient bad output is retried",
        detail:
          "Free models intermittently return empty or truncated JSON bodies. Generation retries up to 3 times on malformed output (the router handles provider-level failover; this handles transient bad output from a healthy provider).",
      },
    ],
    action: "generate",
  },
  {
    id: "quality",
    n: 7,
    title: "Quality gates — coherence check + distribution-aware style scoring",
    liveAction:
      "Re-scoring the drafts you just generated: each one passes the deterministic coherence check (repeated words, truncation, garbage tokens) and a styleMatch that blends the profile gate with distribution-aware deviation scoring.",
    modules: ["modules/analysis/coherence", "modules/analysis/evaluate"],
    decisions: [
      {
        title: "Broken output is dropped, not scored",
        detail:
          "checkCoherence() is a free, deterministic PASS-1-style check that catches objectively broken model output — doubled words, replacement/control characters, symbol-heavy text, trailing commas, dangling final words, unterminated drafts — and drops it before persistence.",
      },
      {
        title: "Voice quirks are never flagged as errors",
        detail:
          "The coherence heuristics are tuned so authentic style — lowercase starts, run-ons, slang, short fragments — passes. It detects degradation, not idiosyncrasy, so the clone stays faithful to the real voice.",
      },
      {
        title: "styleMatch is distribution-aware",
        detail:
          "scoreStyleDeviation() compares drafts against the profile's actual distributions (length range, question rate, casing habits, topic clusters, profanity policy) with graduated penalties, and styleMatch is the blend of the original gate and this score — not a single blunt number.",
      },
    ],
    action: "quality",
  },
  {
    id: "moderation",
    n: 8,
    title: "Moderation — every draft labeled, harmful categories blocked",
    liveAction:
      "Running the moderation layer live against a benign draft (allowed, flagged synthetic) and a policy-violating sample (hard-blocked). Then inspect the moderation labels persisted on your generated drafts.",
    modules: ["modules/voice/moderation", "app/api/generate"],
    decisions: [
      {
        title: "Synthetic content is always labeled",
        detail:
          "Every AI-generated draft carries an unavoidable synthetic_content flag and an 'AI-generated' label persisted beside the text — provenance survives export, not just the UI.",
      },
      {
        title: "Hard/soft severity split",
        detail:
          "Hard categories (self-harm, violence, hate) reject the draft before it is stored; soft categories (medical advice, illegal activity) persist with flags so downstream reviewers see them.",
      },
      {
        title: "Moderation is a pure function in the pipeline",
        detail:
          "moderateDraft(text) has no I/O, so it is unit-tested exhaustively and cannot be bypassed from the UI — the generate route filters before persistence.",
      },
    ],
    action: "moderate",
  },
  {
    id: "shadow",
    n: 9,
    title: "Shadow validation — an independent model judges the output",
    liveAction:
      "Inspecting the verdict recorded on your generation job: a secondary model from the router chain (never the model that wrote the drafts) answered a single Yes/No question — was the output on-topic and coherent?",
    modules: ["modules/llm/shadow-validator", "app/api/generate"],
    decisions: [
      {
        title: "Independent judge, one sharp question",
        detail:
          "runShadowValidation() asks a DIFFERENT model from the router chain (the generator model is explicitly skipped) a single Yes/No question: is this output on-topic and coherent? Style is explicitly out of scope — the deterministic gates own that.",
      },
      {
        title: "Validation is a signal, not a gate",
        detail:
          "Non-blocking by design: a failed, timed-out (20s cap), or unavailable validator degrades to verdict 'unknown' and never fails the generation. Availability always beats a quality check that can take the pipeline down.",
      },
      {
        title: "The verdict is persisted for observability",
        detail:
          "shadow_verdict and shadow_validator are columns on generation_jobs — every generation carries a durable record of what the independent judge thought, queryable alongside tokens and status.",
      },
    ],
    action: "shadow",
  },
  {
    id: "persistence",
    n: 10,
    title: "Persistence — Neon Postgres + Drizzle, disciplined migrations",
    liveAction:
      "The demo user's profile, corpus, generation jobs, and moderation-labeled drafts all live in Neon Postgres right now — queried per-user on every page load.",
    modules: ["db/schema", "db/migrations", "lib/rate-limit"],
    decisions: [
      {
        title: "Serverless Postgres with an edge-ready driver",
        detail:
          "Drizzle over Neon Postgres via the neon-http serverless driver — one HTTP fetch per query, so the same client code runs on Node and edge runtimes. DATABASE_URL points at a pooled Neon connection string.",
      },
      {
        title: "Append-only, idempotent migrations",
        detail:
          "Released migrations are never edited; every statement is guarded (IF NOT EXISTS / check-before-alter) and applied in a transaction, tracked in _migrations. Safe to run against any prior state.",
      },
      {
        title: "Honest rate limiting",
        detail:
          "In-memory fixed-window limiter (with memory-sweep) is documented as single-process only — the tradeoff is stated in code rather than hidden behind a Redis-shaped interface.",
      },
    ],
    action: "persist",
  },
];

export const TOUR_STAGE_IDS = TOUR_STAGES.map((s) => s.id);