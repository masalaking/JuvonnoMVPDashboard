# RivaCare Advisor Deployment Handoff

Branch: `codex/rivacare-advisor-production-readiness`

Authorized n8n workflow only:

- ID: `mjqdQeMG5K6qzmHv`
- Name: `RivaCare Manager Analyst Tools - RAG PRACTITIONER REVENUE AND LEAKS`
- Active/current version: `0577d716-ae2d-47aa-aad0-a4b82e2b34cc`
- Active graph: 12 nodes, one copy of each expected node

Generated workflow artifact:

`C:\Users\aarya\Documents\Codex\2026-08-06\i-o\outputs\RivaCare AI Clinic Advisor Production 2026-08-27\RivaCare Manager Analyst Tools - RAG PRACTITIONER REVENUE AND LEAKS.json`

SHA-256:

`943E95B37E03114073624581B25C8CD2D874A3F604308D1674DE4B96AD9D98C1`

The rebuilt graph retains exactly 12 nodes with 12 unique names. The old canvas
nodes were deleted, the artifact imported, the Webhook and Postgres nodes each
opened and closed once, and version
`0577d716-ae2d-47aa-aad0-a4b82e2b34cc` published. No other workflow was touched.

## Completed and verified

- Target recommendation migration and catalog verification passed (`ready: true`; migration execution `93665`).
- Authorized target-database recommendation create/read/update/status/measurement and tenant/clinic isolation passed; all temporary QA records/scopes were cleaned and absence reverified.
- Live fictional-tenant denial stopped before Juvonno (execution `93679`), and
  the published workflow denial was rerun on 2026-08-30 with fixed fictional
  identifiers only: `CLINIC_ACCESS_FORBIDDEN`, zero sources.
- Appointment fan-out, bounded 20×100 pagination, de-duplication, partial labeling, Juvonno `customer.id`/`customer.num` mapping, and verified daily schedule availability are active.
- Complete live one-day capacity and live 30/90/180-day/six-month appointment pagination passed. High-volume availability days remain explicitly partial at the Juvonno 100-result cap.
- Historical appointment context is active for retention, cohorts, frequency changes, and engagement risk. Fetch dates and analysis dates are separately exposed in source metadata.
- Before publishing, the old graph was removed, the updated 12-node graph imported, and the Webhook and Postgres nodes were each opened and closed once to refresh credential binding. The workflow record, URL, and every other n8n workflow were untouched.
- Post-change validation passed: 46 Node tests, deterministic revenue and generated-workflow regressions, Prisma schema validation, and frontend production build. The only build note is the existing non-blocking bundle-size warning.
- Remaining live capacity, cancellation/rebooking, no-show, call conversion/theme, and revenue-risk probes passed. The 31-day capacity result correctly remained partial at the source cap and did not invent opportunity dollars.
- All eight authenticated UI conversation chains passed through the signed-session/CSRF BFF, `gpt-5.1` with `store: false`, the published structured workflow, live sandbox sources, and the rendered UI.
- The capacity chain exposed and then verified a fix for visible partial-source disclosure: the BFF now adds a deterministic coverage warning when the model omits it.
- Recommendation measurement passed in a marker-guarded isolated synthetic scope; cleanup removed the seeded recommendation and both temporary tenants, and final scope discovery returned zero candidates.

## Published partitioned-history validation

The live historical-context cohort probe succeeded but retrieved exactly 2,000 appointments across all 20 pages. It returned:

- `fetch_status: partial_max_page_limit`
- `results_may_be_incomplete: true`
- historical fetch start `2000-01-01`
- requested analysis window preserved
- patient-identifier coverage `100%`
- duplicate records removed `0`

This was correct fail-safe behavior for the prior version and established why a
single bounded all-history query was insufficient.

The rebuilt candidate now implements adaptive 24-month partitions with a
one-day overlap, 20 pages per window, deterministic merge/de-duplication, and
execution-wide ceilings of 300 requests and 25,000 accepted records. Focused
regressions pass for complete partitions, overlapping-window de-duplication,
failed windows, and both global ceilings. All 46 Node tests, revenue/workflow
regressions, Prisma validation, the production build, target catalog readiness,
and guarded target-DB CRUD/isolation checks also pass after the rebuild; the QA
scope was cleaned and absence reverified.

The first published partitioned build exposed a deployment-only Code-node helper
binding mismatch: `$helpers.httpRequest` was unavailable at runtime even though
the isolated harness injected it. The generator now binds n8n's actual
`this.helpers.httpRequest` context with a harness fallback, and the regression
suite explicitly executes that runtime-shaped context. Version
`0577d716-ae2d-47aa-aad0-a4b82e2b34cc` contains the fix.

Live sandbox probes now pass for retention, cohorts, appointment-frequency
changes, and engagement risk. Each returned `fetch_status: complete`, 14/14
complete windows, 49/49 received pages, 3,977 records before de-duplication,
3,973 appointments after removing four boundary duplicates, zero failed,
missing, or capped windows, and zero records without a stable appointment ID.
Neither the 300-request nor 25,000-record execution ceiling was reached.

## Production-readiness disposition

All release blockers are closed. The deployment is **Production Ready with a documented capacity-coverage limitation**: Juvonno can cap high-volume availability days at 100 results, so those capacity responses are visibly marked partial. Unused-capacity opportunity dollars remain unavailable unless a source supplies a defensible monetary value.

The user confirmed all connected Juvonno clinics are sandboxes and authorized temporary synthetic QA tenants/clinics in the target database with complete cleanup afterward. Do not expose or repeat database/API credentials in reports or prompts.
