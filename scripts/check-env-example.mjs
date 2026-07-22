import { readFile } from 'node:fs/promises';

const file = '.env.example';
const requiredKeys = [
  'NODE_ENV',
  'API_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'DATABASE_URL',
  'REDIS_URL',
  'MQTT_URL',
  'MQTT_CLIENT_ID',
];
const forbiddenPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /(?:sk|pk|rk)_(?:live|prod)_[a-z0-9]+/i,
  /(?:password|secret|token|api[_-]?key)\s*[:=]\s*[^\s#]{24,}/i,
  /(?:prod|production|staging)\.(?:[a-z0-9-]+\.)+[a-z]{2,}/i,
];

const contents = await readFile(file, 'utf8');
const entries = new Map();
const errors = [];

for (const [index, rawLine] of contents.split('\n').entries()) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;

  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (!match) {
    errors.push(`${file}:${index + 1}: expected KEY=value`);
    continue;
  }

  const [, key, value] = match;
  entries.set(key, value);
  const isDocumentedLocalPassword = key === 'POSTGRES_PASSWORD' && value === 'local_dev_only_not_for_production';
  if (!value || (!isDocumentedLocalPassword && forbiddenPatterns.some((pattern) => pattern.test(line)))) {
    errors.push(`${file}:${index + 1}: unsafe or empty environment value for ${key}`);
  }
}

for (const key of requiredKeys) {
  if (!entries.has(key)) errors.push(`${file}: missing required key ${key}`);
}

const expected = {
  NODE_ENV: 'development',
  API_PORT: '3000',
  POSTGRES_DB: 'kaynann',
  POSTGRES_USER: 'kaynann',
  POSTGRES_PASSWORD: 'local_dev_only_not_for_production',
  DATABASE_URL: 'postgresql://kaynann:local_dev_only_not_for_production@localhost:5432/kaynann?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  MQTT_URL: 'mqtt://localhost:1883',
  MQTT_CLIENT_ID: 'kaynann-api-local',
};

for (const [key, value] of Object.entries(expected)) {
  if (entries.get(key) !== value) {
    errors.push(`${file}: ${key} must use the documented local placeholder`);
  }
}

if (errors.length > 0) {
  console.error(['Environment example check failed:', ...errors.map((error) => `- ${error}`)].join('\n'));
  process.exit(1);
}

console.log('Environment example check passed: local placeholders only.');
