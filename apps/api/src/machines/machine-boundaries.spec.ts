import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const controllerDirectory = join(__dirname, 'http');
const controllerFiles = ['machine-discovery.controller.ts', 'machine-selection.controller.ts'] as const;

const controllers = controllerFiles.map((fileName) => ({
    fileName,
    source: readFileSync(join(controllerDirectory, fileName), 'utf8'),
}));

const allowedDomainImports = new Set(['../domain/machine-validation', '../domain/machine.types']);
const forbiddenCapability =
    /(?:^|[/.-])(?:erp|mqtt|payments?|wallet(?:-commands?)?|reservations?|purchases?|dispens(?:e|ing)?)(?:[/.-]|$)/i;

function importSpecifiers(source: string): string[] {
    return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

describe('machine HTTP architecture boundaries', () => {
    it('keeps controllers on transport and application-service dependencies', () => {
        const forbiddenLayerImports = controllers.flatMap(({ fileName, source }) =>
            importSpecifiers(source)
                .filter(
                    (specifier) =>
                        /(?:^|\/)infrastructure(?:\/|$)/.test(specifier) ||
                        /(?:^|\/)application\/ports(?:\/|$)/.test(specifier) ||
                        (specifier.startsWith('../domain/') && !allowedDomainImports.has(specifier)) ||
                        specifier === '@prisma/client' ||
                        specifier === 'rxjs',
                )
                .map((specifier) => `${fileName}: ${specifier}`),
        );

        expect(forbiddenLayerImports).toEqual([]);
    });

    it('does not import ERP, machine-command, payment, wallet-command, reservation, purchase, or dispensing capabilities', () => {
        const forbiddenImports = controllers.flatMap(({ fileName, source }) =>
            importSpecifiers(source)
                .filter((specifier) => forbiddenCapability.test(specifier))
                .map((specifier) => `${fileName}: ${specifier}`),
        );

        expect(forbiddenImports).toEqual([]);
    });

    it('delegates every machine route to exactly one injected application service', () => {
        const expectedDelegations = {
            'machine-discovery.controller.ts': ['discovery', 'identifierResolver', 'detail'],
            'machine-selection.controller.ts': ['selection'],
        } as const;

        for (const { fileName, source } of controllers) {
            const routeCount = [...source.matchAll(/\n\s+@(Get|Post)\(/g)].length;
            const delegations = [...source.matchAll(/await\s+this\.(\w+)\.execute\(/g)].map((match) => match[1]);

            expect(delegations, fileName).toEqual(expectedDelegations[fileName]);
            expect(delegations, fileName).toHaveLength(routeCount);
            expect(source, fileName).not.toMatch(/\b(?:repository|gateway|prisma|mqtt|broker)\b/i);
            expect(source, fileName).not.toMatch(/\.\$(?:queryRaw|executeRaw)|\.(?:publish|sendCommand|reserve|debit|dispense)\(/);
        }
    });
});
