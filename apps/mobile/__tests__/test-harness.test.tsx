import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it } from 'vitest';

function InteractionHarness(): React.JSX.Element {
  const [count, setCount] = useState(0);

  return (
    <View>
      <Text testID="count">Count: {count}</Text>
      <Pressable
        testID="increment"
        onPress={() => setCount((value) => value + 1)}
      >
        <Text>Increment</Text>
      </Pressable>
    </View>
  );
}

describe('mobile test harness', () => {
  it('renders and handles React Native interaction', async () => {
    const view = await render(<InteractionHarness />);

    expect(view.getByTestId('count').props.children).toEqual(['Count: ', 0]);
    await fireEvent.press(view.getByTestId('increment'));
    expect(view.getByTestId('count').props.children).toEqual(['Count: ', 1]);
  });
});
