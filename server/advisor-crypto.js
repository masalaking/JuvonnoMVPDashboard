import crypto from 'crypto';

const KEY_VERSION = process.env.ADVISOR_ENCRYPTION_KEY_VERSION ?? 'v1';

function decodeKey(value) {
  const text = String(value ?? '').trim();
  if (/^[a-f0-9]{64}$/i.test(text)) return Buffer.from(text, 'hex');
  try {
    const decoded = Buffer.from(text, 'base64');
    return decoded.length === 32 ? decoded : null;
  } catch { return null; }
}

function keyring() {
  const keys = {};
  if (process.env.ADVISOR_ENCRYPTION_KEYS) {
    try {
      const parsed = JSON.parse(process.env.ADVISOR_ENCRYPTION_KEYS);
      for (const [version,value] of Object.entries(parsed)) {
        const key=decodeKey(value); if (key) keys[version]=key;
      }
    } catch { /* fail closed below */ }
  }
  const current=decodeKey(process.env.ADVISOR_ENCRYPTION_KEY);
  if (current) keys[KEY_VERSION]=current;
  return keys;
}

function activeKey(version = KEY_VERSION) {
  const key = keyring()[version];
  if (!key) {
    const error = new Error(`Advisor encryption key ${version} is not configured.`);
    error.status = 503;
    error.code = 'ADVISOR_ENCRYPTION_NOT_CONFIGURED';
    throw error;
  }
  return key;
}

export function advisorEncryptionReady() {
  try { activeKey(); return true; } catch { return false; }
}

export function encryptAdvisorText(plaintext) {
  const key = activeKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion: KEY_VERSION };
}

export function decryptAdvisorText(row) {
  const key = activeKey(row.encryption_key_version ?? KEY_VERSION);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.content_iv));
  decipher.setAuthTag(Buffer.from(row.content_auth_tag));
  return Buffer.concat([decipher.update(Buffer.from(row.content_ciphertext)), decipher.final()]).toString('utf8');
}

export function advisorSensitiveHash(value) {
  return crypto.createHmac('sha256', activeKey()).update(String(value).trim().toLowerCase()).digest('hex');
}
