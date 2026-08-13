import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DiscoverMachinesService } from '../../src/machines/application/discover-machines.service';
import { GetMachineDetailService } from '../../src/machines/application/get-machine-detail.service';
import { ResolveMachineIdentifierService } from '../../src/machines/application/resolve-machine-identifier.service';
import { RevalidateMachineSelectionService } from '../../src/machines/application/revalidate-machine-selection.service';
import { MachineDiscoveryController } from '../../src/machines/http/machine-discovery.controller';
import { MachineErrorFilter } from '../../src/machines/http/machine-error.filter';
import { MachineSelectionController } from '../../src/machines/http/machine-selection.controller';
import { AccessTokenService } from '../../src/sessions/application/access-token.service';
import { AccessSessionGuard } from '../../src/sessions/http/access-session.guard';
import { SessionsRepository } from '../../src/sessions/infrastructure/postgres/sessions.repository';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

type HttpMethod = 'get' | 'post';

type OperationExpectation = {
    readonly method: HttpMethod;
    readonly parameters: readonly string[];
    readonly path: string;
    readonly responses: Readonly<Record<string, string>>;
};

const contractPath = resolve(
    __dirname,
    '../../../../specs/006-machine-discovery-and-selection/contracts/machine-discovery.openapi.yaml',
);

const expectedOperations: readonly OperationExpectation[] = [
    {
        method: 'get',
        path: '/v1/machines',
        parameters: ['limit', 'cursor', 'latitude', 'longitude', 'north', 'east', 'south', 'west'],
        responses: {
            '200': 'MachineCatalogPage',
            '400': 'ValidationProblem',
            '401': 'Problem',
            '409': 'Problem',
            '503': 'Problem',
        },
    },
    {
        method: 'get',
        path: '/v1/machines/{machineId}',
        parameters: ['machineId', 'latitude', 'longitude'],
        responses: {
            '200': 'MachineDetail',
            '400': 'ValidationProblem',
            '401': 'Problem',
            '404': 'Problem',
            '503': 'Problem',
        },
    },
    {
        method: 'post',
        path: '/v1/machines/resolve',
        parameters: [],
        responses: {
            '200': 'MachineDetail',
            '400': 'Problem',
            '401': 'Problem',
            '404': 'Problem',
            '503': 'Problem',
        },
    },
    {
        method: 'post',
        path: '/v1/machines/{machineId}/selection-revalidation',
        parameters: ['machineId'],
        responses: {
            '200': 'MachineSelectionHandoff',
            '400': 'ValidationProblem',
            '401': 'Problem',
            '404': 'Problem',
            '409': 'MachineContextChangedProblem',
            '422': 'Problem',
            '503': 'Problem',
        },
    },
] as const;

const responseFields = {
    Coordinates: ['latitude', 'longitude'],
    MachineCatalogPage: ['catalogRevision', 'hasMore', 'items', 'nextCursor'],
    MachineContextChangedProblem: ['code', 'correlationId', 'currentMachine', 'message', 'retryable'],
    MachineDetail: [
        'address',
        'coordinates',
        'displayName',
        'distanceMeters',
        'machineId',
        'machineRevision',
        'price',
        'refreshedAt',
        'selectable',
        'status',
    ],
    MachineSelectionHandoff: ['availability', 'machineId', 'machineRevision', 'price', 'validatedAt'],
    MachineSummary: [
        'address',
        'coordinates',
        'displayName',
        'distanceMeters',
        'machineId',
        'machineRevision',
        'price',
        'status',
    ],
    PricePerLiter: ['amountPerLiter', 'currency'],
    Problem: ['code', 'correlationId', 'message', 'retryable'],
    ValidationProblem: ['code', 'correlationId', 'fields', 'message', 'retryable'],
} as const;

describe('machine discovery generated OpenAPI contract', () => {
    let app: INestApplication;
    let document: OpenAPIObject;
    let sourceContract: string;

    beforeAll(async () => {
        const module = await Test.createTestingModule({
            controllers: [MachineDiscoveryController, MachineSelectionController],
            providers: [
                { provide: DiscoverMachinesService, useValue: { execute: () => undefined } },
                { provide: GetMachineDetailService, useValue: { execute: () => undefined } },
                { provide: ResolveMachineIdentifierService, useValue: { execute: () => undefined } },
                { provide: RevalidateMachineSelectionService, useValue: { execute: () => undefined } },
                { provide: AccessTokenService, useValue: { validate: () => undefined } },
                { provide: SessionsRepository, useValue: { findActive: () => undefined } },
                AccessSessionGuard,
                MachineErrorFilter,
            ],
        }).compile();

        app = module.createNestApplication();
        document = SwaggerModule.createDocument(
            app,
            new DocumentBuilder().addBearerAuth({ scheme: 'bearer', type: 'http' }, 'AccessBearer').build(),
        );
        sourceContract = readFileSync(contractPath, 'utf8');
    });

    afterAll(() => app.close());

    it('publishes exactly the four approved authenticated machine operations', () => {
        expect(Object.keys(document.paths).sort()).toEqual(expectedOperations.map(({ path }) => path).sort());

        for (const expected of expectedOperations) {
            expect(sourceContract).toContain(`  ${expected.path}:`);
            expect(Object.keys(document.paths[expected.path])).toEqual([expected.method]);
            expect(operation(expected).security).toEqual([{ AccessBearer: [] }]);
        }
    });

    it('matches the approved path, query, and request-body structures', () => {
        for (const expected of expectedOperations) {
            const parameters = operation(expected).parameters ?? [];
            expect(parameters.map((parameter) => parameter.name).sort()).toEqual([...expected.parameters].sort());
            for (const parameter of parameters) {
                expect(parameter.required).toBe(parameter.in === 'path');
            }
        }

        const resolveBody = requestSchema(expectedOperations[2]);
        expect(resolveBody.discriminator).toEqual({ propertyName: 'source' });
        expect(resolveBody.oneOf).toEqual([
            expect.objectContaining({
                additionalProperties: false,
                properties: {
                    source: { enum: ['QR'], type: 'string' },
                    value: { maxLength: 2048, minLength: 1, type: 'string' },
                },
                required: ['source', 'value'],
                type: 'object',
            }),
            expect.objectContaining({
                additionalProperties: false,
                properties: {
                    source: { enum: ['MANUAL'], type: 'string' },
                    value: { maxLength: 256, minLength: 1, type: 'string' },
                },
                required: ['source', 'value'],
                type: 'object',
            }),
        ]);

        expect(requestSchema(expectedOperations[3])).toEqual({
            $ref: '#/components/schemas/RevalidateMachineSelectionDto',
        });
        expect(schemaFields('RevalidateMachineSelectionDto')).toEqual(['expectedMachineRevision']);
    });

    it('matches every approved response status and schema', () => {
        for (const expected of expectedOperations) {
            const responses = operation(expected).responses;
            expect(Object.keys(responses)).toEqual(Object.keys(expected.responses));

            for (const [status, schema] of Object.entries(expected.responses)) {
                expect(sourceContract).toContain(`#/components/schemas/${schema}`);
                expect(responseSchemaRef(expected, status)).toBe(`#/components/schemas/${schema}`);
            }
        }
    });

    it('keeps public response schemas allowlisted and free of internal machine fields', () => {
        for (const [schema, fields] of Object.entries(responseFields)) {
            expect(schemaFields(schema)).toEqual(fields);
            for (const field of fields) expect(sourceContract).toContain(`        ${field}:`);
        }

        const publicSchemas = Object.entries(document.components?.schemas ?? {})
            .filter(([name]) => name in responseFields)
            .map(([, schema]) => schema);
        expect(JSON.stringify(publicSchemas)).not.toMatch(
            /internalId|machineInternalId|identifierMapping|orderingRevision|selectionRevision|serviceAreaCode|sourceRevision|evidence|topic|credential/i,
        );
    });

    function operation(expected: OperationExpectation) {
        const result = document.paths[expected.path]?.[expected.method];
        expect(result, `${expected.method.toUpperCase()} ${expected.path}`).toBeDefined();
        return result!;
    }

    function requestSchema(expected: OperationExpectation): Record<string, unknown> {
        const body = operation(expected).requestBody;
        expect(body).toBeDefined();
        expect(body).not.toHaveProperty('$ref');
        return (body as { content: { 'application/json': { schema: Record<string, unknown> } } }).content[
            'application/json'
        ].schema;
    }

    function responseSchemaRef(expected: OperationExpectation, status: string): string | undefined {
        const response = operation(expected).responses[status];
        if (!response || '$ref' in response) return undefined;
        const contentType = status === '200' ? 'application/json' : 'application/problem+json';
        const schema = response.content?.[contentType]?.schema;
        return schema && '$ref' in schema ? schema.$ref : undefined;
    }

    function schemaFields(name: string): string[] {
        const schema = document.components?.schemas?.[name];
        expect(schema, name).toBeDefined();
        expect(schema).not.toHaveProperty('$ref');
        return Object.keys((schema as { properties?: Record<string, unknown> }).properties ?? {}).sort();
    }
});
