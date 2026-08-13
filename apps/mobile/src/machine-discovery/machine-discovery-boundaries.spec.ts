import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

interface SourceFile {
    readonly path: string;
    readonly source: string;
}

const featureRoot = __dirname;
const mobileSourceRoot = join(featureRoot, '..');
const featureFiles = productionTypeScriptFiles(featureRoot);
const mobileFiles = productionTypeScriptFiles(mobileSourceRoot);

describe('machine discovery mobile architecture boundaries', () => {
    it('keeps long-lived feature state in one MobX store constructed by the composition root', () => {
        const stateOwners = featureFiles
            .filter(
                ({ source }) =>
                    /from\s+['"]mobx['"]/.test(source) && /\bmake(?:Auto)?Observable(?:<|\()/.test(source),
            )
            .map(({ path }) => sourcePath(path));
        const storeConstructions = featureFiles.flatMap(({ path, source }) =>
            [...source.matchAll(/new\s+MachineDiscoveryStore\s*\(/g)].map(() => sourcePath(path)),
        );

        expect(stateOwners).toEqual(['machine-discovery/stores/machine-discovery.store.ts']);
        expect(storeConstructions).toEqual(['machine-discovery/machine-discovery-composition-root.ts']);
    });

    it('keeps screens presentation-oriented without independent feature state or owned streams', () => {
        const screens = featureFiles.filter(({ path }) => path.includes(`${join('machine-discovery', 'screens')}/`));
        const violations = screens.flatMap(({ path, source }) => {
            const reasons = [
                /\buse(?:State|Reducer)\s*\(/.test(source) ? 'React feature state' : undefined,
                /new\s+(?:Behavior|Replay)?Subject(?:<|\()/.test(source) ? 'RxJS Subject' : undefined,
                /\.subscribe\s*\(/.test(source) ? 'long-lived subscription' : undefined,
                /from\s+['"][^'"]*(?:\/api\/|expo-secure-store)[^'"]*['"]/.test(source)
                    ? 'transport or storage import'
                    : undefined,
                /\b(?:globalThis\.)?fetch\s*\(/.test(source) ? 'direct network access' : undefined,
                /new\s+(?:MachineDiscoveryStore|MachineDiscoveryFlowService)\s*\(/.test(source)
                    ? 'feature owner construction'
                    : undefined,
            ].filter((reason): reason is string => reason !== undefined);

            return reasons.map((reason) => `${sourcePath(path)}: ${reason}`);
        });

        expect(violations).toEqual([]);
    });

    it('keeps every instantiated RxJS Subject private', () => {
        const violations = featureFiles.flatMap(({ path, source }) =>
            [...source.matchAll(/^\s*([^\n=]+?)\s*=\s*new\s+(?:Behavior|Replay)?Subject(?:<|\()/gm)]
                .filter((match) => !/^private readonly [A-Za-z_$][\w$]*$/.test(match[1]?.trim() ?? ''))
                .map((match) => `${sourcePath(path)}: ${match[1]?.trim() ?? 'unknown Subject'}`),
        );

        expect(violations).toEqual([]);
    });

    it('requires explicit disposal for every reactive resource owner', () => {
        const reactiveOwners = featureFiles.filter(({ source }) =>
            /new\s+(?:(?:Behavior|Replay)?Subject|Subscription)(?:<|\()|\.subscribe\s*\(/.test(source),
        );
        const missingDisposal = reactiveOwners
            .filter(({ source }) => !/\bdispose\(\): void\s*\{/.test(source))
            .map(({ path }) => sourcePath(path));
        const compositionRoot = readFileSync(join(featureRoot, 'machine-discovery-composition-root.ts'), 'utf8');

        expect(reactiveOwners.map(({ path }) => sourcePath(path))).toEqual([
            'machine-discovery/native/ExpoLocationAdapter.ts',
            'machine-discovery/native/ExpoScannerAdapter.ts',
            'machine-discovery/native/ReactNativeMapAdapter.ts',
            'machine-discovery/services/machine-discovery-flow.service.ts',
        ]);
        expect(missingDisposal).toEqual([]);
        expect(compositionRoot).toMatch(/dispose\(\): void\s*\{\s*this\.flow\.dispose\(\);\s*\}/);
    });

    it('keeps API and SecureStore access behind typed adapters', () => {
        const directNetworkAccess = mobileFiles
            .filter(
                ({ path, source }) =>
                    /\b(?:globalThis\.)?fetch\s*\(/.test(source) && !sourcePath(path).startsWith('api/'),
            )
            .map(({ path }) => sourcePath(path));
        const secureStoreAdapters = mobileFiles
            .filter(({ source }) => /from\s+['"]expo-secure-store['"]/.test(source))
            .map(({ path }) => sourcePath(path));
        const storageAdaptersWithoutPorts = mobileFiles
            .filter(
                ({ path, source }) =>
                    /^auth\/storage\/[^/]+\.storage\.ts$/.test(sourcePath(path)) &&
                    /from\s+['"]expo-secure-store['"]/.test(source),
            )
            .filter(
                ({ source }) =>
                    !/export interface \w+Storage\s*\{/.test(source) ||
                    !/export class \w+\s+implements \w+Storage\s*\{/.test(source),
            )
            .map(({ path }) => sourcePath(path));
        const flowSource = readFileSync(join(featureRoot, 'services', 'machine-discovery-flow.service.ts'), 'utf8');
        const installationIdSource = readFileSync(join(mobileSourceRoot, 'device', 'installation-id.ts'), 'utf8');

        expect(directNetworkAccess).toEqual([]);
        expect(secureStoreAdapters).toEqual([
            'auth/storage/registration-authorization.storage.ts',
            'auth/storage/session.storage.ts',
            'device/installation-id.ts',
        ]);
        expect(storageAdaptersWithoutPorts).toEqual([]);
        expect(installationIdSource).toMatch(
            /export function getOrCreateInstallationId\(\): Observable<string>\s*\{/,
        );
        expect(flowSource).toMatch(
            /export interface MachineDiscoveryApi\s*\{\s*request<T>\([^)]*request: MachineDiscoveryRequest<T>\): Observable<T>;\s*\}/,
        );
    });
});

function productionTypeScriptFiles(directory: string): SourceFile[] {
    return readdirSync(directory, { withFileTypes: true })
        .flatMap((entry): SourceFile[] => {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) return productionTypeScriptFiles(path);
            if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.spec.')) return [];
            return [{ path, source: readFileSync(path, 'utf8') }];
        })
        .sort((left, right) => left.path.localeCompare(right.path));
}

function sourcePath(path: string): string {
    return relative(mobileSourceRoot, path).replaceAll('\\', '/');
}
