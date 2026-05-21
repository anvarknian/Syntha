const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:3004',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
  'http://127.0.0.1:3003',
  'http://127.0.0.1:3004',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'about:blank',
  'https://example.com',
]

function parseAllowedOrigins(raw) {
  if (!raw || !raw.trim()) return DEFAULT_ALLOWED_ORIGINS
  return raw.split(',').map(part => part.trim()).filter(Boolean)
}

function assertURLAllowed(targetURL, allowedOrigins) {
  if (targetURL === 'about:blank') return
  let parsed
  try {
    parsed = new URL(targetURL)
  } catch (err) {
    throw new Error(`invalid URL: ${targetURL}`)
  }
  const origin = parsed.origin
  if (!allowedOrigins.includes(origin)) {
    throw new Error(`blocked outbound URL by replay sandbox policy: ${targetURL}`)
  }
}

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  parseAllowedOrigins,
  assertURLAllowed,
}
