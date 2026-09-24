# Board Tab Data Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement the previously agreed section 6: reuse common board data and load only the selected tab's data.

**Architecture:** Keep the existing URL, Server Components and HTML. Authorize every request; use React request memoization for workspace helpers. Cache common statistics/areas and workspace run lists with Next's existing non-Cache-Components API, invalidate after writes, and batch card details only in tabs that need them.

**Tech Stack:** Next 16.3.1, React 19, PostgreSQL/pg, TypeScript, node:test.

## Global Constraints

- No DB schema/data migration, collector algorithm, Railway configuration, or visual redesign.
- Keep `force-dynamic`; do not enable application-wide Cache Components for this change.
- Cookies and authorization stay outside persistent caches. Run IDs and workspace IDs are cache arguments.
- Card edits must be immediately visible. Collection endpoints invalidate common cached data, including partial writes on failure.
- Work on `codex/board-tab-data`; do not publish/deploy as part of this request.

## Task 1: Request deduplication and tab-specific card queries

**Files:** `lib/workspace.ts`, `lib/board-data.ts`, `app/board/page.tsx`, `tests/board-data.test.cjs`.

**Interfaces:** `getCards(runId, { savedOnly, includeComments })`, `getCardSummaries(runId)`, existing workspace helpers retain their arguments/return types.

- [x] Add failing tests using an injected pg pool: twelve cards produce three SELECTs, empty results one, draft cards filter `status = 'saved'` in SQL and omit comment SELECTs.
- [x] Memoize request helpers with `cache(async (...) => ...)`; test concurrent calls and request isolation.
- [x] Replace the per-card loop with two batched queries using `mention_id = any($1::uuid[])`, group results by mention ID, preserve comment rank and bilingual keyword labels. Only run IDs are bigint.
- [x] Add a narrow summary query for MainTab. Move getCards into IdeasTab and DraftTab; use `stats.cards`/`stats.saved` for navigation badges.
- [x] Parallelize independent MainTab reads and wrap only tab content in Suspense. Preserve selected week in card links.
- [x] Run `node --test tests/board-data.test.cjs` and `npx tsc --noEmit`.

## Task 2: Common cache lifecycle

**Files:** `lib/board-cache.ts`, `lib/workspace.ts`, `app/board/page.tsx`, mutation routes in `app/api/cron/`, `tests/board-cache.test.cjs`.

**Interfaces:** `getBoardSummary(runId)` returns `{stats, areas}`; existing card actions retain `revalidatePath('/board')`; run-list cache uses validated workspace ID/kind.

- [x] Test distinct run/workspace cache keys, cache hits, explicit invalidation, and absence of cached cookies/authorization.
- [x] Implement `unstable_cache(..., ['board-summary-v1'], { tags: ['board-data'], revalidate: 60 })`; add run-list caching after authorization only.
- [x] In collection route `finally` blocks call `revalidateTag('board-data', { expire: 0 })`. Do not invalidate on denied or peek-only requests.
- [x] Verify card Server Actions refresh the summary; add explicit `updateTag('board-data')` for immediate tagged invalidation alongside `revalidatePath('/board')`.
- [x] Run tests, including mutation invalidation ordering and error paths.

## Task 3: Verification and handoff

**Files:** `tests/` and this plan's verification notes only, unless a regression requires an in-scope correction.

- [x] Run all regression tests and production build.
- [x] Compare old/new SELECT results against Railway in a separate read-only process (no deployed code changes).
- [x] Test actual Next cache behavior in a local production server with an injected fixture DB; verify six tabs, repeated requests, run separation and mutation refresh without production writes.
- [x] Review the diff for unrelated changes, secret leakage, and authorization/cache boundaries.
- [x] Record query counts and verification limits; leave local changes for the user's deployment decision.

## Verification results — 2026-09-24

- `node --test tests/board-data.test.cjs tests/board-cache.test.cjs lib/cron/due.test.mjs`: 18 passed.
- `npx tsc --noEmit`, `npm run build -- --webpack`, and normal `npm run build` (Turbopack): passed.
- `node tests/board.integration.cjs`: actual local production Next server + fixture-only DB; request memoization, common cache hits, run/user separation, Server Action save and immediate summary refresh, saved-only draft, unauthenticated redirect passed. No production write was used.
- Local warm-cache counts: main 9, ideas 6, stock 5, RSS 5, mine 6, empty draft 4; main cold 12. Cold common/run-list cache adds 3 queries. Nonempty draft adds 1 keyword query. These are query counts, not an assertion of production latency.
- Railway SELECT-only equivalence check: runs 25, 4 and 7 each have 12 cards. Old/new card results match (keyword sets normalized for unspecified SQL order), each 25 → 3 queries. Saved draft is 0/1/0 cards, respectively, and 1/2/1 queries; empty run 0 remains empty. Narrow summary fields and card/saved counts match the old full-card results.
- The live comparison caught an initial UUID/bigint cast mismatch; both detail queries now use `uuid[]`, matching `schema.sql`, and the comparison passed after correction.
- Common cache revalidation interval: 60 seconds, with explicit immediate expiry after card writes and each authorized collection mutation endpoint (including partial failures). This is not a permanent snapshot. Account/ownership/current-run checks stay fresh; their repeated calls are deduplicated only within a request.
- Next 16 prefers Cache Components for new designs; this scoped change retains the existing non-Cache-Components architecture and uses its supported `unstable_cache` API. A global framework cache-mode migration is out of scope.
- No schema migration, DB content modification, credential/region change, commit, push or deployment performed.
- Existing export/card-action ownership checks were not redesigned in this performance-only task; separate security review remains advisable.
