function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rounded(value, decimals = 2) {
  const multiplier = 10 ** decimals;
  // Decimal rate values arrive from Postgres as strings/Decimals. Compensate
  // only for binary representation noise at a half-cent boundary; this is not
  // a tolerance applied to the underlying billing calculation.
  return Math.round((number(value) + 1e-10) * multiplier) / multiplier;
}

// Keep the dashboard contract explicit: an absent billing row is unavailable
// data, not a zero-usage month. The BFF route turns this into a 404 so the UI
// shows its existing unavailable state instead of invented KPIs.
export function buildBillingOverview(row) {
  if (!row?.billing_month) return null;
  const included = number(row.included_minutes);
  const baseRate = number(row.base_rate);
  const overageRate = number(row.overage_rate);
  const minutesUsed = number(row.cumulative_minutes);
  const totalCalls = number(row.total_calls);
  const overageMinutes = Math.max(0, rounded(minutesUsed - included));
  const overageUSD = rounded(overageMinutes * overageRate);
  const avgCallMin = totalCalls > 0 ? rounded(minutesUsed / totalCalls, 1) : 0;
  const seconds = Math.round(avgCallMin * 60);

  return {
    tenantId: String(row.tenant_id),
    clientName: row.client_name || String(row.tenant_id),
    basePrice: baseRate,
    clientRatePerMin: number(row.client_rate_per_min),
    overageRate,
    minutesUsed,
    minutesIncluded: included,
    remainingMinutes: Math.max(0, rounded(included - minutesUsed)),
    overageMinutes,
    totalCalls,
    overageUSD,
    monthlyTotal: rounded(baseRate + overageUSD),
    avgCallMin,
    avgCallDisplay: `${Math.floor(seconds / 60)} minute${Math.floor(seconds / 60) === 1 ? '' : 's'}${seconds % 60 ? ` ${seconds % 60} seconds` : ''}`,
    billingPeriod: String(row.billing_month),
    billingPct: included > 0 ? Math.min(100, rounded((minutesUsed / included) * 100, 1)) : 0,
    billingPctRaw: included > 0 ? rounded((minutesUsed / included) * 100, 1) : 0,
    totalRecordings: number(row.total_recordings),
    totalTranscripts: number(row.total_transcripts),
  };
}

// Kept as a compatibility alias while the inbound route names are moved to
// the shared billing-summary terminology.
export const buildInboundOverview = buildBillingOverview;
