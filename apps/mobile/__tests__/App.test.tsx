import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View',
}));

import App from '../src/App';

describe('mobile bootstrap', () => {
  it('renders the Expo application entry point', () => {
    expect(App()).toBeDefined();
  });
});
