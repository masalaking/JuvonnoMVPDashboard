import { isIP } from 'node:net';

// Website submissions may later be retrieved by an internal reviewer or
// worker. Accept only an ordinary public DNS hostname here; do not allow a
// browser to turn that later fetch into a localhost, private-network, or
// cloud-metadata request.
const LOCAL_HOSTNAME = /(?:^|\.)(?:localhost|local|internal|home|lan|test)$/i;

export function parsePublicWebsiteUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value ?? '').trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!hostname || isIP(hostname) || LOCAL_HOSTNAME.test(hostname)) return null;
  return parsed;
}
