export const MACHINE_APPLICATION_ERROR_CODES = [
    'AUTHENTICATION_REQUIRED',
    'SESSION_INVALID',
    'VALIDATION_ERROR',
    'MACHINE_CODE_INVALID',
    'MACHINE_NOT_FOUND',
    'DISCOVERY_CONTEXT_STALE',
    'MACHINE_CONTEXT_CHANGED',
    'MACHINE_NOT_SELECTABLE',
    'DISCOVERY_TEMPORARILY_UNAVAILABLE',
] as const;

export type MachineApplicationErrorCode = (typeof MACHINE_APPLICATION_ERROR_CODES)[number];

export interface MachineApplicationErrorOptions extends ErrorOptions {
    internalDetails?: Readonly<Record<string, unknown>>;
}

export class MachineApplicationError extends Error {
    readonly name = 'MachineApplicationError';

    constructor(
        readonly code: MachineApplicationErrorCode,
        options: MachineApplicationErrorOptions = {},
    ) {
        super('Machine application request failed', options);
        this.internalDetails = options.internalDetails;
    }

    readonly internalDetails: Readonly<Record<string, unknown>> | undefined;
}
