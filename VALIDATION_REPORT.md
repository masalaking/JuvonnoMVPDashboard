# RivaCare Revenue Intelligence Advisor — Updated Production Validation

Validated: 2026-08-29

## Final verdict: Not Production Ready

The repository and deployed n8n workflow now contain the expanded,
deterministic analytics layer. All ten new read-only analytics actions were
successfully exercised against an authorized live scope on 2026-08-29, and a
foreign-scope request was rejected. Production readiness remains unproven
because recommendation storage cannot yet be verified from this checkout and
the required synthetic full-chat validation has not been run.

## Migration status

The prepared migration is additive and non-destructive:

- Existing Advisor tables use `CREATE TABLE IF NOT EXISTS`, so they are not
  altered or dropped.
- `advisor_recommendations` is the only missing table it creates. It has a UUID
  primary key, `tenant_id`, a composite `(tenant_id, clinic_id)` foreign key to
  `clinic_configs`, status/date constraints, and tenant/clinic/review indexes.
- It uses cascade deletion only when the owning tenant or clinic is deleted.
- Live schema inspection confirmed the pre-existing Advisor tables are text-ID
  tables. The new recommendation table does not reference those IDs, so the
  differing ID type is compatible.
- Live catalog inspection confirmed an existing active-memory HNSW index on
  `embedding vector_cosine_ops` (`advisor_memories_vector_hnsw_idx`). The
  migration now checks the index definition before creating its own HNSW index,
  preventing a redundant expensive vector-index build when that legacy index
  is present.

The operator executed the migration SQL successfully in the n8n runtime on
2026-08-29 (provided execution screenshot). This checkout can no longer make
a direct verification connection: its configured `DIRECT_DATABASE_URL` points
to an unreachable `db.prisma.io:5432` host, and Prisma therefore reports the
migration pending against that different/unreachable connection. This is not
evidence that the n8n runtime migration failed; it means the target table,
indexes, and recommendation API cannot yet be independently verified here.

An operator with the dedicated migration account should run, in the intended
staging/production environment:

```powershell
$env:DIRECT_DATABASE_URL = $env:MIGRATION_DATABASE_URL
npx prisma migrate status --schema prisma/schema.prisma
npx prisma migrate deploy --schema prisma/schema.prisma
node scripts/verify-advisor-recommendation-storage.mjs --require-ready
```

`scripts/verify-advisor-recommendation-storage.mjs` is read-only. It verifies
the table, required columns, UUID primary key, tenant and tenant/clinic foreign
keys, baseline-date check, status default, two recommendation indexes, and all
six existing Advisor storage tables. Its `--require-ready` mode exits non-zero
if any requirement is absent. Run it with the dedicated migration or a
dedicated read-only verification credential, then run create/read/update/
foreign-scope tests in a non-production tenant before enabling the
recommendation UI.

## Implemented analytics

The existing read-only n8n Advisor workflow generator now embeds one shared
deterministic analytics module. The new structured operations are:

- `advisor.capacity_utilization`
- `advisor.cancellation_rebooking`
- `advisor.no_show_analytics`
- `advisor.call_conversion`
- `advisor.call_themes`
- `advisor.retention`
- `advisor.retention_cohorts`
- `advisor.appointment_frequency_changes`
- `advisor.engagement_risk`
- `advisor.revenue_risk`
- `advisor.recommendation_tracking` (BFF-backed, tenant/clinic scoped)
- `advisor.recommendation_measurement` (BFF-backed, tenant/clinic scoped;
  returns the same stored, non-causal before/after measurement as tracking)

The chat tool contract includes these operations and explicitly directs the
model to respect structured nulls and data-quality limits. Counts, percentages,
intervals, funnel stages, category separation, and recommendation changes are
calculated outside the LLM.

For substantive owner questions, the contract also directs concise
finding/evidence/financial-impact/action/measurement answers when the
structured result supports those sections. It prioritizes supported issues by
revenue magnitude, then affected patients or appointments, urgency,
confidence, recoverability, and ease of action; it does not invent a value in
order to rank an issue.

### Key behavior

- Cancellation recovery distinguishes cancelled/canceled, rescheduled,
  no-show, and later active booking statuses.
- No-show analytics supplies overall, practitioner, service, weekday, hour,
  and booking-lead-time rates with null-safe denominators.
- When a verified availability feed is connected, capacity output now includes
  total/unused minutes and slot counts plus practitioner, service, and weekday
  breakdowns. It accepts both `duration` and `duration_minutes` source fields;
  source-backed revenue opportunity remains `null` unless every supplied slot
  carries an explicit source-backed opportunity value.
- Retention/cohort and engagement-risk analyses are business-engagement only.
  Aggregate risk examples omit patient identifiers; an individual drill-down
  remains a specific-patient query.
- Appointment-frequency analysis now returns previous/recent interval,
  percentage change, days since the most recent completed visit, recent
  cancellation/no-show counts, and future-booking status as de-identified
  aggregate signals. It requires at least three completed appointments and
  reports insufficient history rather than inventing a pattern.
- Call funnel/theme classification uses bounded, tenant-scoped call summaries
  or excerpts. A completed call is not treated as an appointment created
  without an explicit booking signal. Ambiguous calls remain unclassified.
- Revenue risk keeps confirmed no-show value, recoverable cancelled value,
  future revenue at risk, and capacity opportunity as separate categories.
  Missing source-backed price stays `null`, never zero or an estimate.
- Recommendation measurement compares stored baseline/current values and says
  a metric changed after implementation; it never claims causation.

## Tool/workflow deployment

Generated local workflow artifact:

`C:\Users\aarya\Documents\Codex\2026-08-06\i-o\outputs\RivaCare AI Clinic Advisor Production 2026-08-27\RivaCare Manager Analyst Tools - RAG PRACTITIONER REVENUE AND LEAKS.json`

The deployment sequence, dedicated-migration verification, and opt-in scoped
n8n acceptance probe are also documented in `ADVISOR_DEPLOYMENT_HANDOFF.md`.

The artifact contains a read-only, role-checked SQL query. Call records are
bounded to 500 and join through verified `(tenant_id, clinic_id)` scope. The
existing Juvonno appointments request remains bounded to 100 records; every
new appointment-derived result returns `source_limits` and flags a possibly
incomplete result at that boundary.

After the operator imported and activated the workflow, all ten live actions
returned successful structured responses in a fresh authorized read-only probe:
capacity, cancellation/rebooking, no-show analytics, call conversion, call
themes, retention, cohorts, appointment-frequency changes, engagement risk,
and revenue risk. A request with a deliberately unauthorized clinic ID
returned `CLINIC_ACCESS_FORBIDDEN` and no data.

## Tests and validation

| Check | Result |
| --- | --- |
| Existing Advisor/encryption/memory/scope tests | Pass |
| New deterministic analytics tests (cancellation, no-show, retention, risk, 100%/0%/partial capacity, funnel, themes) | Pass |
| New recommendation measurement tests | Pass |
| New-action tenant scope clipping tests | Pass (all 11 added actions) |
| Frequency-change and engagement-risk tests | Pass (increasing/stable/decreasing/insufficient history; cancellation signal) |
| Follow-up conversation-context contract test | Pass (prior finding and “Why?” retained) |
| Existing revenue workflow fixture | Pass |
| Expanded generated-workflow fixture | Pass |
| Prisma schema validation | Pass |
| Frontend production build | Pass |
| Authorized live read-only appointment/revenue-leak workflow calls | Pass |
| Invalid foreign tenant/clinic live workflow call | Pass (`CLINIC_ACCESS_FORBIDDEN`, no data) |
| Live new analytics operations | Pass (all 10 return structured data) |
| Live recommendation table | Migration executed in n8n runtime; direct verification pending correct target DB connectivity |
| Read-only recommendation storage verifier | Ready; cannot connect from this checkout’s current `DIRECT_DATABASE_URL` |

The current automated suite contains 26 passing Node test cases, followed by
passing deterministic revenue-calculation and generated-workflow regressions.
The frontend production build and Prisma validation also pass.

## End-to-end conversations

The deployed n8n workflow now accepts the new actions. A deterministic
conversation-contract test also passes: a prior cancellation-recovery finding
plus the follow-up “Why?” is sent together to the Advisor, which selects the
bounded cancellation/rebooking operation. This verifies context propagation
and scope/date bounding only; it does **not** substitute for the required
synthetic staging conversation matrix.

## Security and performance

- Explicit foreign-only clinic selections remain empty and are rejected; they
  do not broaden to all authorized clinics.
- The generated SQL joins every call-record read to verified scope and does not
  accept a browser-supplied tenant as authority.
- Recommendation reads/updates include both tenant and clinic scope in their
  SQL paths. Live recommendation isolation still requires migration plus a
  staging test.
- Calls are capped at 500 and Juvonno appointment results at 100. This avoids
  unbounded reads but means six-month cohorts may be incomplete until paginated
  Juvonno ingestion is implemented.

## Remaining limitations and blockers

1. Run `scripts/verify-advisor-recommendation-storage.mjs --require-ready`
   from the actual migrated database environment, then perform create/read/
   update/status-transition/foreign-scope tests using test-only records.
2. Configure a non-production tenant with safe synthetic appointments,
   schedules/availability, calls, transcripts, and recommendations; then run
   the full chat conversation matrix there.
3. Connect a verified schedule-availability source. The current Juvonno
   request exposes booked minutes but not total available minutes, so capacity
   utilization and unused capacity correctly return unavailable instead of
   fabricated values. Once available, map that source's explicit slot and
   source-backed opportunity fields into the existing structured workflow.
4. Add paginated appointment ingestion for reliable six-month and longer
   retention/cohort calculations.

Only after these deployment and source-data actions succeed can the Advisor be
revalidated for a production-ready verdict.
