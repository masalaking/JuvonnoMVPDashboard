/*
 * Deterministic analytics used by the generated n8n Advisor workflow.
 * Every output carries null/availability metadata when the required source
 * field is absent. It never invents an appointment price, patient identity,
 * transcript theme, or clinical conclusion.
 */

const cancelled = status => ['cancelled', 'canceled'].includes(String(status ?? '').toLowerCase());
const noShow = status => ['no-show', 'no show'].includes(String(status ?? '').toLowerCase());
const completed = status => ['completed', 'arrived'].includes(String(status ?? '').toLowerCase());
const activeBooking = status => !cancelled(status) && !noShow(status) && !['late cancellation', 'rescheduled'].includes(String(status ?? '').toLowerCase());
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const round = value => value == null || !Number.isFinite(value) ? null : Math.round((value + Number.EPSILON) * 10000) / 10000;
const percent = (numerator, denominator) => denominator > 0 ? round((numerator / denominator) * 100) : null;
const dateValue = appointment => new Date(appointment?.date?.start ?? appointment?.start_at ?? appointment?.start ?? appointment?.scheduled_at ?? 0).getTime();
const day = appointment => new Date(dateValue(appointment)).toISOString().slice(0, 10);
const duration = appointment => finite(appointment?.duration_minutes ?? appointment?.duration ?? appointment?.length_minutes) ?? 0;
const slotCount = slot => finite(slot?.available_slot_count ?? slot?.slot_count) ?? 1;
const availableSlotMinutes = slot => duration(slot) * Math.max(0, slotCount(slot));
const service = appointment => String(appointment?.service?.name ?? appointment?.schedule_type?.name ?? appointment?.schedule_type ?? appointment?.service ?? appointment?.service_name ?? 'Unspecified');
const practitioner = appointment => {
  const value = Array.isArray(appointment?.attendants) ? appointment.attendants[0] : appointment?.practitioner;
  return String(value?.id ?? value?.num ?? value?.staff_num ?? value?.name ?? value ?? 'Unassigned');
};
const patient = appointment => {
  // Juvonno appointment-list responses identify the patient as `customer`;
  // other adapters may use `patient` or `client`. Only stable source IDs are
  // used for internal grouping, never names or contact information.
  const value = appointment?.patient ?? appointment?.client ?? appointment?.customer ?? {};
  return String(value?.id ?? value?.num ?? value?.patient_id ?? value?.patient_num ?? value?.client_id ?? value?.client_num ?? appointment?.patient_id ?? appointment?.patient_num ?? appointment?.client_id ?? appointment?.client_num ?? appointment?.customer_id ?? appointment?.customer_num ?? '').trim() || null;
};
const patientDisplayName = appointment => {
  const value = appointment?.patient ?? appointment?.client ?? appointment?.customer ?? {};
  const fullName = [value?.first_name ?? value?.firstName, value?.last_name ?? value?.lastName].filter(Boolean).join(' ').trim() || String(value?.name ?? '').trim();
  if (fullName) return fullName;
  const chartNumber = value?.num ?? value?.patient_num ?? value?.client_num ?? appointment?.patient_num ?? appointment?.client_num ?? appointment?.customer_num;
  return chartNumber == null || String(chartNumber).trim() === '' ? null : `Patient chart ${String(chartNumber).trim()}`;
};
const analyticsAppointmentRef = appointment => String(appointment?.id ?? appointment?.num ?? appointment?.appointment_id ?? '').trim() || null;
const valueFromAppointment = appointment => finite(appointment?.amount ?? appointment?.value ?? appointment?.fee ?? appointment?.price ?? appointment?.total);
const sourceBackedCapacityOpportunity = slot => finite(slot?.source_backed_revenue_opportunity ?? slot?.revenue_opportunity);

function weekday(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) : 'Unknown';
}

function capacityBreakdown(availability, appointments, keyFn, availabilityRepresentsUnused = false) {
  const groups = new Map();
  const get = key => {
    const normalizedKey = String(key ?? 'Unspecified');
    const group = groups.get(normalizedKey) ?? { key: normalizedKey, total_available_minutes: 0, total_booked_minutes: 0, total_unused_minutes: 0, available_slot_count: 0, booked_slot_count: 0, unused_slot_count: 0 };
    groups.set(normalizedKey, group);
    return group;
  };
  for (const slot of availability) {
    const group = get(keyFn(slot));
    const minutes = availableSlotMinutes(slot);
    const slots = slotCount(slot);
    group.total_available_minutes += minutes;
    group.available_slot_count += slots;
    if (availabilityRepresentsUnused) {
      group.total_unused_minutes += minutes;
      group.unused_slot_count += slots;
    }
  }
  for (const appointment of appointments) {
    const group = get(keyFn(appointment));
    const minutes = duration(appointment);
    group.total_booked_minutes += minutes;
    group.booked_slot_count += 1;
    if (availabilityRepresentsUnused) {
      group.total_available_minutes += minutes;
      group.available_slot_count += 1;
    }
  }
  return [...groups.values()].map(group => ({
    ...group,
    total_available_minutes: round(group.total_available_minutes),
    total_booked_minutes: round(group.total_booked_minutes),
    total_unused_minutes: round(availabilityRepresentsUnused ? group.total_unused_minutes : Math.max(0, group.total_available_minutes - group.total_booked_minutes)),
    utilization_rate: percent(group.total_booked_minutes, group.total_available_minutes),
    unused_slot_count: availabilityRepresentsUnused ? group.unused_slot_count : Math.max(0, group.available_slot_count - group.booked_slot_count),
  })).sort((a, b) => b.total_unused_minutes - a.total_unused_minutes || a.key.localeCompare(b.key));
}

function groupedRate(rows, keyFn, numeratorFn, denominatorFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const item = groups.get(key) ?? { key, numerator: 0, denominator: 0 };
    if (numeratorFn(row)) item.numerator += 1;
    if (denominatorFn(row)) item.denominator += 1;
    groups.set(key, item);
  }
  return [...groups.values()].map(item => ({ ...item, rate: percent(item.numerator, item.denominator) })).sort((a, b) => b.numerator - a.numerator || b.denominator - a.denominator);
}

function breakdown(rows, keyFn, valueFn = () => 1) {
  const values = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    values.set(key, (values.get(key) ?? 0) + valueFn(row));
  }
  return [...values.entries()].map(([key, count]) => ({ key, count: round(count) })).sort((a, b) => b.count - a.count);
}

function cancellationRebooking(appointments) {
  const cancellations = appointments.filter(appointment => cancelled(appointment?.status));
  const withPatient = cancellations.filter(appointment => patient(appointment));
  let rebooked = 0;
  const notRebooked = [];
  for (const cancellation of withPatient) {
    const patientKey = patient(cancellation);
    const after = dateValue(cancellation);
    const hasFutureBooking = appointments.some(appointment => patient(appointment) === patientKey && dateValue(appointment) > after && activeBooking(appointment?.status));
    if (hasFutureBooking) rebooked += 1;
    else notRebooked.push(cancellation);
  }
  const known = withPatient.length === cancellations.length;
  const sourceBackedValue = rows => rows.reduce((sum, row) => sum + (valueFromAppointment(row) ?? 0), 0);
  const valued = notRebooked.filter(row => valueFromAppointment(row) != null);
  return {
    cancellation_count: cancellations.length,
    cancellations_rebooked: known ? rebooked : null,
    cancellations_not_rebooked: known ? notRebooked.length : null,
    non_rebooking_rate: known ? percent(notRebooked.length, cancellations.length) : null,
    affected_patient_count: known ? new Set(notRebooked.map(patient)).size : null,
    patient_identifier_coverage: percent(withPatient.length, cancellations.length),
    service_breakdown: known ? breakdown(notRebooked, service) : [],
    practitioner_breakdown: known ? breakdown(notRebooked, practitioner) : [],
    source_backed_cancelled_appointment_value: valued.length ? round(sourceBackedValue(valued)) : null,
    recoverable_revenue: valued.length && known ? round(sourceBackedValue(valued)) : null,
    data_quality: known ? [] : ['Some cancelled appointments have no stable patient identifier, so rebooking status is unavailable.'],
  };
}

function noShowAnalytics(appointments) {
  const denominator = appointments.filter(appointment => completed(appointment?.status) || noShow(appointment?.status));
  const leadTimeRows = denominator.filter(appointment => appointment?.created_at ?? appointment?.booked_at ?? appointment?.created);
  const leadBucket = appointment => {
    const booked = new Date(appointment?.created_at ?? appointment?.booked_at ?? appointment?.created).getTime();
    const leadDays = Math.max(0, Math.floor((dateValue(appointment) - booked) / 86400000));
    return leadDays <= 7 ? '0-7 days' : leadDays <= 13 ? '8-13 days' : '14+ days';
  };
  return {
    scheduled_count: denominator.length,
    no_show_count: denominator.filter(appointment => noShow(appointment?.status)).length,
    no_show_rate: percent(denominator.filter(appointment => noShow(appointment?.status)).length, denominator.length),
    practitioner_breakdown: groupedRate(denominator, practitioner, appointment => noShow(appointment?.status), () => true),
    service_breakdown: groupedRate(denominator, service, appointment => noShow(appointment?.status), () => true),
    day_of_week_breakdown: groupedRate(denominator, appointment => new Date(dateValue(appointment)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }), appointment => noShow(appointment?.status), () => true),
    appointment_hour_breakdown: groupedRate(denominator, appointment => String(new Date(dateValue(appointment)).getUTCHours()).padStart(2, '0'), appointment => noShow(appointment?.status), () => true),
    booking_lead_time_breakdown: leadTimeRows.length ? groupedRate(leadTimeRows, leadBucket, appointment => noShow(appointment?.status), () => true) : [],
    booking_lead_time_available: leadTimeRows.length === denominator.length,
  };
}

function retentionAnalytics(appointments, asOfDate) {
  const completedAppointments = appointments.filter(appointment => completed(appointment?.status) && patient(appointment)).sort((a, b) => dateValue(a) - dateValue(b));
  const patients = new Map();
  for (const appointment of completedAppointments) {
    const key = patient(appointment);
    const entries = patients.get(key) ?? [];
    entries.push(appointment);
    patients.set(key, entries);
  }
  const cohort = [...patients.values()].filter(entries => entries.length > 0 && dateValue(entries[0]) >= new Date(asOfDate.start).getTime() && dateValue(entries[0]) <= new Date(asOfDate.end).getTime());
  const measure = days => {
    const eligible = cohort.filter(entries => new Date(asOfDate.end).getTime() - dateValue(entries[0]) >= days * 86400000);
    const retained = eligible.filter(entries => entries.some(entry => dateValue(entry) - dateValue(entries[0]) >= days * 86400000));
    return { eligible_cohort_size: eligible.length, retained_count: retained.length, retention_rate: percent(retained.length, eligible.length), complete: eligible.length === cohort.length };
  };
  return {
    patient_identifier_coverage: percent(completedAppointments.length, appointments.filter(appointment => completed(appointment?.status)).length),
    new_patient_count: cohort.length,
    returned_for_visit_2_count: cohort.filter(entries => entries.length >= 2).length,
    returned_for_visit_2_rate: percent(cohort.filter(entries => entries.length >= 2).length, cohort.length),
    returned_for_visit_3_count: cohort.filter(entries => entries.length >= 3).length,
    returned_for_visit_3_rate: percent(cohort.filter(entries => entries.length >= 3).length, cohort.length),
    retention_30_days: measure(30), retention_60_days: measure(60), retention_90_days: measure(90), retention_180_days: measure(180),
    data_quality: completedAppointments.length ? [] : ['No completed appointments with stable patient identifiers were available for retention analysis.'],
  };
}

function appointmentFrequencyChanges(appointments, asOfDate) {
  const completedByPatient = new Map();
  for (const appointment of appointments.filter(appointment => completed(appointment?.status) && patient(appointment)).sort((a, b) => dateValue(a) - dateValue(b))) {
    const key = patient(appointment); const entries = completedByPatient.get(key) ?? []; entries.push(appointment); completedByPatient.set(key, entries);
  }
  const asOf = new Date(asOfDate.end).getTime();
  const signals = [];
  for (const [key, entries] of completedByPatient) {
    if (entries.length < 3) continue;
    const intervals = entries.slice(1).map((entry, index) => (dateValue(entry) - dateValue(entries[index])) / 86400000);
    const historicalIntervals = intervals.slice(0, -1);
    const historicalAverage = historicalIntervals.length ? historicalIntervals.reduce((sum, value) => sum + value, 0) / historicalIntervals.length : null;
    const recentAverage = intervals.at(-1) ?? null;
    const intervalChange = historicalAverage && recentAverage != null ? ((recentAverage - historicalAverage) / historicalAverage) * 100 : null;
    const futureBooking = appointments.some(appointment => patient(appointment) === key && dateValue(appointment) > asOf && activeBooking(appointment?.status));
    const recentCancellations = appointments.filter(appointment => patient(appointment) === key && cancelled(appointment?.status) && dateValue(appointment) <= asOf && dateValue(appointment) >= asOf - 90 * 86400000).length;
    const recentNoShows = appointments.filter(appointment => patient(appointment) === key && noShow(appointment?.status) && dateValue(appointment) <= asOf && dateValue(appointment) >= asOf - 90 * 86400000).length;
    const changeCategory = intervalChange == null ? 'insufficient_history' : intervalChange >= 20 ? 'increasing_interval' : intervalChange <= -20 ? 'decreasing_interval' : 'stable_interval';
    signals.push({ patient_reference: key, change_category: changeCategory, historical_average_interval_days: round(historicalAverage), recent_average_interval_days: round(recentAverage), interval_change_percent: round(intervalChange), days_since_most_recent_completed_appointment: Math.max(0, Math.floor((asOf - dateValue(entries.at(-1))) / 86400000)), recent_cancellation_count: recentCancellations, recent_no_show_count: recentNoShows, future_booking_detected: futureBooking });
  }
  const count = category => signals.filter(signal => signal.change_category === category).length;
  return {
    evaluated_patient_count: signals.length,
    insufficient_history_patient_count: [...completedByPatient.values()].filter(entries => entries.length < 3).length,
    change_counts: { increasing_interval: count('increasing_interval'), stable_interval: count('stable_interval'), decreasing_interval: count('decreasing_interval') },
    signal_examples: signals.slice(0, 10).map(({ patient_reference, ...signal }) => signal),
    data_quality: signals.length ? ['Patient-level identifiers are intentionally withheld from aggregate frequency-change results; use a specific patient lookup for an individual drill-down.'] : ['At least three completed appointments with stable patient identifiers are required for frequency-change analysis.'],
  };
}

function engagementRisk(appointments, asOfDate, includePatientDetails = false) {
  const completedByPatient = new Map();
  for (const appointment of appointments.filter(appointment => completed(appointment?.status) && patient(appointment)).sort((a, b) => dateValue(a) - dateValue(b))) {
    const key = patient(appointment); const entries = completedByPatient.get(key) ?? []; entries.push(appointment); completedByPatient.set(key, entries);
  }
  const asOf = new Date(asOfDate.end).getTime();
  const summaries = [];
  for (const [key, entries] of completedByPatient) {
    if (entries.length < 3) continue;
    const intervals = entries.slice(1).map((entry, index) => (dateValue(entry) - dateValue(entries[index])) / 86400000);
    const prior = intervals.slice(0, -1); const recent = intervals.slice(-1);
    const historicalAverage = prior.length ? prior.reduce((sum, value) => sum + value, 0) / prior.length : null;
    const recentAverage = recent.length ? recent.reduce((sum, value) => sum + value, 0) / recent.length : null;
    const daysSinceLast = Math.max(0, Math.floor((asOf - dateValue(entries.at(-1))) / 86400000));
    const increase = historicalAverage && recentAverage ? ((recentAverage - historicalAverage) / historicalAverage) * 100 : null;
    const future = appointments.some(appointment => patient(appointment) === key && dateValue(appointment) > asOf && activeBooking(appointment?.status));
    const recentCancellations = appointments.filter(appointment => patient(appointment) === key && cancelled(appointment?.status) && dateValue(appointment) <= asOf && dateValue(appointment) >= asOf - 90 * 86400000).length;
    const recentNoShows = appointments.filter(appointment => patient(appointment) === key && noShow(appointment?.status) && dateValue(appointment) <= asOf && dateValue(appointment) >= asOf - 90 * 86400000).length;
    const reasons = [];
    if (increase != null && increase >= 50) reasons.push('recent_interval_increased_50_percent_or_more');
    if (historicalAverage && daysSinceLast > historicalAverage * 2) reasons.push('time_since_last_exceeds_twice_historical_interval');
    if (recentCancellations > 0 && !future) reasons.push('recent_cancellation_without_detected_rebooking');
    if (recentNoShows >= 2) reasons.push('repeated_recent_no_shows');
    if (!future) reasons.push('no_future_booking_detected');
    const level = reasons.length >= 3 ? 'high' : reasons.length >= 2 ? 'moderate' : 'low';
    summaries.push({ patient_reference: key, patient_name: patientDisplayName(entries.at(-1)), level, historical_average_interval_days: round(historicalAverage), recent_average_interval_days: round(recentAverage), interval_change_percent: round(increase), days_since_last_appointment: daysSinceLast, recent_cancellation_count: recentCancellations, recent_no_show_count: recentNoShows, future_booking_detected: future, reasons });
  }
  const riskCounts = { high: summaries.filter(item => item.level === 'high').length, moderate: summaries.filter(item => item.level === 'moderate').length, low: summaries.filter(item => item.level === 'low').length };
  const rank = (a, b) => b.reasons.length - a.reasons.length || (b.interval_change_percent ?? -Infinity) - (a.interval_change_percent ?? -Infinity) || (b.days_since_last_appointment ?? 0) - (a.days_since_last_appointment ?? 0) || String(a.patient_name ?? '').localeCompare(String(b.patient_name ?? ''));
  const aggregate = { evaluated_patient_count: summaries.length, risk_counts: riskCounts, risk_signal_examples: summaries.slice().sort(rank).slice(0, 10).map(({ patient_reference, patient_name, ...signal }) => signal), data_quality: summaries.length ? ['Patient-level identifiers are intentionally withheld from aggregate engagement-risk results.'] : ['At least three completed appointments with stable patient identifiers are required for frequency-change analysis.'] };
  if (!includePatientDetails) return aggregate;
  return { ...aggregate, high_risk_patients: summaries.filter(item => item.level === 'high' && item.patient_name).sort(rank).map(({ patient_reference, level, ...item }) => ({ patient_name:item.patient_name, risk_level:level, historical_interval_days:item.historical_average_interval_days, recent_interval_days:item.recent_average_interval_days, interval_change_percent:item.interval_change_percent, days_since_last_completed_visit:item.days_since_last_appointment, recent_cancellations:item.recent_cancellation_count, recent_no_shows:item.recent_no_show_count, has_future_booking:item.future_booking_detected, risk_reasons:item.reasons })), data_quality: summaries.some(item => item.level === 'high' && !item.patient_name) ? [...aggregate.data_quality, 'One or more high-risk patients had no safe display name or chart number and were omitted from the patient list.'] : aggregate.data_quality };
}

function capacityAnalytics(appointments, availability, availabilitySource = null) {
  const bookedAppointments = appointments.filter(appointment => activeBooking(appointment?.status));
  const bookedMinutes = bookedAppointments.reduce((sum, appointment) => sum + duration(appointment), 0);
  const source = availabilitySource && typeof availabilitySource === 'object' ? availabilitySource : {};
  const verifiedUnusedSlots = source.verified === true && source.basis === 'unused_slots';
  if ((!Array.isArray(availability) || !availability.length) && !verifiedUnusedSlots) return {
    availability_data_available: false, total_available_minutes: null, total_booked_minutes: round(bookedMinutes), total_unused_minutes: null, utilization_rate: null, available_slot_count: null, booked_slot_count: bookedAppointments.length, unused_slot_count: null, practitioner_breakdown: [], service_breakdown: [], day_of_week_breakdown: [], estimated_revenue_opportunity: null,
    data_quality: ['Scheduling availability was not supplied by the connected Juvonno source. Booked minutes are available, but utilization and unused capacity cannot be calculated.'],
  };
  const rows = Array.isArray(availability) ? availability : [];
  const unusedOnly = verifiedUnusedSlots || (rows.length > 0 && rows.every(slot => slot?.availability_kind === 'unused_slot'));
  const suppliedMinutes = rows.reduce((sum, slot) => sum + availableSlotMinutes(slot), 0);
  const suppliedSlots = rows.reduce((sum, slot) => sum + slotCount(slot), 0);
  const availableMinutes = unusedOnly ? suppliedMinutes + bookedMinutes : suppliedMinutes;
  const availableSlots = unusedOnly ? suppliedSlots + bookedAppointments.length : suppliedSlots;
  const unusedMinutes = unusedOnly ? suppliedMinutes : Math.max(0, availableMinutes - bookedMinutes);
  const unusedSlots = unusedOnly ? suppliedSlots : Math.max(0, availableSlots - bookedAppointments.length);
  const sourceBackedOpportunityValues = rows.map(sourceBackedCapacityOpportunity);
  const opportunityAvailable = rows.length > 0 && sourceBackedOpportunityValues.every(value => value != null);
  const dataQuality = [];
  if (source.complete === false) dataQuality.push(`Juvonno availability retrieval was partial${source.reason ? `: ${source.reason}` : '.'}`);
  if (!opportunityAvailable) dataQuality.push('No source-backed service pricing or unused-slot opportunity value was supplied, so revenue opportunity is unavailable.');
  return {
    availability_data_available: true, availability_data_complete: source.complete !== false, availability_source: source.source_name ?? 'verified schedule availability', total_available_minutes: round(availableMinutes), total_booked_minutes: round(bookedMinutes), total_unused_minutes: round(unusedMinutes), utilization_rate: percent(bookedMinutes, availableMinutes), available_slot_count: availableSlots, booked_slot_count: bookedAppointments.length, unused_slot_count: unusedSlots, practitioner_breakdown: capacityBreakdown(rows, bookedAppointments, practitioner, unusedOnly), service_breakdown: capacityBreakdown(rows, bookedAppointments, service, unusedOnly), day_of_week_breakdown: capacityBreakdown(rows, bookedAppointments, item => weekday(item?.date?.start ?? item?.start_at ?? item?.start ?? item?.scheduled_at), unusedOnly), estimated_revenue_opportunity: opportunityAvailable ? { amount: round(sourceBackedOpportunityValues.reduce((sum, value) => sum + value, 0)), calculation_basis: 'source-backed opportunity values supplied for every unused slot', confidence: 'high' } : null,
    data_quality: dataQuality,
  };
}

const themeRules = [
  ['price', /\b(price|cost|expensive|too much)\b/i], ['insurance', /\b(insurance|benefits|coverage)\b/i], ['location', /\b(location|parking|accessible|accessibility)\b/i], ['clinic_hours', /\b(evening|weekend|after [0-9]|hours)\b/i], ['requested_time_unavailable', /\b(no (?:time|appointment)|not available|too far away)\b/i], ['requested_practitioner_unavailable', /\b(practitioner|therapist|doctor).{0,40}(?:not available|unavailable)\b/i], ['service_unavailable', /\b(do not offer|don.t offer|not provide)\b/i], ['patient_indecision', /\b(think about it|call back|ask (?:my )?(?:spouse|family))\b/i], ['competitor_comparison', /\b(other clinic|competitor|shop around)\b/i], ['technical_issue', /\b(disconnect|dropped|technical|transfer)\b/i], ['convenient_time', /\b(works for me|perfect time|convenient)\b/i], ['practitioner_preference', /\b(referred|recommend(?:ed)?|see (?:dr|doctor|therapist))\b/i],
];

function callAnalytics(calls) {
  const records = Array.isArray(calls) ? calls : [];
  const classified = records.map(call => {
    const text = String(call?.summary ?? '') + ' ' + String(call?.transcript_excerpt ?? call?.transcript ?? '');
    const themes = themeRules.filter(([, regex]) => regex.test(text)).map(([theme]) => theme);
    const status = String(call?.call_status ?? '').toLowerCase();
    // A completed phone call is not evidence of a completed booking. Booking
    // creation needs an explicit outcome/status signal or supporting wording.
    const bookingCreated = /\b(booked|appointment (?:created|confirmed))\b/i.test(text) || /(?:appointment_)?booked/.test(status);
    const intent = bookingCreated || /\b(book|appointment|availability|available)\b/i.test(text);
    const availabilityRequested = /\b(availability|available|what time|appointment time)\b/i.test(text);
    const availabilityPresented = /\b(i have|we have|can offer|available at)\b/i.test(text);
    const offered = /\b(offer|would you like|does .+ work)\b/i.test(text);
    const accepted = bookingCreated || /\b(yes|that works|sounds good)\b/i.test(text);
    return { call_reference: call?.retell_call_id ?? call?.call_id ?? null, booking_created: bookingCreated, intent, availability_requested: availabilityRequested, availability_presented: availabilityPresented, appointment_offered: offered, appointment_accepted: accepted, themes, classified: Boolean(text.trim()), evidence_kind: call?.summary ? 'summary_or_excerpt' : 'none' };
  });
  const count = key => classified.filter(item => item[key]).length;
  const stages = [{ stage: 'inbound_call', count: records.length }, { stage: 'relevant_patient_inquiry', count: count('intent') }, { stage: 'booking_intent', count: count('intent') }, { stage: 'availability_requested', count: count('availability_requested') }, { stage: 'availability_presented', count: count('availability_presented') }, { stage: 'appointment_offered', count: count('appointment_offered') }, { stage: 'appointment_accepted', count: count('appointment_accepted') }, { stage: 'appointment_created', count: count('booking_created') }].map((stage, index, all) => ({ ...stage, conversion_from_previous_rate: index ? percent(stage.count, all[index - 1].count) : null, drop_off_from_previous_count: index ? Math.max(0, all[index - 1].count - stage.count) : null }));
  return { call_count: records.length, unknown_or_unclassified_count: classified.filter(item => !item.classified).length, funnel: stages, theme_counts: breakdown(classified.flatMap(item => item.themes.map(theme => ({ theme }))), item => item.theme), classified_interactions: classified.map(item => ({ call_reference: item.call_reference, themes: item.themes, classification_confidence: item.classified ? 'keyword_signal' : 'unclassified', booking_outcome: item.booking_created ? 'appointment_created' : 'unknown', evidence_kind: item.evidence_kind })), data_quality: records.length ? ['Funnel stages and themes use deterministic summary/excerpt signals; unclassified calls remain unknown.'] : ['No call summary or transcript records were supplied for this period.'] };
}

function revenueRisk(appointments, cancellation, engagement) {
  const sourceValue = appointment => valueFromAppointment(appointment);
  const noShows = appointments.filter(appointment => noShow(appointment?.status) && sourceValue(appointment) != null);
  const cancelledRows = appointments.filter(appointment => cancelled(appointment?.status) && sourceValue(appointment) != null);
  const highRiskCount = engagement?.risk_counts?.high ?? 0;
  return {
    confirmed_lost_revenue: noShows.length ? { amount: round(noShows.reduce((sum, appointment) => sum + sourceValue(appointment), 0)), appointment_count: noShows.length, calculation_basis: 'source-backed appointment values attached to no-show events', confidence: 'high' } : { amount: null, appointment_count: appointments.filter(appointment => noShow(appointment?.status)).length, calculation_basis: 'appointment values unavailable', confidence: 'unavailable' },
    recoverable_revenue: cancellation?.recoverable_revenue != null ? { amount: cancellation.recoverable_revenue, appointment_count: cancellation.cancellations_not_rebooked, calculation_basis: 'source-backed value on cancelled appointments without a detected rebooking', confidence: 'medium' } : { amount: null, appointment_count: cancellation?.cancellations_not_rebooked ?? null, calculation_basis: 'pricing or patient rebooking data unavailable', confidence: 'unavailable' },
    revenue_at_risk: { amount: null, patient_count: highRiskCount, calculation_basis: 'engagement-risk signals are available but future appointment value is not source-backed', confidence: highRiskCount ? 'unavailable' : 'unavailable' },
    revenue_opportunity: { amount: null, calculation_basis: 'schedule availability/pricing not supplied', confidence: 'unavailable' },
    cancelled_appointment_value_observed: cancelledRows.length ? round(cancelledRows.reduce((sum, appointment) => sum + sourceValue(appointment), 0)) : null,
  };
}

function calculateAdvisorAnalytics({ appointments = [], invoices = [], availability = [], calls = [], startDate, endDate, appointmentSource = null, availabilitySource = null, includePatientDetails = false }) {
  const dates = { start: startDate, end: endDate };
  const cancellation = cancellationRebooking(appointments);
  const engagement = engagementRisk(appointments, dates, includePatientDetails);
  const source = appointmentSource && typeof appointmentSource === 'object' ? appointmentSource : {};
  const appointmentPageLimit = finite(source.page_size) ?? 100;
  const appointmentResultsMayBeIncomplete = source.results_may_be_incomplete == null
    ? appointments.length >= appointmentPageLimit
    : Boolean(source.results_may_be_incomplete);
  const sourceLimits = {
    appointment_count: appointments.length,
    appointment_page_limit: appointmentPageLimit,
    appointment_pages_requested: finite(source.pages_requested) ?? 1,
    appointment_pages_received: finite(source.pages_received) ?? 1,
    appointment_max_pages: finite(source.max_pages) ?? 1,
    appointment_duplicate_records_removed: finite(source.duplicate_records_removed) ?? 0,
    appointment_results_may_be_incomplete: appointmentResultsMayBeIncomplete,
    appointment_fetch_status: String(source.fetch_status ?? (appointmentResultsMayBeIncomplete ? 'possibly_incomplete' : 'complete')),
    appointment_fetch_reason: source.fetch_reason ?? null,
    appointment_fetch_start_date: source.fetch_start_date ?? startDate ?? null,
    appointment_fetch_end_date: source.fetch_end_date ?? endDate ?? null,
    appointment_analysis_start_date: source.analysis_start_date ?? startDate ?? null,
    appointment_analysis_end_date: source.analysis_end_date ?? endDate ?? null,
    appointment_historical_context_start: source.historical_context_start ?? null,
    invoice_count: invoices.length,
    call_count: calls.length,
    call_record_limit: 500,
    call_results_may_be_incomplete: calls.length >= 500,
    availability_supplied: Array.isArray(availability) && availability.length > 0,
    availability_source: availabilitySource?.source_name ?? null,
    availability_fetch_status: availabilitySource?.complete === false ? 'partial' : availabilitySource?.verified === true ? 'complete' : 'unavailable',
    availability_results_may_be_incomplete: availabilitySource?.complete === false,
  };
  const result = {
    capacity_utilization: capacityAnalytics(appointments, availability, availabilitySource),
    cancellation_rebooking: cancellation,
    no_show_analytics: noShowAnalytics(appointments),
    retention: retentionAnalytics(appointments, dates),
    retention_cohorts: retentionAnalytics(appointments, dates),
    appointment_frequency_changes: appointmentFrequencyChanges(appointments, dates),
    engagement_risk: engagement,
    revenue_risk: revenueRisk(appointments, cancellation, engagement),
    call_analytics: callAnalytics(calls),
    source_limits: sourceLimits,
  };
  if (appointmentResultsMayBeIncomplete) {
    const message = `Appointment retrieval is ${sourceLimits.appointment_fetch_status}; appointment-derived analytics must not be presented as complete. ${sourceLimits.appointment_fetch_reason ?? 'Fetch source metadata indicates a partial result.'}`;
    for (const key of ['capacity_utilization', 'cancellation_rebooking', 'no_show_analytics', 'retention', 'retention_cohorts', 'appointment_frequency_changes', 'engagement_risk', 'revenue_risk']) {
      result[key].data_quality = [...(result[key].data_quality ?? []), message];
      result[key].appointment_data_complete = false;
    }
  } else {
    for (const key of ['capacity_utilization', 'cancellation_rebooking', 'no_show_analytics', 'retention', 'retention_cohorts', 'appointment_frequency_changes', 'engagement_risk', 'revenue_risk']) result[key].appointment_data_complete = true;
  }
  return result;
}

module.exports = { calculateAdvisorAnalytics, callAnalytics, cancellationRebooking, noShowAnalytics, retentionAnalytics, appointmentFrequencyChanges, engagementRisk, capacityAnalytics, revenueRisk };
