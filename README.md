# Tweet Voice Cloner

Give an X handle → get tweet drafts in that person's voice.

Next.js 14 App Router · NextAuth v5 · Drizzle + SQLite (better-sqlite3) · Tailwind · vitest.

## Run

```bash
npm install
cp .env.example .env.local   # set USE_MOCK_X=true for fixture-backed mode
npm run db:push              # not needed — schema auto-migrates on first use
npm run dev                  # http://localhost:3000
```

Login at `/login` with the dev credentials form (any valid email) — OAuth providers
(Google/GitHub) activate automatically when their client ID/secret env vars are set.

## Modes

- **Mock mode (`USE_MOCK_X=true`)** — default for tests/e2e. `MockTweetSource` reads the
  saved real X API response payloads from `../test-fixtures/`. **Zero live X API calls.**
- **Live mode (`USE_MOCK_X=false` + `BEARER_TOKEN`)** — `XApiTweetSource` hits the real
  X API v2 endpoints (`users/by/username`, `users/:id/tweets`). Cost: ~$0.005/post read;
  the corpus is cached in SQLite so repeat generations cost $0.
- **Paste fallback** — paste tweets manually in the wizard (no API at all).

## Generation

`/api/generate` needs `OPENROUTER_API_KEY` (`LLM_MODEL` defaults to
`nvidia/nemotron-3.5-lightning:free`). Without the key it returns a clear 503 and logs a
failed `generation_jobs` row; everything else (fetch, PASS-1 analysis, profile page,
drafts CRUD) works without it.

## Architecture

```
src/
  modules/
    auth/        NextAuth v5: dev credentials + optional Google/GitHub
    ingestion/   TweetSource port · XApiTweetSource · MockTweetSource (fixtures) · paste-parser
    analysis/    analyzer.ts (PASS 1 deterministic factors + PASS 2 single LLM call)
                 factors/{syntax,lexical,topic,engagement,emoji-format,tone}.ts
                 style-profile.ts (zod contract) · evaluate.ts (style-match gate)
    voice/       prompt-builder.ts · generation-service.ts
    llm/         LlmClient interface · OpenRouter adapter (JSON extraction robustness)
    profiles/    create-service.ts (fetch → analyze → persist)
    drafts/      service.ts (CRUD, approve/reject/edit)
  db/            Drizzle schema + auto-migrating SQLite (data/app.db)
  lib/           env.ts (zod-validated) · logger.ts (structured JSON)
  app/           /login · / (dashboard) · /new (wizard) · /profile/[handle]
```

## Tests

```bash
npm test        # 34 vitest tests: syntax, lexical, style-profile merge, prompt-builder,
                # JSON extraction, X API URL construction + fixture parsing (unit-level)
```

## E2E (mock mode, verified)

`POST /api/profiles {handle:"elonmusk"}` → 200, 100 tweets persisted, StyleProfile stored
→ `/profile/elonmusk` renders analysis + drafts → PATCH/approve/reject draft endpoints
verified. `/api/generate` returns 503 with a clear message until `OPENROUTER_API_KEY` is set.
