import { Inject, Injectable, Optional } from '@nestjs/common';

import { DependencyChecksService, DependencyStatuses } from './dependency-checks.service';

export interface HealthResponse {
    status: 'ok' | 'degraded' | 'failed';
    service: 'kaynann-api';
    version: string;
    dependencies: DependencyStatuses;
}

const HEALTHCHECK_DEADLINE_MS = 4500;
const HEALTHCHECK_DEADLINE_TOKEN = 'HEALTHCHECK_DEADLINE_MS';

@Injectable()
export class HealthService {
    constructor(
        @Inject(DependencyChecksService) private readonly dependencyChecks: DependencyChecksService,
        @Optional()
        @Inject(HEALTHCHECK_DEADLINE_TOKEN)
        private readonly deadlineMs = HEALTHCHECK_DEADLINE_MS,
    ) {}

    async check(): Promise<HealthResponse> {
        try {
            const dependencies = await withTimeout(this.dependencyChecks.checkAll(), this.deadlineMs);

            return this.shapeResponse(dependencies);
        } catch {
            return this.shapeResponse(timeoutStatuses(), 'failed');
        }
    }

    private shapeResponse(dependencies: DependencyStatuses, forcedStatus?: HealthResponse['status']): HealthResponse {
        const safeDependencies = {
            postgres: shapeDependency(dependencies.postgres),
            redis: shapeDependency(dependencies.redis),
            mqtt: shapeDependency(dependencies.mqtt),
        } satisfies DependencyStatuses;
        const allUp = Object.values(safeDependencies).every(({ status }) => status === 'up');

        return {
            status: forcedStatus ?? (allUp ? 'ok' : 'degraded'),
            service: 'kaynann-api',
            version: process.env.npm_package_version ?? '0.1.0',
            dependencies: safeDependencies,
        };
    }
}

function shapeDependency(dependency: DependencyStatuses['postgres']): DependencyStatuses['postgres'] {
    return {
        status: dependency.status,
        ...(dependency.latencyMs === undefined ? {} : { latencyMs: dependency.latencyMs }),
        ...(dependency.errorCode === undefined ? {} : { errorCode: dependency.errorCode }),
    };
}

function timeoutStatuses(): DependencyStatuses {
    return {
        postgres: { status: 'down', errorCode: 'HEALTHCHECK_TIMEOUT' },
        redis: { status: 'down', errorCode: 'HEALTHCHECK_TIMEOUT' },
        mqtt: { status: 'down', errorCode: 'HEALTHCHECK_TIMEOUT' },
    };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('healthcheck timed out')), timeoutMs);

        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}
