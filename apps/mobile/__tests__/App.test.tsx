import { render, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/auth/auth-flow.context', () => ({
  AuthFlowProvider: ({ children }: PropsWithChildren) => children,
}));
vi.mock('../src/navigation/AuthNavigator', () => ({
  AuthNavigator: () => null,
  authNavigationRef: { current: null },
}));

import App from '../src/App';

describe('mobile bootstrap', () => {
  it('initializes secure installation identity and renders the application', async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('installation-0001');
    const view = await render(<App />);

    await waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalled());
    expect(view.toJSON()).toBeDefined();
    await view.unmount();
  });
});
