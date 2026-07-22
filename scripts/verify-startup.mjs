import { spawn, spawnSync } from 'node:child_process';

const host = '127.0.0.1';
const port = process.env.API_PORT ?? '3000';
const startupDeadlineMs = 15_000;
const healthDeadlineMs = 5_000;

const services = spawnSync('pnpm', ['services:up'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

if (services.status !== 0) {
  process.exit(1);
}

const api = spawn('pnpm', ['dev:api'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['ignore', 'ignore', 'ignore'],
});

try {
  const startedAt = Date.now();

  while (Date.now() - startedAt < startupDeadlineMs) {
    try {
      const response = await fetch(`http://${host}:${port}/health`, {
        signal: AbortSignal.timeout(healthDeadlineMs),
      });
      const body = await response.json();

      if (
        response.status === 200 &&
        body.status === 'ok' &&
        body.service === 'kaynann-api' &&
        Object.values(body.dependencies ?? {}).every((dependency) => dependency.status === 'up')
      ) {
        console.log('Startup verification passed: /health is healthy within the 5s limit.');
        process.exitCode = 0;
        break;
      }
    } catch {
      // The API may still be compiling or binding its port.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (process.exitCode !== 0) {
    console.error(`Startup verification failed: /health did not become healthy within ${startupDeadlineMs}ms.`);
    process.exitCode = 1;
  }
} finally {
  api.kill('SIGTERM');
}
