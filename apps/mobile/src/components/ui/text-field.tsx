import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { Text } from './text';

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  helper?: string;
  error?: string | null;
  maxLength?: number;
  showCounter?: boolean;
  testID?: string;
}

/** Material 3 outlined text field with a persistent label, helper/error text and optional counter. */
export function TextField({ label, helper, error, maxLength, showCounter, value, multiline, onFocus, onBlur, testID, ...rest }: TextFieldProps) {
  const { colors, typography } = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.error : focused ? colors.primary : colors.outline;
  const length = value?.length ?? 0;
  const over = maxLength !== undefined && length > maxLength;

  return (
    <View style={styles.wrapper}>
      <Text role="labelMedium" color={error ? 'error' : focused ? 'primary' : 'onSurfaceVariant'} style={styles.label}>
        {label}
      </Text>
      <TextInput
        {...rest}
        testID={testID}
        value={value}
        multiline={multiline}
        accessibilityLabel={label}
        accessibilityHint={helper}
        placeholderTextColor={colors.onSurfaceVariant}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          typography.bodyLarge,
          styles.input,
          multiline && styles.multiline,
          { color: colors.onSurface, borderColor, borderWidth: focused || error ? 2 : 1, backgroundColor: colors.surfaceContainer, borderRadius: radius.md },
        ]}
      />
      <View style={styles.footer}>
        <Text role="bodySmall" color={error ? 'error' : 'onSurfaceVariant'} style={styles.helper} accessibilityLiveRegion={error ? 'polite' : 'none'}>
          {error ?? helper ?? ''}
        </Text>
        {showCounter && maxLength !== undefined ? (
          <Text role="bodySmall" color={over ? 'error' : 'onSurfaceVariant'} accessibilityLabel={`${length} of ${maxLength} characters`}>
            {length}/{maxLength}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 4 },
  label: { marginLeft: 4 },
  input: { minHeight: 52, paddingHorizontal: 16, paddingVertical: 12 },
  multiline: { minHeight: 104, textAlignVertical: 'top' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, minHeight: 16 },
  helper: { flex: 1 },
});
