// Scope is always an intersection with the server-derived authorization list.
// An explicitly supplied empty or foreign-only scope must never silently turn
// into "all clinics"; callers can decide whether an empty result is a 403 or
// a validation error.
export function authorizedAdvisorClinicScope(authorizedClinicIds, requestedClinicIds) {
  const allowed = new Set((authorizedClinicIds ?? []).map(String));
  if (!Array.isArray(requestedClinicIds)) return [...allowed];
  return [...new Set(requestedClinicIds.map(String).filter(clinicId => allowed.has(clinicId)))];
}
