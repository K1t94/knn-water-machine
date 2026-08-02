import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const envFile = await readFile('.env', 'utf8');
const localEnv = {};

for (const rawLine of envFile.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) localEnv[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
}

const child = spawn('pnpm', ['--filter', '@kaynann/api', 'exec', 'prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, ...localEnv },
    stdio: 'inherit',
});

child.on('exit', (code, signal) => {
    if (signal) {
        console.error(`Database migration terminated by ${signal}.`);
        process.exitCode = 1;
    } else {
        process.exitCode = code ?? 1;
    }
});
