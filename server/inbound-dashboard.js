function durationDisplay(value) {
  const seconds = Math.round((Number(value) || 0) * 60);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes && remainder) return `${minutes} minute${minutes === 1 ? '' : 's'} ${remainder} second${remainder === 1 ? '' : 's'}`;
  if (minutes) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${remainder} second${remainder === 1 ? '' : 's'}`;
}

function parseTranscript(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    if (/^(Agent|AI):/i.test(line)) return { speaker: 'AI', text: line.replace(/^(Agent|AI):/i, '').trim() };
    if (/^(User|Caller):/i.test(line)) return { speaker: 'Caller', text: line.replace(/^(User|Caller):/i, '').trim() };
    return { speaker: 'System', text: line };
  }).filter(line => line.text);
}

export function buildInboundCalls(rows) {
  return { calls: rows.slice(0, 200).map(row => {
    const duration = Number(row.call_duration_min) || 0;
    const display = durationDisplay(duration);
    return { id: row.call_id, call_id: row.call_id, date: row.call_date, timestamp: row.call_timestamp || '', callerName: row.from_number || 'Unknown', from: row.from_number || 'Unknown', duration_min: duration, durationDisplay: display, duration_display: display, status: row.call_status || 'ended', reason: row.disconnect_reason || '', summary: row.call_summary || '', hasTranscript: Boolean(row.has_transcript), hasRecording: Boolean(row.has_recording), recording_url: row.recording_url || '', recordingUrl: row.recording_url || '', sentiment: row.sentiment || '' };
  }) };
}

export function buildInboundTranscripts(rows) {
  return { transcripts: rows.filter(row => String(row.transcript || '').trim()).slice(0, 100).map(row => {
    const duration = Number(row.call_duration_min) || 0;
    const display = durationDisplay(duration);
    const transcript = parseTranscript(row.transcript);
    return { call_id: row.call_id, id: row.call_id, date: row.call_date, timestamp: row.call_timestamp || '', callerName: row.from_number || 'Unknown', duration_min: duration, durationDisplay: display, duration_display: display, status: row.call_status || 'completed', summary: row.call_summary || '', sentiment: row.sentiment || 'Unknown', words: Number(row.word_count) || 0, recording_url: row.recording_url || '', recordingUrl: row.recording_url || '', transcript, raw_transcript: row.transcript || '', details: [{ label: 'Duration', value: display }, { label: 'Sentiment', value: row.sentiment || 'Unknown' }, { label: 'Words', value: (Number(row.word_count) || 0).toLocaleString() }] };
  }) };
}

export function buildInboundAnalytics(rows, range = 1) {
  const config = [{ bucket: 'hour', count: 24 }, { bucket: 'day', count: 30 }, { bucket: 'week', count: 4 }, { bucket: 'month', count: 2 }, { bucket: 'month', count: 3 }, { bucket: 'month', count: 6 }, { bucket: 'month', count: 12 }, { bucket: 'month', count: 99 }][Number(range)] || { bucket: 'day', count: 30 };
  const groups = new Map();
  for (const row of rows) {
    const date = new Date(row.call_timestamp || row.call_date || 0);
    let label = config.bucket === 'month' ? String(row.call_month || row.call_date || '').slice(0, 7) : String(row.call_date || '').slice(0, 10);
    if (config.bucket === 'hour') label = `${String(date.getHours()).padStart(2, '0')}:00`;
    if (!label) continue;
    const group = groups.get(label) || { label, calls: 0, minutes: 0, completed: 0, missed: 0 };
    group.calls += 1; group.minutes += Number(row.call_duration_min) || 0;
    if (['ended', 'completed', 'successful'].includes(String(row.call_status || '').toLowerCase())) group.completed += 1; else group.missed += 1;
    groups.set(label, group);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label)).slice(-config.count).map(group => ({ ...group, minutes: Number(group.minutes.toFixed(1)), avg: Number((group.minutes / group.calls).toFixed(1)) }));
}
