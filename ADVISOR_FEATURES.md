# RivaCare Revenue Intelligence Advisor — Living Feature Reference

Last updated: 2026-08-30

This document is the canonical description of the Advisor's current behavior. It distinguishes code that exists from behavior proven in the target database, active n8n workflow, Juvonno sandbox, or complete application path. Update it whenever an Advisor capability, source, limitation, or validation result changes.

## 1. Overview

The RivaCare Revenue Intelligence Advisor is a read-only clinic business assistant for authorized owners and administrators. It answers operational and revenue questions by combining server-authorized scope, structured n8n/Juvonno/PostgreSQL reads, deterministic analytics, and a conversational model. It can create and update Advisor recommendation records only through explicit owner/admin API actions; it does not mutate Juvonno or automatically contact patients.

Current release verdict: **Production Ready with a documented capacity-coverage limitation**. Recommendation storage and isolation, live appointment pagination, patient-key mapping, bounded partitioned history, post-publication analytics, fictional-scope denial, and the complete authenticated application conversation matrix are validated. The active 12-node workflow is n8n version `0577d716-ae2d-47aa-aad0-a4b82e2b34cc`. High-volume availability days remain explicitly partial when Juvonno reaches its daily 100-result cap, and capacity opportunity dollars remain unavailable without a source-backed monetary value.

## 2. Status Legend

| Status | Meaning |
| --- | --- |
| ✅ Production Validated | Verified in the actual target system or target database with relevant safety checks |
| 🟢 Implemented | Implemented and locally tested, but not yet fully validated in the complete deployed path |
| 🟡 Partial | Useful behavior exists, with a known coverage, source, or completeness limitation |
| 🧪 Validation Required | Implementation exists but required live or end-to-end validation remains |
| 🔴 Blocked | A release-blocking dependency or validation is missing |
| ⚪ Planned | Intentionally planned but not implemented |
| ⛔ Deprecated | Retained only for historical reference and must not be used |

## 3. Revenue Intelligence

Status: ✅ Production Validated.

- Provides overview and period comparison metrics.
- Reports billed, collected, owing, and unassigned amounts separately.
- Supports practitioner revenue and practitioner comparison without assigning unlinked or multi-practitioner money to a provider.
- Identifies measurable revenue-leak signals: open and aging receivables, completed appointments without a linked invoice, no-shows, late cancellations, and cancellations.
- Separates confirmed source-backed loss, recoverable revenue, revenue at risk, and revenue opportunity.
- Leaves unsupported monetary values `null`/unavailable. It does not convert a count into dollars without source-backed value.

## 4. Scheduling and Capacity

Status: 🟡 Partial.

- Uses Juvonno `GET /api/appointments/availability/{branchCode}` with clinic-scoped, daily requests, `available_only=true`, and `max_results=100`.
- Normalizes source slots and derives duration only from adjacent source times; an isolated slot does not receive an invented duration.
- Calculates total capacity as explicit open-slot minutes plus source-backed booked appointment minutes, and utilization as booked minutes divided by total capacity.
- Live one-day validation passed with 74 source slots, 995 total minutes, 0 booked minutes, 995 unused minutes, and 0% utilization.
- A live seven-day run calculated 8,450 total minutes, 615 booked minutes, and 7,835 unused minutes, but is correctly marked partial because six daily responses reached Juvonno's 100-result cap.
- A live 31-day run returned 35,610 total available minutes, 1,305 booked minutes, 34,305 unused minutes, and 3.6647% utilization. It correctly reported partial coverage because 29 daily responses reached the cap and 10 isolated slots lacked a source-derived duration.
- The authenticated UI deterministically prefixes a visible data-coverage warning when a structured source is partial, even if the model omits the limitation.
- Capacity opportunity dollars remain unavailable unless the source supplies a defensible monetary value.

## 5. Cancellation and Rebooking Intelligence

Status: ✅ Production Validated.

- Counts cancelled/canceled appointments and distinguishes them from rescheduled or late-cancellation statuses.
- Detects a subsequent active booking only when the same stable patient identifier is available.
- Reports known rebooked and not-rebooked counts, service/practitioner breakdowns, and source-backed recoverable revenue where available.
- Returns an explicit data-quality warning when a stable patient identifier is missing.
- Does not infer cancellation reasons.

## 6. No-Show Intelligence

Status: ✅ Production Validated.

- Uses completed/arrived plus no-show appointments as the deterministic rate denominator.
- Reports overall count/rate and practitioner, service, day-of-week, appointment-hour, and booking-lead-time breakdowns when the required fields exist.
- Treats `no-show` and `no show` as equivalent source-status variants.
- Does not claim causation or invent a dollar impact.

## 7. Call Intelligence

Status: ✅ Production Validated.

- Reports call counts, booking conversion, bounded call-theme summaries, and specific transcript details.
- A booking is counted only from an explicit structured booking signal.
- Deterministic theme rules currently recognize price, insurance, location/accessibility, clinic hours/evening/weekend, requested-time unavailable, requested-practitioner unavailable, service unavailable, patient indecision, competitor comparison, technical issue/disconnection, convenient time, and practitioner preference/referral.
- Ambiguous evidence remains `unknown`; the Advisor does not infer sentiment or reasons.
- Transcript detail requires a specific Retell call ID, phone number, or named patient with a narrow date range. Bulk transcript dumps are prohibited.

## 8. Retention and Cohort Intelligence

Status: ✅ Production Validated.

- Calculates 30-, 60-, 90-, and 180-day repeat-visit measures from completed appointments with stable patient identifiers.
- Reports second- and third-appointment cohort return measures and service cohort breakdowns.
- Six-month appointment pagination is safely bounded to 20 pages of 100 records per clinic/query, with ID de-duplication and partial-source metadata.
- Live 30/90/180-day and six-month pagination passed with 35/135/348/350 records, 20/20 bounded requests, complete source status, and zero duplicates.
- The active n8n version recognizes Juvonno `customer.id`/`customer.num`; live patient-identifier coverage is 100% for those ranges.
- Correctly classifying a patient as truly new requires appointment history before the requested analysis window. Prior version `95eafe1a-aefc-4131-bd12-6c4813815620` introduced historical context from `2000-01-01` while preserving the requested analysis dates; current version `0577d716-ae2d-47aa-aad0-a4b82e2b34cc` partitions that context safely.
- The first live historical-context probe on the prior version returned 2,000 appointments across 20/20 pages and correctly reported `partial_max_page_limit`, proving the single-query bound was insufficient.
- The workflow generator now implements adaptive 24-month historical partitions with a one-day boundary overlap. Each partition stops after the first response below Juvonno's documented 100-result maximum and remains capped at 20 pages. Focused generated-workflow regressions pass for complete partitions and adaptive stopping.
- Historical records are merged in deterministic window/page order and de-duplicated by the stable Juvonno appointment ID across pages and overlapping windows. The overlapping-window regression removes the synthetic boundary duplicate exactly once.
- Execution-wide safety ceilings are 300 historical Juvonno requests and 25,000 accepted appointment records. Failed/missing/capped windows, missing appointment IDs, or either global ceiling produce an explicit partial source status. Regressions pass for a failed window, the 300-request stop, and the 25,000-record stop.
- Live retention, cohort, frequency-change, and engagement-risk probes all pass with complete source status: 14/14 windows, 49/49 pages, 3,977 records before de-duplication, 3,973 after removing four boundary duplicates, no missing stable IDs, and no failed/missing/capped windows or global ceiling.
- The deployed Code-node request helper uses n8n's runtime `this.helpers.httpRequest`; the harness now includes a runtime-shaped regression so an injected `$helpers` test double cannot mask this deployment mismatch again.

## 9. Patient Engagement Risk

Status: ✅ Production Validated.

- Produces operational engagement signals from appointment frequency, gaps, future bookings, recent cancellations, and recent no-shows.
- Classifies deterministic operational risk as low, moderate, or high and supplies source-derived reasons.
- Aggregate questions (for example, “How many patients are high engagement risk?”) remain de-identified and return counts and signal summaries only.
- An owner/admin who explicitly asks who or which patients are at risk receives a tenant- and clinic-scoped patient drill-down through `advisor.engagement_risk_patients`. It returns only a source-backed full name, or a chart-number label when no name is available; internal database IDs are never returned.
- Drill-down results include the supported interval change, time since last completed visit, recent cancellations/no-shows, future-booking state, and plain-language risk reasons. High-risk patients are ranked by the strength of these visible signals, not an unexplained score.
- Follow-ups such as “Which patients?” after an aggregate answer are treated as an explicit authorized drill-down request.
- The Advisor leads with the answer, uses short conversational explanations and concrete rebooking suggestions, and does not add unnecessary privacy disclaimers or report-style sections.
- These are business engagement indicators only; they are not clinical risk, diagnosis, prognosis, or treatment advice.

## 10. Risk Mitigation

Status: ✅ Production Validated.

- Prioritizes supported issues by source-backed revenue magnitude, affected patients/appointments, urgency, confidence, recoverability, and ease of action.
- Recommendations are advisory and read-only with respect to Juvonno.
- The Advisor never sends calls, SMS messages, emails, appointment changes, or payment actions automatically.
- Owners/admins must explicitly accept, implement, monitor, decline, or revert a stored recommendation.

## 11. Recommendations and Progress Tracking

Status: ✅ Production Validated for storage, CRUD/status transitions, measurement, isolation, and the authenticated chat path.

- Stores category, title, problem, evidence, baseline window/metric, recommended action, target metric/improvement, dates, current metric, financial estimate, result status, and sources.
- Supported lifecycle statuses are `suggested`, `accepted`, `in_progress`, `implemented`, `monitoring`, `improved`, `no_change`, `declined`, and `reverted`.
- Compares stored baseline and current metric values and describes improvement or no improvement after implementation. It explicitly does not establish causation.
- The actual target PostgreSQL catalog, constraints, indexes, defaults, and related Advisor tables returned `ready: true`.
- Authorized synthetic QA CRUD, status, measurement, foreign-tenant, and foreign-clinic tests passed. All temporary rows, clinics, users, and tenants were removed and absence was reverified.
- These target-database checks were rerun after the partitioned-history artifact build: catalog readiness remained true; every guarded CRUD/isolation assertion passed; marker-bounded cleanup removed the two temporary tenants; and the final scope search returned zero candidates.

## 12. Prioritization Logic

Status: ✅ Production Validated.

When several supported issues compete, the response prioritizes:

1. Source-backed revenue magnitude.
2. Number of affected patients or appointments.
3. Urgency.
4. Evidence confidence and completeness.
5. Recoverability.
6. Ease of action.

Recency alone is not a ranking rule. Missing or non-comparable financial values remain unavailable and are not converted into synthetic scores.

## 13. Chat and Conversation Behavior

Status: ✅ Production Validated.

- Preserves recent conversation context and answers follow-up questions naturally.
- Clips model-requested clinic IDs and dates to the server-authorized session scope.
- Limits each model response to three structured tool calls and four model turns.
- Requires structured tool evidence for live operational, financial, appointment, transcript, practitioner, or patient claims.
- Renders source metadata separately and avoids exposing internal tool names or implementation details in the answer.
- Uses encrypted conversations/messages and bounded semantic memory. Memory cannot override live source data or safety rules.
- The eight-chain deterministic offline orchestration matrix and the complete authenticated Frontend → signed-session/CSRF BFF → `gpt-5.1` (`store: false`) → structured tool → n8n → Juvonno/PostgreSQL → model → UI matrix both pass.
- The capacity chain initially exposed a missing visible partial-coverage warning. The BFF now adds that warning deterministically, its regression passes, and the full chain was rerun successfully.

## 14. Structured Action Inventory

All actions are read operations. Common inputs are authorized `clinic_ids`, `start_date`, and `end_date`; the BFF replaces model-supplied scope and dates with the session-authorized values. `patient_identifier`, `detail_identifier`, or `practitioner_identifier` is required only where noted.

| Action | Purpose | Additional input / principal output | Current status |
| --- | --- | --- | --- |
| `advisor.overview` | Clinic operational overview | Summary appointment, call, and financial metrics | 🟢 Implemented |
| `advisor.compare_periods` | Compare requested period with prior period | Period deltas and source metadata | 🟢 Implemented |
| `advisor.call_metrics` | Aggregate call activity | Call totals and structured outcomes | 🟢 Implemented |
| `advisor.appointment_metrics` | Aggregate appointment activity | Counts and status breakdowns | 🟢 Implemented |
| `advisor.appointment_lookup` | Locate appointments | Specific search terms within authorized scope | 🟢 Implemented |
| `advisor.appointment_details` | Retrieve one appointment context | Requires `detail_identifier`; bounded detail | 🟢 Implemented |
| `advisor.call_transcript_details` | Retrieve one call/transcript context | Requires `detail_identifier`; no bulk dump | 🟢 Implemented |
| `advisor.practitioner_revenue` | Attribute practitioner revenue safely | Requires `practitioner_identifier`; billed/collected/owing/unassigned | 🟢 Implemented |
| `advisor.practitioner_comparison` | Compare practitioner performance | Source-backed practitioner metrics | 🟢 Implemented |
| `advisor.revenue_leaks` | Identify measurable revenue leakage | Receivables, unbilled visits, no-shows, cancellations | 🟢 Implemented |
| `advisor.invoice_metrics` | Summarize invoices | Billed, owing, status, and linkage metrics | 🟢 Implemented |
| `advisor.receivables` | Analyze outstanding balances | Open/aging receivables | 🟢 Implemented |
| `advisor.payment_recovery` | Identify recoverable payment work | Source-backed recovery queue/amounts | 🟢 Implemented |
| `advisor.staff_queue` | Summarize staff work queue | Authorized operational queue data | 🟢 Implemented |
| `advisor.automation_health` | Report automation state | Workflow/source health signals | 🟢 Implemented |
| `advisor.clinic_configuration` | Read clinic configuration | Authorized clinic configuration only | 🟢 Implemented |
| `advisor.patient_lookup` | Answer an explicit patient question | Requires `patient_identifier` of at least five characters | 🟢 Implemented |
| `advisor.recommendation_tracking` | List stored recommendations | Optional stored status filtering | ✅ Storage validated |
| `advisor.recommendation_measurement` | Compare stored baseline/current metrics | Non-causal change interpretation | ✅ Production Validated |
| `advisor.capacity_utilization` | Calculate capacity and utilization | Verified availability plus booked appointments | 🟡 Partial |
| `advisor.cancellation_rebooking` | Measure cancellation/rebooking | Stable patient identity and source-backed value | ✅ Production Validated |
| `advisor.no_show_analytics` | Analyze no-show patterns | Deterministic denominator and breakdowns | ✅ Production Validated |
| `advisor.call_conversion` | Measure explicit call-to-booking conversion | Explicit structured booking evidence | ✅ Production Validated |
| `advisor.call_themes` | Summarize deterministic call themes | Bounded rules; ambiguous is unknown | ✅ Production Validated |
| `advisor.retention` | Measure return behavior | Historical completed visits with stable patient ID | ✅ Production Validated |
| `advisor.retention_cohorts` | Measure new-patient second/third visits | Historical context plus analysis window | ✅ Production Validated |
| `advisor.appointment_frequency_changes` | Detect visit-frequency change | Historical intervals and requested analysis window | ✅ Production Validated |
| `advisor.engagement_risk` | Classify operational engagement risk | Frequency/gap/future-booking/cancellation/no-show signals | ✅ Production Validated |
| `advisor.engagement_risk_patients` | List explicitly requested high-engagement-risk patients | Authorized clinic-scoped display name/chart label plus source-backed risk signals; no internal IDs | 🟢 Implemented |
| `advisor.revenue_risk` | Prioritize supported loss/recovery/risk signals | Source-backed categories and nullable values | ✅ Production Validated |

## 15. Security and Privacy

Status: ✅ Production Validated.

- Access requires an authenticated owner or administrator with at least one authorized clinic.
- Tenant, user, clinic, and date scope are derived or clipped server-side; model arguments cannot widen them.
- Recommendation reads/updates require both tenant and clinic predicates. Foreign-tenant and foreign-clinic tests passed in the target database.
- Appointment and transcript detail require a specific identifier; bulk transcript access is not permitted.
- Conversations, messages, and memories are encrypted with AES-GCM at rest when the required key is configured.
- Audit metadata hashes sensitive identifiers; recorded tool arguments redact patient/detail identifiers.
- Semantic memory is tenant/user/clinic scoped, bounded, and excludes credentials, contact details, dates of birth, raw transcripts, temporary metrics, and unverified claims.
- Database text, transcripts, and memories are treated as untrusted data, never instructions.

## 16. Data Quality and Evidence Rules

Status: ✅ Production Validated.

- `null`/unavailable is distinct from confirmed zero.
- Every source can expose completeness, request/page counts, warnings, caps, and deduplication metadata.
- Failed/missing appointment pages or partition windows, a partition reaching the 20-page bound before a short final page, a missing stable appointment ID, or either historical global ceiling marks appointment-derived analytics partial.
- Failed/missing/capped availability days or requests beyond the supported window mark capacity partial.
- Patient-dependent analytics report stable-identifier coverage.
- Monetary claims require source-backed values. Counts are never multiplied by assumed prices.
- The Advisor does not infer cancellation reasons, sentiment, rebooking, themes, clinical outcomes, or causation from missing evidence.

## 17. Current Known Limitations

1. Historical retrieval is intentionally bounded to 20 pages per 24-month window, 300 requests, and 25,000 accepted records per execution. Any reached ceiling is explicitly partial.
2. Juvonno availability is capped at 100 results per daily request; high-volume days remain partial until a verified continuation mechanism is available.
3. No source-backed schedule-slot monetary value is available, so unused-capacity opportunity dollars are not calculated.
4. The recommendation-measurement UI chain used an isolated, marker-guarded synthetic tenant/clinic because the live clinic had no stored recommendation. The scope was deleted and final absence verification returned zero candidates.

## 18. Production Readiness Matrix

| Area | Status | Evidence / remaining gate |
| --- | --- | --- |
| Recommendation schema/storage | ✅ Production Validated | Target catalog `ready: true`; migration execution `93665` |
| Recommendation CRUD/status/measurement | ✅ Production Validated | Authorized synthetic target-DB matrix passed and cleaned |
| Tenant/clinic isolation | ✅ Production Validated | Foreign tenant and clinic rejected; fictional live scope stopped before Juvonno |
| Revenue calculations | ✅ Production Validated | Deterministic/generated-workflow regressions and authenticated revenue-risk chat chain pass |
| Appointment pagination | ✅ Production Validated | Live 30/90/180-day/six-month sandbox runs complete with zero duplicates |
| Juvonno patient identity mapping | ✅ Production Validated | Active workflow uses `customer.id`/`customer.num`; live coverage 100% |
| Retention/cohort correctness | ✅ Production Validated | Published bounded history and all four live historical probes complete; authenticated retention/cohort chains pass |
| Schedule availability | 🟡 Partial | Complete one-day proof; capped high-volume days remain partial |
| Capacity monetary opportunity | 🟡 Partial | No verified per-slot/source monetary value |
| Security regression suite | ✅ Production Validated | Unit/integration controls, fictional-scope denial, authenticated UI scope, and target-DB isolation pass |
| Build/regression suite | ✅ Production Validated | 46 Node tests, generated workflow/revenue regressions, Prisma validation, and production build passed; only the existing chunk-size warning remains |
| Full Advisor conversation matrix | ✅ Production Validated | All eight authenticated UI chains pass through the real model, published n8n workflow, and source systems |
| Final release verdict | ✅ Production Ready | Documented capacity-coverage limitation remains fail-safe and visible |

## 19. Example Questions

- Where am I losing the most money, and what should I fix first?
- Which practitioner has the most unused availability this week?
- How many cancelled patients never rebooked?
- What is our no-show rate, and which lead-time group is highest?
- Why are callers not booking? Show me the specific calls behind the largest supported theme.
- What percentage of genuinely new patients returned for a second and third appointment?
- Are returning patients booking less frequently than before?
- Which patients have high operational engagement risk, and which source signals explain it?
- Did the no-show reminder recommendation improve after implementation?
- How much is outstanding versus confirmed lost versus recoverable?

## 20. Changelog

- **2026-08-29 — Living reference created:** Added the canonical feature/action, security, limitation, readiness, and validation reference.
- **2026-08-29 — Historical cohort context deployed:** Published n8n version `95eafe1a-aefc-4131-bd12-6c4813815620`. The live probe preserved the requested analysis window and exposed a real 2,000-record history cap, correctly returning partial rather than false completeness.
- **2026-08-29 — Juvonno customer identity validated:** Added `customer.id`/`customer.num` as stable internal aggregation keys, retained privacy protections, and live-validated 100% identifier coverage.
- **2026-08-29 — Six-month pagination validated:** Bounded 20×100 pagination, de-duplication, failure/cap detection, and live 30/90/180-day/six-month retrieval passed.
- **2026-08-29 — Schedule availability connected:** Added daily verified Juvonno availability fan-out, live-shape normalization, completeness metadata, and utilization calculations. Complete single-day proof passed; capped high-volume days remain partial.
- **2026-08-29 — Recommendation storage validated:** Applied the target migration, verified schema/constraints/indexes, passed synthetic CRUD/status/measurement/isolation tests, and cleaned all temporary QA data.
- **2026-08-29 — Partitioned history published:** Deleted the old authorized canvas, imported the verified 12-node artifact, refreshed the Webhook/Postgres bindings, and published version `64549523-00e2-4ecc-847c-dba10731c05f`.
- **2026-08-30 — Runtime binding fixed and complete history live-validated:** Corrected the Code-node helper binding, added a runtime-shaped regression, repeated the required delete/import/credential-refresh flow, and published version `0577d716-ae2d-47aa-aad0-a4b82e2b34cc`. All four historical actions returned complete bounded history in the sandbox.
- **2026-08-30 — Production-readiness matrix completed:** Passed the remaining live analytics and fixed-scope denial probes, all eight authenticated UI conversation chains, the capacity partial-warning rerun, recommendation measurement in a cleaned isolated synthetic scope, and the final 46-test/build/Prisma/storage/deployment audit.
- **2026-08-30 — Authorized engagement-risk drill-down and humanized replies:** Added a separate explicit patient-list action, kept aggregate risk answers de-identified, ranked high-risk patients by visible source-backed signals, and updated Advisor guidance/tests for concise, owner-friendly responses and contextual privacy behavior.
# 2026-09-02 migration verification update

The additive Advisor storage migration is now applied and independently verified against the target PostgreSQL database. All Advisor storage tables, tenant/clinic foreign keys, required indexes, and constraints are present, and Prisma migration status is up to date. The dedicated migration runner was unpublished after the successful manual execution because its unauthenticated webhook was unsafe for a schema-write workflow. Future migration use must stay manual or add strong authentication before publishing.

# 2026-09-03 Advisor memory-job tenant-scope update

The additive `20260903000000_scope_advisor_memory_jobs` migration was applied through the authorized manual runner (execution `103310`) and verified with a read-only target-catalog query (`103312`). It backfilled `advisor_memory_jobs.tenant_id` from the parent conversation, rejects any unscopable historical row, makes tenant scope non-null, and adds the tenant FK, composite source-message/conversation/tenant FK, and tenant/status scheduling index. Queue creation and completion now bind their database operations to the server-authorized tenant. The complete Advisor/security/analytics regression suite passes 64 tests with no failures.
