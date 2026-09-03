# Dashboard frontend handoff prompt

Copy the prompt below into Claude Code in the dashboard repository.

```text
You are the frontend engineer for the RivaCare x Juvonno dashboard. Audit the existing dashboard client and make the smallest production-quality changes needed to consume the current backend-for-frontend (BFF) contracts. Begin by inspecting the existing implementation, especially `src/app/App.tsx` and its API helpers. Preserve working behavior; this is not a UI rewrite.

Scope and guardrails

- Change only frontend/dashboard artifacts unless a frontend test or build script requires a tightly related change.
- Do not modify Prisma, PostgreSQL, n8n workflows, backend routes, server authentication, or environment files.
- Do not add mock data, silent zero-value fallbacks, browser-held provider credentials, or direct browser-to-database/n8n calls.
- Continue passing the selected active clinic through the established client mechanism (`clinic_id` and CSRF/session flow). Do not invent, trust, or send a tenant identifier as browser authority: the BFF derives tenant access from the authenticated session and verified clinic membership.
- Keep patient/call data out of console logging, alerts, analytics beacons, and user-visible raw error messages.
- Preserve existing visual design, routing, accessibility, responsive behavior, and the inbound/outbound adapters that already work.

Backend contract now available

All dashboard data is served by authenticated BFF routes below `/api/dashboard`. A successful HTTP 200 with a valid empty collection is an ordinary empty state, not a service failure.

1. Inbound and outbound overview responses expose these billing/dashboard fields:
   `clientName`, `basePrice`, `clientRatePerMin`, `overageRate`, `minutesUsed`, `minutesIncluded`, `remainingMinutes`, `overageMinutes`, `totalCalls`, `overageUSD`, `monthlyTotal`, `avgCallMin`, `avgCallDisplay`, `billingPeriod`, `billingPct`, `billingPctRaw`, `totalRecordings`, `totalTranscripts`.

2. Inbound calls return `{ calls: [...] }`. A call can contain:
   `id`, `call_id`, `date`, `timestamp`, `callerName`, `from`, `duration_min`, `durationDisplay`, `status`, `reason`, `summary`, `hasTranscript`, `hasRecording`, `recordingUrl`, `sentiment`.

3. Outbound calls return `{ calls: [...] }` using the same normalized display fields, but source records may also contain patient/contact fields such as `patientFirstName`, `patientLastName`, `patientName`, `to`, and `to_number`. Retain the existing safe display-name adapter rather than assuming only one provider field name.

4. Inbound and outbound transcripts return `{ transcripts: [...] }`; each transcript may contain a `transcript` array of lines. Render missing transcript content as an intentional empty state.

5. Inbound and outbound analytics (`?range=...`) return an array of `{ label, calls, minutes, completed, missed, avg }` points. A valid empty array should render an empty chart/message, not an API outage.

6. Invoices return `{ invoices: [...] }`, using the existing usage-invoice presentation model.

7. Settings is deliberately a redacted, public-safe configuration projection. Never expect, request, or render connection strings, provider keys, webhook secrets, or password-like fields.

8. Knowledge-base submissions return `{ success, count, submissions }`; batches return `{ success, count, batches, ... }`; SMS status is normalized and safe for display. Support these envelopes as well as any already-supported legacy array form only where it remains necessary for compatibility.

Required work

1. Audit API response handling. Ensure success/failure is determined by `response.ok` plus the expected contract shape—not by whether an array has rows or a usage metric is nonzero. A 200 success must never trigger the generic “service unavailable” banner just because data is empty.

2. Verify the Overview, inbound/outbound Call Logs, Recordings, Transcripts, Analytics, Billing/Invoices, Settings, Knowledge Base, SMS status, and outbound batch views against the contracts above. Make only the fixes that the current implementation actually needs.

3. Keep useful loading states. Add or correct clear, accessible empty states for no calls, no recordings, no transcripts, no analytics points, no invoices, no submissions, and no batches. Differentiate those states from real transport, authorization, or malformed-response errors.

4. Ensure the app does not throw when optional fields are absent. Normalize values defensively at the view-model boundary, including call names/numbers, timestamps, duration, sentiment, recording availability, and transcript-line arrays. Do not conceal malformed successful responses: show a concise safe error state and retain enough internal diagnostic context for developers without exposing patient data.

5. Verify error UI is scoped: an actual failure of one secondary widget should not erase healthy dashboard data. Keep the existing established critical-route behavior where appropriate, but do not show an outage banner for a normal 200 empty result.

6. Remove or update any stale comments that imply dashboard reads still come from retired sources when the BFF is now authoritative.

7. Do not weaken session/CSRF handling, tenant isolation, clinic selection, or authorization checks. Do not introduce a client-side tenant switcher that can override server membership.

Verification

- Run the project’s frontend typecheck/lint/test commands when available, then run `npm run build`.
- Exercise the dashboard with the local BFF/session setup available in the repository. Confirm Overview and inbound/outbound call pages render valid populated data without an outage banner.
- Also verify each intentionally empty result listed above renders an empty state rather than a crash, fake values, or a global failure banner.
- Check browser console output: no uncaught errors and no patient/call payload logging.
- Preserve mobile/responsive behavior and keyboard access for changed controls.

Deliverable

Provide a concise implementation summary listing each changed file, the precise contract/UX issue fixed, commands run and their results, and any remaining frontend-only blocker. If the audit finds an area is already compatible, say so explicitly and leave it unchanged.
```

## Handoff notes

The backend review verified that the main dashboard routes now return their established client-facing envelopes, including direct read recovery for historic inbound data and legacy query-key compatibility for outbound n8n reads. The frontend should therefore favor a minimal compatibility and resilience pass rather than a redesign.

The prompt intentionally excludes server, database, and workflow changes. It also avoids requesting credentials or patient data in a developer report.
