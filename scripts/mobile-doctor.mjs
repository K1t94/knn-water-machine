import { execFileSync } from 'node:child_process';

const commands = [
    ['node', '--version'],
    ['pnpm', '--version'],
    ['xcodebuild', '-version'],
    ['adb', 'version'],
    ['java', '-version'],
];

console.log('Expo development prerequisites:');
for (const [command, ...args] of commands) {
    try {
        const output = execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        console.log(`- ${command}: available${output ? ` (${output.split('\n')[0]})` : ''}`);
    } catch {
        console.log(`- ${command}: not found (optional unless building for that platform)`);
    }
}

console.log('JavaScript Expo checks remain available without native SDKs.');
