import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { expect, it } from 'vitest';

it.only('uses controlled invalid test patterns', async () => {
    const view = await render(<Text>Fixture</Text>);

    expect(await view.getByText('Fixture')).toBeTruthy();
});
