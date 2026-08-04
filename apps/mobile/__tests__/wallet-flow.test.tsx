import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { describe, expect, it, vi } from 'vitest';

import { WalletApiError, type WalletBalance, type WalletHistoryPage } from '../src/api/wallet-api';
import App from '../src/App';
import { SessionStore } from '../src/auth/stores/session.store';
import { RootNavigator } from '../src/navigation/RootNavigator';
import { WalletScreen } from '../src/wallet/screens/WalletScreen';
import { WalletStore } from '../src/wallet/stores/wallet.store';
import { WalletCompositionRoot } from '../src/wallet/wallet-composition-root';

import type { AuthApi, SessionCredentials } from '../src/api/auth-api';
import type { AuthCompositionRoot } from '../src/auth/auth-composition-root';
import type { WalletCommands } from '../src/wallet/services/wallet-flow.service';

vi.mock('../src/auth/auth-flow.context', () => ({
    AuthFlowProvider: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock('../src/auth/registration-flow.context', () => ({
    RegistrationFlowProvider: ({ children }: { children?: React.ReactNode }) => children,
    useRegistrationFlow: () => ({ store: { pendingPromoCode: undefined } }),
}));
vi.mock('../src/navigation/AuthNavigator', () => ({
    AuthNavigator: () => null,
    authNavigationRef: { current: null },
}));

const credentials: SessionCredentials = {
    accessToken: 'access-token',
    accessExpiresAt: '2099-01-01T00:15:00.000Z',
    refreshToken: 'refresh-token',
    refreshExpiresAt: '2099-03-01T00:00:00.000Z',
};

describe('wallet presentation flow', () => {
    it('renders loading and retryable error states and retries through commands', async () => {
        const store = new WalletStore();
        const commands = createCommands();
        const loadingToken = store.beginInitialLoad();
        const view = await render(<WalletScreen commands={commands} onLogout={vi.fn()} store={store} />);

        expect(view.getByLabelText('Chargement du portefeuille')).toBeTruthy();

        await act(() =>
            store.failInitialLoad(loadingToken, {
                code: new WalletApiError('OFFLINE', true).code,
                retryable: true,
            }),
        );
        expect(view.getByRole('alert')).toBeTruthy();
        const retry = view.getByLabelText('Réessayer de charger le portefeuille');
        expect(retry.props.accessibilityRole).toBe('button');
        await fireEvent.press(retry);
        expect(commands.retry).toHaveBeenCalledOnce();
    });

    it('shows exact litres, public operation facts, refresh, and pagination controls', async () => {
        const store = new WalletStore();
        const commands = createCommands();
        load(
            store,
            balance('9007199254740993', '9007199254740.993'),
            page(
                [
                    operation({ id: 'credit', amountMl: '1250' }),
                    operation({ id: 'debit', amountMl: '1', direction: 'DEBIT' }),
                ],
                'next-page',
                true,
            ),
        );
        const view = await render(<WalletScreen commands={commands} onLogout={vi.fn()} store={store} />);

        expect(view.getByLabelText('Solde disponible').props.children).toContain('9007199254740.993');
        expect(view.getByText('+1.250 L')).toBeTruthy();
        expect(view.getByText('-0.001 L')).toBeTruthy();
        expect(view.getAllByText('PACKAGE CREDIT')).toHaveLength(2);
        expect(view.getAllByText(/TEST FIXTURE/)).toHaveLength(2);

        const scrollView = view.getByLabelText('Contenu du portefeuille');
        await act(() => pullToRefresh(scrollView.props as unknown));
        expect(commands.refresh).toHaveBeenCalledOnce();
        await fireEvent.press(view.getByLabelText('Charger plus d’opérations'));
        expect(commands.loadNextPage).toHaveBeenCalledOnce();
    });

    it('renders an explicit empty state and accessible refresh and logout actions', async () => {
        const store = new WalletStore();
        const commands = createCommands();
        const logout = vi.fn();
        load(store, balance('0', '0.000'), page([]));
        const view = await render(<WalletScreen commands={commands} onLogout={logout} store={store} />);

        expect(view.getByText('Aucune opération pour le moment')).toBeTruthy();
        expect(view.getByLabelText('Solde disponible').props.children).toContain('0.000');
        const refresh = view.getByLabelText('Actualiser le portefeuille');
        const logoutButton = view.getByLabelText('Se déconnecter');
        expect(refresh.props.accessibilityRole).toBe('button');
        expect(logoutButton.props.accessibilityRole).toBe('button');

        await fireEvent.press(refresh);
        await fireEvent.press(logoutButton);
        expect(commands.refresh).toHaveBeenCalledOnce();
        expect(logout).toHaveBeenCalledOnce();
    });

    it('keeps the authenticated route wired to the existing logout command', async () => {
        const sessionStore = new SessionStore();
        sessionStore.authenticate(credentials);
        const logout = vi.fn();
        const wallet = createWalletRoot();
        load(wallet.store, balance('0', '0.000'), page([]));
        const root = {
            sessionStore,
            sessionFlow: { logout },
        } as unknown as AuthCompositionRoot;
        const view = await render(<RootNavigator api={{} as AuthApi} root={root} wallet={wallet} />);

        expect(view.getByText('Aucune opération pour le moment')).toBeTruthy();
        await fireEvent.press(view.getByLabelText('Se déconnecter'));
        expect(logout).toHaveBeenCalledOnce();
    });

    it('disposes the wallet composition when the application unmounts', async () => {
        vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('installation-wallet-test');
        const dispose = vi.spyOn(WalletCompositionRoot.prototype, 'dispose');
        const view = await render(<App />);

        await waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalled());
        await view.unmount();
        expect(dispose).toHaveBeenCalledOnce();
        dispose.mockRestore();
    });
});

function createCommands(): WalletCommands & {
    retry: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    loadNextPage: ReturnType<typeof vi.fn>;
} {
    return {
        retry: vi.fn(),
        refresh: vi.fn(),
        loadNextPage: vi.fn(),
    };
}

function pullToRefresh(value: unknown): void {
    if (!hasRefreshHandler(value)) throw new Error('Expected a refreshable wallet scroll view');
    value.refreshControl.props.onRefresh();
}

function hasRefreshHandler(value: unknown): value is { refreshControl: { props: { onRefresh: () => void } } } {
    if (!value || typeof value !== 'object' || !('refreshControl' in value)) return false;
    const refreshControl: unknown = value.refreshControl;
    if (!refreshControl || typeof refreshControl !== 'object' || !('props' in refreshControl)) return false;
    const props: unknown = refreshControl.props;
    return Boolean(props && typeof props === 'object' && 'onRefresh' in props && typeof props.onRefresh === 'function');
}

function createWalletRoot(): WalletCompositionRoot {
    return {
        store: new WalletStore(),
        flow: createCommands(),
        dispose: vi.fn(),
    } as unknown as WalletCompositionRoot;
}

function load(store: WalletStore, walletBalance: WalletBalance, history: WalletHistoryPage): void {
    const token = store.beginInitialLoad();
    store.finishInitialLoad(token, walletBalance, history);
}

function balance(balanceMl: string, balanceLiters: string): WalletBalance {
    return { balanceMl, balanceLiters, observedAt: '2026-08-06T10:00:00.000Z' };
}

function page(items: WalletHistoryPage['items'], nextCursor: string | null = null, hasMore = false): WalletHistoryPage {
    return { items, nextCursor, hasMore };
}

function operation({
    id,
    amountMl,
    direction = 'CREDIT',
}: {
    id: string;
    amountMl: string;
    direction?: 'CREDIT' | 'DEBIT';
}): WalletHistoryPage['items'][number] {
    return {
        id,
        direction,
        amountMl,
        operationKind: 'PACKAGE_CREDIT',
        source: 'TEST_FIXTURE',
        occurredAt: '2026-08-06T09:00:00.000Z',
        recordedAt: '2026-08-06T09:00:01.000Z',
    };
}
