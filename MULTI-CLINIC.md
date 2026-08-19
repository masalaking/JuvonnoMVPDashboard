# Multi-Clinic Support

Implements `multi-clinic-prompt.md`. A logged-in user picks one clinic; the
entire dashboard (overview, calls, transcripts, analytics, staff queue,
activity, settings, payment recovery, billing, make-a-call) shows only that
clinic's data. Switching clinics swaps everything in place with no page
reload, no data bleed, no broken mutations.

**Explicitly out of scope** (per the brief): no cross-clinic "all clinics"
aggregate view, no tenant selector. One login = one tenant, always; a user
just picks which of that tenant's clinics they're looking at.

## Architecture

- The browser sends `?clinic_id=<activeClinicId>` on every
  `/api/dashboard/*` request (`apiFetch` in `src/app/App.tsx`).
- `requireClinicAccess` (`server/auth.js`) verifies that `clinic_id` against
  `user_clinic_access` server-side on every request - the browser *proposes*
  a clinic, the server *decides* whether the request is allowed to proceed.
  `req.session.tenantId`/`req.clinicId` (never anything from the request
  body) are what every downstream n8n call actually uses.
- `POST /api/session/active-clinic` persists the choice (so a future page
  load restores it) but is off the critical read path - switching clinics
  updates `session.activeClinicId` in React state immediately, which is what
  every `DashboardShell` effect is keyed on, and the POST happens in the
  background with rollback on failure.

## What changed

**Phase 1 - core correctness**
- `GET /api/auth/session` always returns a usable `csrfToken`, minting a
  fresh CSRF cookie pair if the existing one is missing (fixes CSRF surviving
  a hard reload).
- `apiFetch` takes a `clinicId` (not a legacy access token) and always calls
  `/api/dashboard/*` with `clinic_id` in the query string. The dead
  `/api/link` branch is gone.
- Clinic switching is in-place: `switchClinic` optimistically flips
  `session.activeClinicId`, persists in the background, rolls back on
  failure. No `window.location.reload()` anywhere.
- `DashboardShell` clears all clinic-scoped state and shows a loading state
  synchronously before the new clinic's data arrives; every fetch is
  abort-controlled and checked against a "is this still the active clinic"
  ref before committing `setState`, so a slow response for a clinic you've
  since switched away from can't land. Both background polls (staff queue,
  inbound/outbound tracker) are keyed on `activeClinicId` so they restart
  cleanly on switch. The previously-triplicated fetch fan-out is now one
  `loadClinicData()`.

**Phase 2 - clinic picker & switcher**
- `ClinicPickerScreen`: shown after login when the user has 2+ clinics and
  none is active yet.
- A lone clinic auto-selects server-side on login (and client-side as a
  fallback for older session cookies) - the switcher hides itself whenever
  `clinics.length <= 1`.
- `ClinicSwitcher` rebuilt on the existing shadcn `Popover`+`Command`
  primitives: searchable, shows a status dot and role badge per clinic.
- `clinicsForUser` (`server/auth.js`) now returns each clinic's `status` and
  `timezone`, sorted by `clinic_name`.
- Fixed a bug where `POST /api/auth/login` and `GET /api/clinics` silently
  auto-selected `clinics[0]` even for users with 2+ clinics, which would
  have made the picker unreachable.

**Phase 3 - Make a Call + legacy surface removal**
- `MakeCallScreen` now actually works: `POST /api/dashboard/outbound/make-call`
  (server/index.js) + `outbound.makeCall` (server/n8n.js, the one permitted
  addition to that file) replace the dead `/api/link/.../outbound/make-call`
  call it used to make.
- The entire retired `/api/link/:accessToken/*` route-body surface (tenant,
  queue CRUD, settings, billing, AI payment recovery, call-logs, inbound/
  outbound tracker, make-call - ~470 lines) is deleted, along with the
  JSON-file/proxy helpers that only existed to serve it (`loadTenants`,
  `findTenant`, `loadRequests`, `saveRequests`, `saveSettingsFile`,
  `callN8n`, `callInboundTracker`/`callOutboundTracker`/
  `postToOutboundTracker`, `n8nRoute`). The blanket `410` at `/api/link`
  stays as a clean message for anyone hitting an old bookmarked link.
- Kept, as required: `formatForN8n`, `formatClinicHoursForN8n`,
  `buildN8nAllSettings`, `parseBoolean`, and `GET
  /api/settings-by-client/:clientId` (still called directly by n8n's
  Settings Backend workflow).

**Phase 4 - provisioning CLI**
- `scripts/clinics.js` (`npm run clinics -- <command> ...`): `list-clinics`,
  `create-clinic`, `create-user`, `grant`, `revoke`, `list-access`. Talks
  directly to Postgres via Prisma - see Usage below.

**Phase 5 - edge cases**
- A 401 from any dashboard fetch clears the local session (`handleUnauthorized`
  in `AuthProvider`), so a dead session on the server can't keep showing a
  live-looking dashboard.
- A 403 (this clinic's access was revoked mid-session) re-fetches
  `/api/clinics` (`refreshClinics`); if the active clinic really is gone, it
  drops `activeClinicId` so `AppGate` routes to the picker (or the
  zero-clinics empty state) instead of retrying a clinic the user can no
  longer see.
- Zero-clinics state (`NoClinicsScreen`) and the picker (Phase 2) cover the
  "no clinic to land on" cases.
- Settings writes were already ignoring any body-supplied `tenant_id`/
  `clinic_id` (`server/index.js` builds that payload from `req.session`/
  `req.clinicId` after spreading the body, so a spoofed value gets
  overwritten) - verified, no change needed.
- Role-derived UI (`currentClinicRole`) is computed inline from
  `session.clinics`/`session.activeClinicId` on every render rather than
  cached in state, so it recomputes automatically on clinic switch.

## Usage: `scripts/clinics.js`

```
npm run clinics -- list-clinics [--tenant <tenantId>]
npm run clinics -- create-clinic --tenant <tenantId> --clinic-id <clinicId> --name <clinicName> [--client-id <id>] [--timezone <tz>] [--status <status>]
npm run clinics -- create-user --tenant <tenantId> --username <username> --password <password>
npm run clinics -- grant --username <username> --tenant <tenantId> --clinic <clinicId> [--role <role>]
npm run clinics -- revoke --username <username> --tenant <tenantId> --clinic <clinicId>
npm run clinics -- list-access --tenant <tenantId> [--username <username>]
```

`create-clinic`/`create-user` upsert the parent `tenants` row on first use
(name defaults to the tenant id) since there's no separate tenant
provisioning step. `grant`/`revoke` operate on `user_clinic_access`; a user
can only be granted access within their own tenant (one login = one tenant).

## Verification performed

- `npx vite build` after every phase - compiles cleanly throughout.
- `node --check server/index.js` / `server/auth.js` / `scripts/clinics.js` -
  all pass.
- Grepped for every deleted symbol (`accessToken` in `DashboardShell`,
  `findTenant`/`loadTenants`/`callN8n`/etc.) - no dangling references left.
- Ran `list-clinics` and `list-access` against the live database - both
  returned correct real data, confirming the Prisma model/relation names in
  the new CLI match the live schema.

## Not yet re-verified manually (needs a browser/two real clinics)

- Full switch-clinic round trip in a running browser session (optimistic
  update, rollback on a simulated 403, no data bleed).
- `create-clinic`/`create-user`/`grant`/`revoke` mutating commands against
  the real database (only the read-only commands were smoke-tested).
- The full checklist in `multi-clinic-prompt.md`'s final section (rapid
  toggle test, revoked-access routing end-to-end, single-clinic-hides-switcher
  in a live session, etc.).
