import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicWebsiteUrl } from './public-website-url.js';

test('website submissions accept ordinary public HTTPS hostnames', () => {
  assert.equal(parsePublicWebsiteUrl('https://www.example.com/clinic?source=dashboard')?.toString(), 'https://www.example.com/clinic?source=dashboard');
});

test('website submissions reject credentialed, local, and IP-literal targets', () => {
  for (const url of [
    'http://www.example.com',
    'https://user:password@example.com',
    'https://localhost/admin',
    'https://api.internal/metadata',
    'https://127.0.0.1:3000/',
    'https://[::1]/',
    'https://169.254.169.254/latest/meta-data/',
  ]) assert.equal(parsePublicWebsiteUrl(url), null, url);
});
