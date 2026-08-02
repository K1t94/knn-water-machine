export interface RequestMetadata {
    requestId: string;
    ipAddress: string;
    userAgent?: string;
}

export interface InstallationIdentity {
    installationId: string;
}

export interface AuthRequestContext {
    metadata: RequestMetadata;
    installation: InstallationIdentity;
}

export interface IdempotentRequestContext extends AuthRequestContext {
    idempotencyKey: string;
}
