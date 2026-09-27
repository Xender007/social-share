import { Host, Switch } from '@expo/ui';
import { View } from 'react-native';
import { touchTarget } from '@/theme/tokens';

interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  /** Read by screen readers. Show the visible label next to the toggle yourself. */
  accessibilityLabel: string;
  disabled?: boolean;
  testID?: string;
}

/**
 * Material switch for use beside a React Native label. `@expo/ui`'s `label` prop draws text inside the
 * native host, which `matchContents` sizes to the switch, so the text wraps one letter per line.
 * The label lives on the wrapper instead, with switch semantics for TalkBack.
 */
export function Toggle({ value, onValueChange, accessibilityLabel, disabled, testID }: ToggleProps) {
  return (
    <View
      accessible
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate' && !disabled) onValueChange(!value);
      }}
      style={{ minHeight: touchTarget, justifyContent: 'center', opacity: disabled ? 0.45 : 1 }}>
      <Host matchContents>
        <Switch value={value} onValueChange={onValueChange} disabled={disabled} testID={testID} />
      </Host>
    </View>
  );
}
