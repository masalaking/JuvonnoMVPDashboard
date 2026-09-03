import test from 'node:test';
import assert from 'node:assert/strict';
import { redactPublicSettingsResponse } from './settings-redaction.js';

test('public settings redaction preserves configuration while removing nested credential fields', () => {
  const input = {
    clinic_id: 'clinic-a',
    juvonno_api_key: 'must-not-leave-server',
    settings: {
      clinic_profile: { clinic_name: 'RivaCare' },
      juvonno_integration: { base_url: 'https://example.test', api_key: 'secret' },
      sms_follow_ups: { enabled: true, twilio_account_sid: 'sid', templates: [{ label: 'Reminder', auth_token: 'nope' }] },
    },
  };

  assert.deepEqual(redactPublicSettingsResponse(input), {
    clinic_id: 'clinic-a',
    settings: {
      clinic_profile: { clinic_name: 'RivaCare' },
      juvonno_integration: { base_url: 'https://example.test' },
      sms_follow_ups: { enabled: true, templates: [{ label: 'Reminder' }] },
    },
  });
  assert.equal(input.settings.juvonno_integration.api_key, 'secret');
});
