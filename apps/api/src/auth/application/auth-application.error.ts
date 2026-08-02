export class DependencyUnavailableError extends Error {
    readonly code = 'DEPENDENCY_UNAVAILABLE' as const;

    constructor(options?: ErrorOptions) {
        super('An authentication dependency is unavailable', options);
        this.name = 'DependencyUnavailableError';
    }
}
