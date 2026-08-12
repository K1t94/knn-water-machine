import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const referralRoot = __dirname;
const apiSourceRoot = join(referralRoot, '..');

function productionTypeScriptFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return productionTypeScriptFiles(path);
        return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
    });
}

describe('referral architecture boundaries', () => {
    it.each(['domain', 'application'])('%s does not import Prisma or infrastructure', (layer) => {
        const violations = productionTypeScriptFiles(join(referralRoot, layer)).filter((path) => {
            const source = readFileSync(path, 'utf8');
            return (
                /from\s+['"]@prisma\/client['"]/.test(source) ||
                /from\s+['"][^'"]*infrastructure(?:\/[^'"]*)?['"]/.test(source)
            );
        });

        expect(violations).toEqual([]);
    });

    it('does not reference retired eligibility models or close commands at runtime', () => {
        const violations = productionTypeScriptFiles(apiSourceRoot).filter((path) => {
            const source = readFileSync(path, 'utf8');
            return /\bReferralEligibility\b|\breferralEligibility\b|\bCloseReferralEligibility\b|\bcloseReferralEligibility\b/.test(
                source,
            );
        });

        expect(violations).toEqual([]);
    });

    it('does not expose a post-registration referral application route', () => {
        const controllerFiles = productionTypeScriptFiles(join(referralRoot, 'http')).filter((path) =>
            path.endsWith('.controller.ts'),
        );
        const violations = controllerFiles.filter((path) => {
            const source = readFileSync(path, 'utf8');
            return /\/applications\b|ApplyReferralCode|applyReferralCode/.test(source);
        });

        expect(violations).toEqual([]);
    });
});
