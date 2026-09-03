import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ADVISOR_ENCRYPTION_KEY = '11'.repeat(32);
process.env.ADVISOR_ENCRYPTION_KEY_VERSION = 'v1';
const { encryptAdvisorText, decryptAdvisorText, advisorSensitiveHash, advisorEncryptionReady } = await import('./advisor-crypto.js');

test('Advisor encryption round-trips with unique AES-GCM IVs', () => {
  assert.equal(advisorEncryptionReady(), true);
  const first = encryptAdvisorText('private clinic context');
  const second = encryptAdvisorText('private clinic context');
  assert.notDeepEqual(first.iv, second.iv);
  assert.equal(decryptAdvisorText({ content_ciphertext:first.ciphertext, content_iv:first.iv, content_auth_tag:first.authTag }), 'private clinic context');
});

test('sensitive hashes are deterministic but do not expose plaintext', () => {
  const a=advisorSensitiveHash('Patient-123'); const b=advisorSensitiveHash('patient-123');
  assert.equal(a,b); assert.equal(a.length,64); assert.equal(a.includes('patient'),false);
});
