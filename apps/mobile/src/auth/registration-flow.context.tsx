import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';

import { FeatureAvailabilityStore } from '../features/stores/feature-availability.store';

import { RegistrationFlowService, type RegistrationCommands } from './services/registration-flow.service';
import {
    DevelopmentWebRegistrationAuthorizationStorage,
    SecureRegistrationAuthorizationStorage,
    type RegistrationAuthorizationStorage,
} from './storage/registration-authorization.storage';
import { RegistrationStore } from './stores/registration.store';

import type { AuthCompositionRoot } from './auth-composition-root';
import type { AuthApi, SessionCredentials } from '../api/auth-api';

export interface RegistrationFlowContextValue {
    store: RegistrationStore;
    commands: RegistrationCommands;
    availability: FeatureAvailabilityStore;
}

const RegistrationFlowContext = createContext<RegistrationFlowContextValue | undefined>(undefined);

export function RegistrationFlowProvider({
    api,
    root,
    children,
    onCompleted,
}: {
    api: AuthApi;
    root?: AuthCompositionRoot;
    children: React.ReactNode;
    onCompleted?: (session: SessionCredentials) => void;
}): React.JSX.Element {
    const completedRef = useRef(onCompleted);
    completedRef.current = onCompleted;
    const scope = useMemo(() => {
        if (root) return { ...root.createRegistrationScope(), availability: root.featureAvailabilityStore };
        const store = new RegistrationStore();
        const availability = new FeatureAvailabilityStore();
        availability.finishRefresh(availability.beginRefresh(), true);
        return {
            store,
            availability,
            commands: new RegistrationFlowService(store, api, createRegistrationAuthorizationStorage(), (session) =>
                completedRef.current?.(session),
            ),
        };
    }, [api, root]);
    useEffect(() => {
        scope.commands.restore();
        return () => {
            if (scope.commands instanceof RegistrationFlowService) {
                scope.commands.dispose();
            }
        };
    }, [scope]);
    return <RegistrationFlowContext.Provider value={scope}>{children}</RegistrationFlowContext.Provider>;
}

export function useRegistrationFlow(): RegistrationFlowContextValue {
    const value = useContext(RegistrationFlowContext);
    if (!value) throw new Error('RegistrationFlowProvider is required');
    return value;
}

function createRegistrationAuthorizationStorage(): RegistrationAuthorizationStorage {
    if (Platform.OS !== 'web') {
        return new SecureRegistrationAuthorizationStorage();
    }
    if (!__DEV__) {
        throw new Error('Web registration storage is development-only');
    }
    return new DevelopmentWebRegistrationAuthorizationStorage();
}
