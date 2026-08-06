import { describe, expect, it, vi } from 'vitest';

import { CredentialCryptoService } from '../../common/security/credential-crypto.service';
import { ReferralError } from '../../referral/domain/referral-errors';

import { DependencyUnavailableError } from './auth-application.error';
import { RegistrationService } from './registration.service';

const installationId = 'registration-referral-unit-installation';

describe('RegistrationService referral pre-validation', () => {
    it.each([
        ['invalid', 'bad'],
        ['unknown', '23456789ABCD'],
        ['overlong', '2'.repeat(65)],
    ])('does not consume registration authorization for %s promo input', async (_case, pendingPromoCode) => {
        const setup = createSetup(pendingPromoCode);
        setup.referral.prevalidatePendingPromo.mockRejectedValue(
            new ReferralError('REFERRAL_CODE_UNAVAILABLE', 'Referral code is unavailable'),
        );

        await expect(setup.service.complete(command())).rejects.toMatchObject({ code: 'REFERRAL_CODE_UNAVAILABLE' });
        expect(setup.registrations.beginCompletion).not.toHaveBeenCalled();

        await setup.service.updatePendingPromo('registration-authorization', '23456789ABCD');
        await setup.service.updatePendingPromo('registration-authorization', null);
        expect(setup.registrations.updatePromo).toHaveBeenNthCalledWith(
            1,
            'registration-authorization',
            '23456789ABCD',
        );
        expect(setup.registrations.updatePromo).toHaveBeenNthCalledWith(2, 'registration-authorization', null);
    });

    it('pre-validates a valid promo before beginning completion', async () => {
        const setup = createSetup('23456789ABCD');
        setup.referral.prevalidatePendingPromo.mockResolvedValue('23456789ABCD');
        setup.registrations.beginCompletion.mockRejectedValue(new Error('stop after ordering assertion'));

        await expect(setup.service.complete(command())).rejects.toBeInstanceOf(DependencyUnavailableError);
        expect(setup.referral.prevalidatePendingPromo).toHaveBeenCalledWith('23456789ABCD', undefined);
        expect(setup.referral.prevalidatePendingPromo.mock.invocationCallOrder[0]).toBeLessThan(
            setup.registrations.beginCompletion.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
        );
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
        prevalidatePendingPromo: vi.fn(),
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
