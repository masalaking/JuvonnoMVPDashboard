import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizedAdvisorClinicScope } from './advisor-scope.js';

test('missing selection uses only the server-authorized clinic list', () => {
  assert.deepEqual(authorizedAdvisorClinicScope(['clinic_a', 'clinic_b'], undefined), ['clinic_a', 'clinic_b']);
});

test('an explicit selection cannot widen scope or substitute all clinics', () => {
  assert.deepEqual(authorizedAdvisorClinicScope(['clinic_a'], ['clinic_b']), []);
  assert.deepEqual(authorizedAdvisorClinicScope(['clinic_a'], []), []);
  assert.deepEqual(authorizedAdvisorClinicScope(['clinic_a', 'clinic_b'], ['clinic_b', 'clinic_x', 'clinic_b']), ['clinic_b']);
});
