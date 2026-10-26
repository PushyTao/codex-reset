# Codex Reset code review

Reviewed the new-source package and current backend, frontend, deployment files, source OpenAPI snapshot, and design/plan. Existing tests were not rerun; targeted in-memory probes verified findings 1 and 2. No real email was sent.

## Final verdict after scoped re-review

All three original findings are addressed. No new critical or important issue was found in the reviewed fixes. The implementation is acceptable from this code review's scope. Docker runtime verification remains outstanding because the daemon was unavailable; deployment should not be described as runtime-tested.

### Fix verification

- **Source identity — resolved:** `server/source.js:32` now preserves the upstream `item.id` after URL validation. `server/store.js:30-53` resolves exact IDs first, refreshes upstream content in place, and reconciles proven legacy/manual aliases without resetting the database row ID, archive state, or delivery records. Regression tests cover optional-link enrichment, changed links, archived updates, legacy delivery preservation, manual/upstream ordering, and unrelated generic homepage records.
- **Unspecified scheduled time — resolved:** `public/app.js:35-36` validates the optional timestamp and renders `已公告，具体时间待确认` when absent. This executes before the empty-history return. The parent agent reports browser verification using no history and a scheduled record with a null timestamp, without a 1970 date.
- **Test-email status — resolved:** `public/admin.js:27` now reads `test.ok` and explicitly distinguishes failure and SMTP acceptance.

This scoped re-review inspected the changed source, tests, and `docs/source-fix-report.md`. It did not rerun unchanged tests. The source agent reports 14 source/core tests passing and 16 source/core/mail tests passing; the parent reports live browser acceptance of history, administration, recipients, and SMTP settings. These are attributed evidence, not fresh runs by this reviewer.

## Initial review verdict (superseded)

The implementation substantially follows the design: authenticated hidden administration, CSRF/origin checks, encrypted and redacted SMTP credentials, persistent recipient-specific delivery jobs, first-import baseline suppression, bounded retries, explicit observation attribution, and separate scheduled status are implemented. Two correctness issues should be fixed before acceptance. No critical authentication or credential-exposure issue was found in this review. Docker runtime and browser visual acceptance remain outside this review.

## Original findings (all resolved)

### [P2] Keep the upstream ID stable when an observation gains a link

- Location: `C:/Users/WuYantao/Desktop/reset/server/source.js:30-32`.
- `normalizeReset` initially assigns `item.id`, but the URL-validation branch returns `validateEvent`'s `source_id`, which is the X post ID extracted from the URL. The upstream schema explicitly permits an observed record without a URL, and its ID is independent of that optional link.
- Reproduction: ingest an observed item with ID `observed-20261026T070000Z` and no URL, then ingest the same ID with a valid Tibo URL. The first normalized ID is `observed-20261026T070000Z`; the second is `2114588174249071102`. Both imports report `added:1`, leaving two public events for one upstream record. A changed source URL has the same effect. This inflates history/calendar statistics and can bypass archive continuity.
- Preserve the upstream ID for synchronization deduplication. Handle any desired manual/X-link deduplication separately, and add an enrichment regression case.

### [P2] Do not turn an unspecified scheduled time into the Unix epoch

- Location: `C:/Users/WuYantao/Desktop/reset/public/app.js:47-48`.
- The source OpenAPI permits `scheduled_for:null`; `server/source.js:68` deliberately publishes `occurred_at:null` for that case. The frontend unconditionally calls `exact(null)`, and `new Date(null)` becomes the epoch.
- Reproduction: return any valid scheduled announcement with `scheduled_for:null` alongside existing history. The homepage renders `来源公布：1970/01/01 08:00` in Beijing time. This invents a reset time where the source supplied none.
- Render an explicit announced-but-time-unspecified state when the timestamp is null. Keep the scheduled block independent of the latest-history early return so it also works when all historical records have been archived.

### [P3] Read the stored test-email result field

- Location: `C:/Users/WuYantao/Desktop/reset/public/admin.js:27`.
- The frontend checks `test.success`, while `server/mail.js:30-31` persists `{ok:true}` or `{ok:false}`. After an SMTP test failure and a reload, the status always says `已尝试`, never `未完成`; successful tests also never show their persisted accepted result.
- Use `test.ok` and explicit success/failure labels. Refresh persisted state after a failed test as well if the latest-test panel should immediately reflect that attempt.

## Verification evidence

- An isolated Node probe using `createStore(':memory:')` and `normalizeReset` returned two public records after the same upstream ID gained a link.
- A direct invocation of the frontend's date-formatting semantics with null produced `1970/01/01 08:00`.
- Remaining review was static inspection; the parent agent's already-passing suite and browser acceptance were not duplicated.
