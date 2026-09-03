const SENSITIVE_SETTING_KEY = /(?:^|[_-])(?:api[_-]?key|secret|token|password|authorization|bearer|private[_-]?key|access[_-]?key|auth[_-]?token|account[_-]?sid|webhook[_-]?key)(?:$|[_-])/i;

// Settings are user-facing configuration, but legacy JSON may still contain
// an integration credential. Strip credential-shaped keys recursively before
// the public Settings response leaves the BFF.
export function redactPublicSettings(value, depth = 0) {
  if (depth > 20 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactPublicSettings(item, depth + 1));

  const safe = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_SETTING_KEY.test(key)) continue;
    safe[key] = redactPublicSettings(item, depth + 1);
  }
  return safe;
}

export function redactPublicSettingsResponse(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return response;
  const safe = { ...response };
  for (const key of Object.keys(safe)) {
    if (SENSITIVE_SETTING_KEY.test(key)) delete safe[key];
  }
  if (safe.settings && typeof safe.settings === 'object') safe.settings = redactPublicSettings(safe.settings);
  return safe;
}
