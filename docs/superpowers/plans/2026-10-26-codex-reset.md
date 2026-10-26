# Codex Reset Implementation Plan

> Execute inline in this workspace. The directory is initially empty and has no Git checkout.

**Goal:** Deliver a working Chinese reset tracker and authenticated email administration.

**Architecture:** Node.js 24 / Express / SQLite with static frontend, SMTP delivery and Codex Resets public API polling. One long-running process owns scheduled jobs.

**Spec:** `docs/superpowers/specs/2026-10-26-codex-reset-design.md`

## Global constraints
- No public navigation to `/admin`.
- No invented reset history or estimated reset countdown.
- Credentials remain server-side; no live email sent during tests.
- Node.js 24; SQLite persisted in `data/`; single replica.

## Task 1: Persistence and announcement ingestion
- [x] Write and run failing tests for validation, public records, unique source IDs, first-sync baseline and observed/source attribution.
- [x] Implement `server/store.js`, `server/validation.js`, `server/source.js`.
- [x] Run `npm test` and inspect concrete failures.

## Task 2: Authenticated administration and mail
- [x] Write failing HTTP tests for unauthorized access, same-origin/CSRF, masked credentials, recipients and duplicate delivery prevention.
- [x] Implement `server/app.js`, `server/security.js`, `server/mail.js`, and `server/index.js`.
- [x] Exercise SMTP against a local protocol server and verify recipient, body and persisted status.

## Task 3: Browser interface
- [x] Implement `public/index.html`, `public/app.js`, `public/styles.css`, `public/admin.html`, `public/admin.js`.
- [x] Verify empty, populated, error, and 720 px narrow states; verify backend data appears on the homepage. 390 px CSS reviewed; actual viewport unavailable.

## Task 4: Deployment and final verification
- [x] Provide `.env.example`, Dockerfile, compose, and a Chinese README with initial credentials, SMTP setup and backups.
- [x] Run full tests, syntax checks and browser acceptance against localhost. Compose validates; Docker engine unavailable for container run.
- [x] Report credentials still needed to enable external email and remote deployment.
