import { isAction } from 'mobx';
import { describe, expect, it } from 'vitest';

import { RegistrationStore } from './registration.store';

const legalSet = {
    setVersion: 'set-v1',
    documents: [
        {
            id: '00000000-0000-4000-8000-000000000001',
            kind: 'TERMS_OF_SERVICE' as const,
            version: '1',
            title: 'Conditions',
            content: 'Conditions content',
            mandatory: true,
            contentSha256: 'a'.repeat(64),
        },
        {
            id: '00000000-0000-4000-8000-000000000002',
            kind: 'PRIVACY_POLICY' as const,
            version: '1',
            title: 'Confidentialite',
            content: 'Privacy content',
            mandatory: true,
            contentSha256: 'b'.repeat(64),
        },
    ],
};

describe('RegistrationStore', () => {
    it('owns promo and legal mutations through actions', () => {
        const store = new RegistrationStore();
        [
            store.setPendingPromoCode,
            store.removePendingPromoCode,
            store.beginLoading,
            store.finishLoading,
            store.toggleAcceptance,
            store.beginCompletion,
            store.finishCompletion,
            store.fail,
        ].forEach((mutation) => expect(isAction(mutation)).toBe(true));

        store.setPendingPromoCode('  PROMO  ');
        expect(store.pendingPromoCode).toBe('PROMO');
        store.removePendingPromoCode();
        expect(store.pendingPromoCode).toBeUndefined();
    });

    it('requires every mandatory document before completion', () => {
        const store = new RegistrationStore();
        store.finishLoading(legalSet);
        expect(store.canComplete).toBe(false);
        legalSet.documents.forEach((document) => store.toggleAcceptance(document.id));
        expect(store.canComplete).toBe(true);
    });

    it.each(['loading', 'ready', 'incomplete', 'submitting', 'stale', 'offline', 'error', 'success'] as const)(
        'represents the %s screen state',
        (state) => {
            const store = new RegistrationStore();
            store.setStateForTest(state);
            expect(store.state).toBe(state);
        },
    );
});
