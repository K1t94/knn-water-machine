import React, { createContext, useContext } from 'react';

import type { AuthCompositionRoot } from './auth-composition-root';

const AuthRootContext =
  createContext<AuthCompositionRoot | undefined>(undefined);

export function AuthRootProvider({
  children,
  root,
}: {
  children: React.ReactNode;
  root: AuthCompositionRoot;
}): React.JSX.Element {
  return (
    <AuthRootContext.Provider value={root}>
      {children}
    </AuthRootContext.Provider>
  );
}

export function useAuthRoot(): AuthCompositionRoot {
  const value = useContext(AuthRootContext);
  if (!value) throw new Error('AuthRootProvider is required');
  return value;
}
