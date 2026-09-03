# Production validation report

Validated through 2026-09-03.

## Overall Verdict

**Not Production Ready**

The database and application build/test gates in scope passed, but complete production workflow execution coverage has not yet been established.

## n8n Review

| Workflow | Status | Change / result |
| --- | --- | --- |
| RivaCare Database Migration Runner - MANUAL | Unpublished | Executed migration manually as `101801`; then unpublished because an unauthenticated webhook could invoke schema changes. |
| Juvonno Settings Backend - PRODUCTION MULTICLINIC | Active | Header-authenticated; production malformed-input execution `101861` rejected a missing tenant ID at validation before any write node. |
| Juvonno AI Receptionist - PRODUCTION PATIENT IDENTITY HARDENED v2 2026-08-21 | Active, published `15f44698-c5af-4561-8b4f-d5a86d7193a8` | Header Auth retained. Production-mode negative-path execution `103932` failed closed with `MISSING_TENANT_METADATA`, human-transfer response, and no downstream Settings/Juvonno/write execution. |
| Juvonno INBOUND - PRODUCTION MULTICLINIC | Active, published `5719ebcd-0927-49dd-b0bc-427f0ee48902` | Its unauthenticated Retell handlers formerly accepted tenant/clinic metadata before writing calls and billing. Both Retell trigger nodes retain the existing Header Auth credential. The selected direct Retell → n8n deployment now awaits a controlled callback test for phone-to-clinic routing. |
| Juvonno AI Payment Recovery - PRODUCTION MULTICLINIC | Unpublished | Saved draft now skips incomplete Juvonno clinic configurations instead of aborting the entire sync. It remains unpublished; controlled end-to-end validation is still required. |
| Juvonno OUTBOUND - PRODUCTION MULTICLINIC | Active, latest published `0376c77f-c02c-4eec-ab6a-a5f5f68fcec1` | Dashboard and Retell triggers require Header Auth. Corrected its Overview formatter to accept BFF snake-case `tenant_id`; authenticated test and production webhook checks passed with a synthetic nonexistent scope. Published a security-guidance correction that replaces stale direct-Retell/caller-scope instructions with the signed BFF routes and fail-closed configuration requirement. Target configuration and vendor routing remain required. |
| RivaCare Appointment Requests API - BACKEND POLISH FIXED 2026-08-12 | Active | Header-authenticated. Invalid input `101834` and foreign scope `101840` reached only validation/read/rejection nodes; the latter returned `CLINIC_ACCESS_FORBIDDEN`. |
| RivaCare Appointment SMS Follow-Ups - PRODUCTION MULTICLINIC | Active | Header-authenticated status API plus schedule. Safe execution `101837` found zero jobs and did not claim/send a message. Live scheduler execution `103300` (2026-09-03 01:30) completed in 580 ms, reached queue/no-show guards only, and returned zero items without a Twilio-send node run; the one-minute cadence is an idle queue poll. Restored its documented BFF target and verified its safe status contract through the local BFF. The canvas’s legacy “Run SQL 13/14” note must not be followed: schema changes are restricted to the authorized migration runner. |
| RivaCare Outbound Batch Calls - HARDENED DATABASE PRODUCTION MULTICLINIC | Active, published `a041fa76-9685-4a34-bf76-1292caaddd85` | Fixed missing owner/admin enforcement on its list path in both n8n and BFF. Production foreign-scope test `101851` returned `CLINIC_ACCESS_FORBIDDEN` without provider/write nodes. Restored its documented BFF target and verified the read-only list contract. |
| RivaCare Knowledge Base Submission Queue - HARDENED PRODUCTION MULTICLINIC | Active | Browser review confirmed Header Auth with `RivaCare Dashboard Auth`, private-storage metadata-only flow, and scoped payload validation. Restored the missing BFF target configuration; authenticated list and invalid-action validation now pass. |
| RivaCare Manager Analyst Tools - RAG PRACTITIONER REVENUE AND LEAKS | Active | Header-authenticated. Invalid input `101836` and foreign-scope read `101842` rejected before provider access. |
| JUVONNO Retell Batch Calls | Unpublished | Browser review found a published unauthenticated `POST /webhook/juvonno-outbound/make-call` endpoint that could create Retell batch calls. The workflow was unpublished as reversible containment. |

## Dashboard Review

The production frontend build passed. Core Express BFF modules passed syntax checks. Advisor BFF tests cover scoped conversations, memory, analytics, recommendations, and foreign-scope rejection. An authenticated browser smoke test against the live deployment remains outstanding.

## Retell agent export review

The reviewed v12 Conversation Flow export has strong booking, identity-recovery, availability, cancellation-confirmation, and transfer rules. It retains the selected direct n8n architecture: agent-level `call_analyzed` targets `/webhook/juvonno` and all seven custom functions target `/webhook/juvonno-receptionist`. Static clinic-routing defaults are removed, full call context is retained, failure/transfer response variables are mapped, `get_many_slots` uses a 120-second timeout, PII minimization is enabled, and ambient sound is disabled. The agent remains unpublished. A controlled callback test is still required before relying on phone-to-clinic routing in a live call.

Each clinic must use a distinct Retell agent. A shared agent ID is not a valid scope mechanism and must not be used to derive tenant or clinic identity. The existing shared receptionist-agent configuration will be replaced only after separate unpublished agents are created and securely assigned; until then, it prevents a safe uniqueness constraint from being applied.

## Prisma/PostgreSQL

- Schema validation passed.
- `20260828000000_add_clinic_advisor_storage` was manually applied through the authorized migration runner and then independently verified.
- `20260903000000_scope_advisor_memory_jobs` was applied through the authorized migration runner in execution `103310`, then catalog-verified in `103312`. It adds/backfills durable tenant scope for Advisor memory jobs, rejects unscopable historical rows, and enforces non-null tenant, tenant FK, composite message/conversation/tenant FK, and a tenant/status index.
- Prisma migration history was baselined only after schema verification; migration status is now up to date.
- Required Advisor tables, tenant FKs, composite tenant/clinic FK, constraints, and indexes are present.
- The migration is additive; no destructive rollback was required. Recovery is practical through normal backup/restore or targeted removal of newly created Advisor tables only if a future rollback is required.

## Advisor and Security

64 deterministic tests passed, including tenant/clinic scope clipping, foreign-ID protection, encrypted memory, durable tenant-scoped memory jobs, recommendation status/measurement, source-backed analytics behavior, Retell raw-body signature validation, canonical inbound scope forwarding, public-settings secret redaction, public website URL validation, fail-closed n8n transport behavior, deterministic inbound historical-read formatting, and verified-scope query aliases. The migration runner's public schema-write webhook remains unpublished. The active Receptionist workflow now fails closed for missing clinic scope; the active direct INBOUND router awaits a controlled Retell callback validation.

## Automated Testing

| Check | Result |
| --- | --- |
| Advisor/security/analytics suite | 64 passed, 0 failed |
| Public Settings secret redaction | Passed: BFF strips nested and top-level credential-shaped fields before dashboard delivery |
| Prisma validate | Passed |
| Prisma migration status | Passed |
| Live schema catalog verification | Passed |
| Frontend production build | Passed |
| Current-worktree production build (2026-09-03) | Passed: 2,287 modules transformed. The only warning remains the non-blocking 856.61 kB minified application chunk. |
| Final current-worktree build/schema recheck | Passed: Vite production build, `prisma validate`, and live `prisma migrate status`; only the non-blocking large-chunk warning remains |
| Core server syntax checks | Passed |
| Production-mode unauthenticated BFF probes | Passed: protected read, foreign-clinic read, and mutation all returned `401` before downstream work |
| Expanded BFF unauthenticated probes | Passed: Settings, Appointment Queue approval, Outbound Batch creation, Recovery approval/settings, and Knowledge Submission endpoints each returned `401` before downstream work |
| n8n transport fail-closed tests | Passed: missing dashboard auth prevents a fetch; upstream error bodies return only a generic `502` response |
| Retell raw-body gateway verifier | Passed: 6 tests cover exact HMAC validation, invalid/malformed/stale rejection, signed authenticated forwarding, missing-target fail-closed behavior, canonical inbound scope injection, and missing/duplicate scope rejection |
| Retell gateway runtime preflight | Passed: both unconfigured routes fail closed with `503` and cannot forward traffic |
| Outbound Retell gateway runtime preflight | Passed: the unconfigured `/webhooks/retell/outbound-call-analyzed` route returned generic fail-closed `RETELL_WEBHOOK_NOT_CONFIGURED` and could not forward traffic |
| Payment Recovery manual execution `101812` | Inconclusive: pinned sync fixture failed before writes because its test clinic lacks a Juvonno connection |
| Payment Recovery draft hardening | Persisted and API-verified: `SYNC | Code - Prepare Clinic` now logs/skips rows lacking identity or a Juvonno domain/key. Two editor attempts were bound by n8n to the selected Retell webhook and stopped before the sync chain; neither is treated as a validation. |
| Payment Recovery deterministic preparation check | Passed against the API-verified saved code: an incomplete clinic was excluded, while a configured clinic produced the expected Juvonno base URL and defaults. This is not a live n8n execution. |
| Payment Recovery configuration-presence audit | Read-only count-only query: two active clinics, one with a configured encrypted Juvonno connection; no identifiers or secrets were returned. |
| Receptionist routing configuration audit | Read-only count-only query: two active clinics; one has a receptionist-phone mapping, both have receptionist-agent values, but only one distinct agent value exists and it is duplicated. BFF lookup uses a unique normalized destination phone and fails closed; agent ID cannot be used for scope. A synthetic read-only PostgreSQL expression check normalized `+1 (416) 555-0199` to `14165550199`. |
| Receptionist index audit | Passed: live `clinic_configs_receptionist_phone_uidx` is a partial unique index over non-empty receptionist phone values. No new index migration was applied because it would be redundant. |
| Receptionist BFF scope adapter | Passed: 2 focused tests prove that a signature-verified payload is stripped of top-level and nested caller scope, receives only the server-resolved tenant/clinic pair, preserves custom-function `name`/`args`, recognizes Retell's documented `call_inbound.to_number` shape, and fails closed without a unique mapping. |
| Receptionist contained workflow `102777` | Passed safely: a Retell-shaped inbound payload without canonical scope returned `MISSING_TENANT_METADATA` and transfer-to-human. Only Webhook, scope parsing, branch, and response nodes ran; no Settings, Juvonno, or write node ran. |
| Expanded Retell configuration audit | Passed (presence-only): the Retell verification key and all five internal n8n targets, including `N8N_RETELL_RECEPTIONIST_URL`, are absent. Every BFF Retell route remains fail-closed. |
| Current Retell configuration-presence audit (2026-09-03) | Confirmed: all six Retell signature/routing settings are absent from the local runtime and `.env`; the separate internal n8n dashboard-auth setting is present. No values were read or recorded. |
| Backend local runtime smoke test | Passed: temporary backend process returned `200` from `/health` and `/healthz`; the latter reported database, n8n, and Advisor available. |
| Receptionist gateway runtime preflight | Passed: synthetic unsigned POST returned generic `503 RETELL_WEBHOOK_NOT_CONFIGURED`; no target was configured or called. |
| Dashboard inbound Overview recovery | Passed: a parameterized BFF read of the authenticated tenant/clinic billing row returned `200` with the complete established response contract. |
| Dashboard outbound Overview recovery | Passed: the equivalent tenant/clinic-bound BFF read over `outbound_billing_months` returned `200` with the complete established response contract, independent of the n8n overview branch's prior `tenant_id` mismatch. The rendered dashboard displayed both usage summaries; its remaining availability banner correctly represented separate unavailable connected-service data rather than fabricated zeroes. |
| Outbound Overview n8n correction | Passed and published `dae947a2-3e71-4ddf-bb3b-5cc3966cec87`: both test and production authenticated Overview webhooks accepted a synthetic nonexistent snake-case `tenant_id` and returned the complete contract. Only the parameterized overview reads and formatter were in scope. |
| Knowledge Base BFF integration recovery | Passed: restored the missing server-only `N8N_KNOWLEDGE_BASE_SUBMISSIONS_URL` target. The local authenticated dashboard list reached the active workflow and returned `200` with an intentional empty submissions list; a direct synthetic invalid action returned `UNSUPPORTED_ACTION` before a storage branch. |
| SMS and Outbound Batch BFF integration recovery | Passed: restored their missing documented server-only target URLs. Local authenticated read-only BFF probes returned `200` for the normalized SMS-status and Outbound Batch list contracts; no SMS, batch creation, or Retell dispatch path was invoked. |
| Inbound dashboard historical-read recovery | Passed: session-authorized parameterized BFF queries now supply calls, transcripts, and analytics independently of the contained Retell workflow. Local endpoint probes returned `200` with the established array, calls, and transcripts contracts. |
| Inbound invoice-history recovery | Passed: a session-authorized parameterized BFF `invoices` read replaced the final contained workflow dashboard proxy; local endpoint probe returned `200` with the established invoices contract. |
| Outbound legacy query-alias recovery | Passed: the BFF now sends camel- and snake-case aliases derived only from verified session scope. Local probes for active Outbound analytics, calls, and transcripts returned their real contracts instead of hidden `No tenant specified` error bodies. |
| Rendered local dashboard acceptance smoke | Passed: Overview rendered confirmed combined usage without the prior unavailable-service banner; inbound Call Logs rendered scoped records and filters. |
| BFF n8n scope-alias regression | Passed: unit test proves camel- and snake-case n8n query aliases are identical values derived solely from server-authorized tenant/clinic scope. |
| Appointment Requests invalid/foreign scope `101834` / `101840` | Passed: invalid input was rejected before writes; foreign scope returned `CLINIC_ACCESS_FORBIDDEN` |
| Manager Tools invalid/foreign scope `101836` / `101842` | Passed: both paths rejected before provider access |
| Outbound Batches published foreign scope `101851` | Passed: explicit `CLINIC_ACCESS_FORBIDDEN`, with no Retell or mutation node execution |
| SMS Follow-Ups scheduled validation `101837` | Passed safely: zero jobs inserted/cancelled and no job claimed or sent |
| SMS Follow-Ups live scheduler `103300` | Passed safely: queue/no-show guard sequence completed in 580 ms with zero output; Twilio was not reached |
| Settings malformed-input production execution `101861` | Passed: validation rejected missing tenant ID before any database/provider node |
| Active production webhook audit | Passed: every API-readable active workflow webhook uses Header Auth; browser inspection confirmed the same for Knowledge Base |

## Changes Made

- Applied and verified `prisma/migrations/20260828000000_add_clinic_advisor_storage/migration.sql`.
- Applied and verified `prisma/migrations/20260903000000_scope_advisor_memory_jobs/migration.sql` through the authorized migration runner (`103310`), with read-only catalog verification (`103312`).
- Recorded the verified migration in Prisma's ledger.
- Unpublished `RivaCare Database Migration Runner - MANUAL` to prevent public webhook-triggered schema writes.
- Unpublished `Juvonno AI Receptionist - PRODUCTION PATIENT IDENTITY HARDENED v2 2026-08-21` because it trusted request-controlled tenant/clinic scope; its saved inactive draft now requires `RivaCare Dashboard Auth` Header Auth.
- Unpublished `Juvonno INBOUND - PRODUCTION MULTICLINIC` because Retell-facing webhooks did not verify sender identity before trusting tenant/clinic scope.
- Staged Header Auth with the existing `RivaCare Dashboard Auth` credential on both Retell-facing Inbound webhook nodes; kept the workflow unpublished pending BFF gateway configuration and verification.
- Added a fail-closed BFF Retell gateway with raw-body HMAC verification and authenticated downstream forwarding configuration.
- Added signed, fail-closed BFF routes for outbound Retell `call_analyzed`, call-context events, and the separate Receptionist custom-function target (`N8N_RETELL_RECEPTIONIST_URL`).
- Hardened the BFF inbound Retell route to resolve exactly one active clinic by signed destination phone, discard all payload-supplied tenant/client/clinic values, and forward only canonical internal scope.
- Separated dashboard inbound Overview from the contained Retell-ingestion workflow: BFF now reads only the session-authorized tenant/clinic billing summary and returns explicit unavailable data if no billing row exists.
- Separated dashboard outbound Overview from the active Outbound workflow's mismatched overview branch: BFF now reads only the session-authorized tenant/clinic `outbound_billing_months` summary and returns explicit unavailable data if no billing row exists.
- Corrected and published the active Outbound workflow's native Overview formatter to recognize `query.tenant_id`, retaining compatibility for authenticated direct n8n clients as well as the BFF path.
- Published Outbound version `0376c77f-c02c-4eec-ab6a-a5f5f68fcec1` to replace stale operator guidance that directed Retell to n8n and accepted caller-supplied tenant/clinic metadata. The note now directs Retell analysis/context through the signed BFF gateways, requires authenticated internal forwarding, and documents fail-closed behavior.
- Restored the server-only BFF target configuration for the active Knowledge Base submission queue; no credential value or application data was exposed.
- Restored the documented server-only target configuration for active SMS status and Outbound Batch BFF integrations; verification used only read-only paths.
- Separated Inbound dashboard calls, transcripts, and analytics from the contained Retell-ingestion workflow using parameterized tenant/clinic BFF reads and tested formatters.
- Separated Inbound dashboard invoice history from the contained workflow using a parameterized tenant/clinic BFF read.
- Added a trusted-scope camel-case compatibility alias to BFF n8n GET transport, repairing the active Outbound dashboard formatters without accepting browser-provided authority.
- Required owner/admin at the BFF for outbound-batch list/get endpoints and published the matching n8n list-scope correction (`a041fa76-9685-4a34-bf76-1292caaddd85`).
- Required owner/admin at the BFF for every Payment Recovery mutation and settings route; the workflow remains contained until its provider connection is repaired.
- Updated the unpublished Payment Recovery draft so incomplete clinic configuration is skipped rather than failing the entire scheduled sync.
- Required owner/admin at the BFF for Appointment Request approve, reject, assign, and archive actions.
- Added tested public Settings response redaction for legacy or accidentally stored credential-shaped JSON fields.
- Restricted Knowledge Base website submissions to public HTTPS DNS hostnames; credentialed, localhost/local-only, and IP-literal URLs are rejected before n8n queueing.
- Unpublished `JUVONNO Retell Batch Calls` after confirming its unauthenticated public contact-batch trigger could forward tasks to Retell's batch-call API.
- Added this report and `BACKEND_PRODUCTION_READINESS.md`.

## External Blockers

1. The selected vendor-facing architecture is Retell → n8n → dashboard/Juvonno. The direct n8n routes are now active: phone inbound routing `/webhook/retell-inbound-clinic-router`, all seven Receptionist functions `/webhook/juvonno-receptionist`, and agent-level `call_analyzed` `/webhook/juvonno`. The operator confirmed Retell-side configuration, but a controlled live callback must still prove that the attached phone maps uniquely to one active clinic and that the expected `call_inbound` response reaches Retell. Before that test, revise the router's active-destination lookup to detect more than one matching row explicitly instead of relying on `LIMIT 1`; its existing database uniqueness constraint remains the primary invariant. Do not use the clinic's dedicated Retell agent ID as tenant authority.
2. Execute and record safe, authorized end-to-end tests for every remaining active primary n8n production workflow.
3. Run a controlled, safe Payment Recovery sync and authenticated dashboard test for the saved incomplete-clinic skip behavior before republication; configure `clinic_001/rehab-ontario` if it is intended to participate.
4. Redesign the contained `JUVONNO Retell Batch Calls` workflow behind a BFF-owned authorization and tenant/clinic-scope boundary before any republication.
5. Perform an authenticated live dashboard smoke test for login, clinic scope, Advisor, calls, transcripts, analytics, settings, and error states.

## Demo Readiness

Not yet ready for creation of a demo user. Database readiness is confirmed; workflow and authenticated end-to-end validation remains required.
