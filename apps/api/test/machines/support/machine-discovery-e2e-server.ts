import 'reflect-metadata';
import { resolve } from 'node:path';

import * as dotenv from 'dotenv';

import { createMachineDiscoveryE2EApplication, loadMachineDiscoveryE2EHostConfig } from './machine-discovery-e2e-host';

dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '../../.env') });

async function main(): Promise<void> {
    const config = loadMachineDiscoveryE2EHostConfig();
    const app = await createMachineDiscoveryE2EApplication(config);
    await app.listen(config.port, '0.0.0.0');
    process.stdout.write(`${JSON.stringify({ event: 'machine_discovery_e2e_host_ready', port: config.port })}\n`);
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown E2E host failure';
    process.stderr.write(`${JSON.stringify({ event: 'machine_discovery_e2e_host_failed', message })}\n`);
    process.exitCode = 1;
});
