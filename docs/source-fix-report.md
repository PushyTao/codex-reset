# Source identity review fix

`normalizeReset` now retains the upstream API ID after validating and canonicalizing an optional X URL. An observation can gain or change a link without changing its synchronization identity.

The store refreshes an existing upstream row's source metadata and announcement content in place. Its database row ID, created time, publication/archive status, and delivery records are retained. Refreshes return `added:0, queued:0`.

Backward compatibility is applied during ingestion, with no destructive database migration:

- A numeric legacy `codex-resets` row is an alias only when its ID equals the upstream ID's numeric suffix, its reset kind matches, and its timestamp matches exactly.
- Alternatively, a numeric legacy row or manual row can match the same verified Tibo X/Twitter status URL and reset kind. Only HTTPS status URLs on the permitted X/Twitter hosts qualify; a generic source homepage never qualifies.
- A matched legacy/manual row adopts the upstream API ID in place. Adding a manual record after an upstream record with the same verified post also stays silent and preserves upstream attribution.
- Distinct upstream stable IDs are not merged merely because they reference the same URL. Ambiguous historical URL aliases are left unreconciled rather than deleting or merging rows speculatively.

## Verification

Before production changes, the source/core regression command reported 14 tests, 8 passing and 6 failing. Failures showed the numeric ID replacing the upstream ID, duplicate enrichment rows, and missing legacy/manual reconciliation.

After the fix:

```text
rtk proxy node --test --test-concurrency=1 tests/source.test.js tests/core.test.js
14 passed, 0 failed

rtk proxy node --test --test-concurrency=1 tests/core.test.js tests/source.test.js tests/mail.test.js
16 passed, 0 failed (escalated local run)
```

The covering tests verify no-URL enrichment, changed links, archived refreshes, source type/text updates, row identity retention, preservation of sent delivery history, true new resets queuing once, manual/upstream ordering in both directions, and non-merging generic homepages or mismatched timestamps. Existing pagination atomicity and scheduled/history separation tests still pass.

The sandboxed covering run had one SMTP loopback test failure (`sent:0` rather than `2`); the same command outside the sandbox passed all 16 tests. Node prints its existing experimental SQLite warning. Tests use local fake SMTP and send no real email.

A read-only check of `data/reset.sqlite` returned 68 total rows and 68 numeric `codex-resets` IDs. This task did not modify that live database or restart the server. The normal next sync will reconcile proven aliases. Any pre-existing ambiguous duplicate rows require separate review; this fix intentionally does not delete them.
