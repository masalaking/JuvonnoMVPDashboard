import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInboundCalls, buildInboundTranscripts, buildInboundAnalytics } from './inbound-dashboard.js';

const row = { call_id: 'c1', call_date: '2026-09-02', call_timestamp: '2026-09-02T10:00:00', call_month: '2026-09', from_number: '+14165550199', call_status: 'ended', call_duration_min: 1.5, call_summary: 'Booked.', sentiment: 'Positive', transcript: 'Agent: Hello\nCaller: Hi', recording_url: 'https://example.test/r', has_transcript: true, has_recording: true, word_count: 4 };
test('inbound historical formatters preserve the established dashboard contract', () => {
  assert.equal(buildInboundCalls([row]).calls[0].durationDisplay, '1 minute 30 seconds');
  assert.equal(buildInboundTranscripts([row]).transcripts[0].transcript[1].speaker, 'Caller');
  assert.deepEqual(buildInboundAnalytics([row], 1), [{ label: '2026-09-02', calls: 1, minutes: 1.5, completed: 1, missed: 0, avg: 1.5 }]);
});
