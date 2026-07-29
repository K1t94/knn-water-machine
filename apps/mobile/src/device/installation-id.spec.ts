import * as SecureStore from 'expo-secure-store';
import { Observable, firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getOrCreateInstallationId } from './installation-id';

describe('installation ID', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reuses the secure value without replacing it', async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('existing-installation');
    const installationId$ = getOrCreateInstallationId();

    expect(installationId$).toBeInstanceOf(Observable);
    expect(await firstValueFrom(installationId$)).toBe('existing-installation');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('creates and persists a missing value in secure storage', async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(null);

    const value = await firstValueFrom(getOrCreateInstallationId());

    expect(value).toMatch(/^(?:[0-9a-f-]{36}|install-)/);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('kaynann.installation-id', value);
  });
});
