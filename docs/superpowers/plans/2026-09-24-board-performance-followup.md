# Board performance follow-up

The user authorized all six remaining performance items, including production deployment and measurement. This supersedes the previous plan's no-deployment constraint. The four separate data/ownership concerns are explanation-only in this task.

1. Record authenticated browser RSC response times on the current production deployment; repeat the identical measurement after deployment. Keep payload and timing definitions explicit.
2. Paginate RSS and stock lists at 30 rows, preserve tab/week/filter links, use deterministic ordering, and keep aggregate counts across all pages.
3. Filter stock in SQL; batch keywords for only the selected page instead of a correlated subquery per article.
4. Cache tab data with explicit parameters (run, area, filter, page). Keep login/ownership resolution outside persistent caches.
5. Use run-specific card/count cache tags for edits and collection tags for ingestion. Refresh the UI without invalidating unrelated cached board queries. Card detail caches must reflect save/note/angle changes immediately.
6. Test pagination, cache isolation/expiry and mutations; compare old/new SQL on production in read-only mode. Review, commit, merge to main, push and verify successful Railway deployment plus actual browser behavior.

No DB schema changes or collector algorithm changes are required. Existing source docs confirm UUID mention IDs and bigint run IDs. Pagination/caching preserve the existing meaning of global/shared statistics.

## Pre-deployment verification

- 21 regression tests passed; the normal Turbopack production build passed.
- Local production-server integration passed: all six tabs, 30-row pagination, filter/week preservation, invalid page clamping, user/run cache isolation, note/angle/confirmation freshness and targeted invalidation. After warming each tab, only three live context queries remain per request; cache misses and invalidations perform additional data queries.
- Real Railway PostgreSQL SELECT-only comparison passed for all pages and all four subreddit filters: run 25 has 97 stock articles, run 4 has 78, run 7 has 86. The empty run sentinel returns no stock. RSS pagination preserves all 650 articles without duplicates.
- EXPLAIN ANALYZE sample on run 25: previous full stock query 5.408ms; new 30-row query 0.363ms + page-keyword aggregation 0.533ms. This compares a full list with the requested page, not identical row counts; it excludes network time.
- Browser baseline on deployed `6e726e2`: median full RSC response times (four samples after one warm-up) main 1065ms, ideas 1053ms, stock 1101ms, RSS 1453ms, mine 998ms, draft 1005ms. Same-origin authenticated fetch, response body fully received; not final paint timing.
- Review found no introduced blocking issue. Deployment and the post-deployment measurement follow this commit; final results are reported in the task.
