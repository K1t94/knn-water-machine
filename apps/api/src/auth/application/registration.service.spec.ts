import { describe, expect, it, vi } from 'vitest';

import { CredentialCryptoService } from '../../common/security/credential-crypto.service';

import { DependencyUnavailableError } from './auth-application.error';
import { RegistrationService } from './registration.service';

const installationId = 'registration-referral-unit-installation';

describe('RegistrationService pending referral context', () => {
    it('allows the pending promo to be replaced and removed before completion', async () => {
        const pendingPromoCode = 'bad';
        const setup = createSetup(pendingPromoCode);

        await setup.service.updatePendingPromo('registration-authorization', '23456789ABCD');
        await setup.service.updatePendingPromo('registration-authorization', null);
        expect(setup.registrations.updatePromo).toHaveBeenNthCalledWith(
            1,
            'registration-authorization',
            '23456789ABCD',
        );
        expect(setup.registrations.updatePromo).toHaveBeenNthCalledWith(2, 'registration-authorization', null);
    });

    it('does not query referral state before beginning registration completion', async () => {
        const setup = createSetup('23456789ABCD');
        setup.registrations.beginCompletion.mockRejectedValue(new Error('stop after ordering assertion'));

        await expect(setup.service.complete(command())).rejects.toBeInstanceOf(DependencyUnavailableError);
        expect(setup.registrations.beginCompletion).toHaveBeenCalledTimes(1);
        expect(setup.referral.completeOnboarding).not.toHaveBeenCalled();
    });
});

function createSetup(pendingPromoCode: string) {
    const crypto = new CredentialCryptoService();
    const registrations = {
        inspect: vi.fn(async () => ({
            phoneE164: '+221771234567',
            phoneConfirmedAt: new Date('2026-08-10T00:00:00.000Z'),
            installationFingerprint: crypto.fingerprintInstallation(installationId).digest,
            pendingPromoCode,
            state: 'ACTIVE',
        })),
        beginCompletion: vi.fn(),
        updatePromo: vi.fn(async () => undefined),
    };
    const referral = {
        completeOnboarding: vi.fn(),
        deliverAfterCommit: vi.fn(),
    };
    const service = new RegistrationService(
        {} as never,
        registrations as never,
        { assertCurrentSet: vi.fn(async () => undefined) } as never,
        {} as never,
        {} as never,
        {} as never,
        crypto,
        referral,
    );
    return { service, registrations, referral };
}

function command() {
    return {
        registrationAuthorization: 'registration-authorization',
        idempotencyKey: 'registration-referral-unit-key',
        setVersion: 'legal-set',
        acceptedDocumentIds: [],
        installationId,
    };
}
