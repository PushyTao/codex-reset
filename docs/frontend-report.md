# Frontend implementation report

## Files

- `public/index.html`: Chinese public dashboard; no administration navigation or link.
- `public/styles.css`: shared responsive cream/green editorial design and namespaced administration styles.
- `public/app.js`: public status fetching, refresh and relative clock, source freshness, timezone formatting, 90-day calendar, record statistics, filters, search and pagination.
- `public/admin.html`: private administration login and five management sections; `noindex,nofollow` metadata.
- `public/admin.js`: authenticated JSON API integration with CSRF headers, recipient lifecycle, settings, explicit test email, synchronization, manual records, archive and delivery logs.

## Behavior

The dashboard displays actual API records only. Empty, initial loading, stale-source, disabled synchronization and failed refresh states are visible. Community observations and X original-post announcements receive different source labels, with a backwards-compatible origin fallback. Upcoming reset timing is only displayed when the API supplies `scheduled`; otherwise the page states that it does not predict resets.

Dynamic content is built with DOM `textContent`, outbound URLs require HTTPS, and all scripts/styles are external for the server CSP. Requests use same-origin credentials. All administrative writes include the current `X-CSRF-Token`. SMTP secrets are never filled back into inputs; blank passwords retain the stored value, and a separate checkbox clears it.

## Verification

- `rtk proxy node --check public/app.js` — passed.
- `rtk proxy node --check public/admin.js` — passed.
- API route and payload review completed against `server/app.js`, `server/settings.js`, `server/store.js` and `server/validation.js`.

Browser visual QA and end-to-end server integration are handled by the parent agent. No frontend dependency or build process is needed.

## Review corrections

- Scheduled announcements with a missing or invalid timestamp display “已公告，具体时间待确认”; timestamps that have passed are not treated as completed resets.
- The latest SMTP test status reads the backend `test.ok` field and labels accepted tests “SMTP 已接受”. This does not claim inbox delivery.
- All frontend banked-reset labels use “备用额度”; the former bonus wording has been removed.
- Re-ran `node --check` for both frontend JavaScript files after these corrections; both passed.
- Scheduled announcements render before the empty-history branch, so an upcoming announcement remains visible even before any historical reset has been published.

## 390 px source-level layout review

The mobile breakpoint activates below 720 px. At 390 px, the main content width is 346 px, hero/status sections stack, filters wrap, search becomes full width, and admin forms use one column. Calendar and admin tables intentionally scroll within their own wrappers. No fixed page-width element was found that forces horizontal page scrolling at 390 px. Long unbroken announcement summaries could previously widen their grid track; `min-width: 0` and `overflow-wrap: anywhere` now constrain them. This is a CSS source review, not a confirmed rendered 390 px browser test; the parent browser tool currently clamps its viewport to 720 px.
