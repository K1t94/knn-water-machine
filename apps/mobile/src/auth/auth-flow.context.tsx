import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';

import type { AuthApi, OtpVerified } from '../api/auth-api';
import type { AuthCompositionRoot } from './auth-composition-root';
import { OtpFlowService, type OtpCommands } from './services/otp-flow.service';
import { OtpStore } from './stores/otp.store';

export interface AuthFlowContextValue {
  store: OtpStore;
  commands: OtpCommands;
}

const AuthFlowContext = createContext<AuthFlowContextValue | undefined>(
  undefined,
);

export function AuthFlowProvider({
  api,
  root,
  children,
  getPendingPromoCode,
  onVerified,
}: {
  api: AuthApi;
  root?: AuthCompositionRoot;
  children: React.ReactNode;
  getPendingPromoCode?: () => string | undefined;
  onVerified?: (result: OtpVerified) => void;
}): React.JSX.Element {
  const pendingPromoCodeRef = useRef(getPendingPromoCode);
  const verifiedRef = useRef(onVerified);
  pendingPromoCodeRef.current = getPendingPromoCode;
  verifiedRef.current = onVerified;
  const scope = useMemo(() => {
    const readPendingPromoCode = (): string | undefined =>
      pendingPromoCodeRef.current?.();
    const notifyVerified = (result: OtpVerified): void =>
      verifiedRef.current?.(result);
    if (root) {
      return root.createOtpScope(
        readPendingPromoCode,
        notifyVerified,
      );
    }
    const store = new OtpStore();
    return {
      store,
      commands: new OtpFlowService(
        store,
        api,
        readPendingPromoCode,
        notifyVerified,
      ),
    };
  }, [api, root]);
  useEffect(
    () => () => {
      if (scope.commands instanceof OtpFlowService) scope.commands.dispose();
    },
    [scope],
  );
  return (
    <AuthFlowContext.Provider value={scope}>
      {children}
    </AuthFlowContext.Provider>
  );
}

export function useAuthFlow(): AuthFlowContextValue {
  const value = useContext(AuthFlowContext);
  if (!value) throw new Error('AuthFlowProvider is required');
  return value;
}
