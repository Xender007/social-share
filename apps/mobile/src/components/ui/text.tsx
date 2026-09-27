import { Text as RNText, type TextProps } from 'react-native';
import type { ColorScheme, TypeRole } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/** `role` selects the Material type role; use accessibilityRole for semantics. */
export interface AppTextProps extends Omit<TextProps, 'role'> {
  role?: TypeRole;
  color?: keyof ColorScheme;
  align?: 'left' | 'center' | 'right';
}

export function Text({ role = 'bodyLarge', color = 'onSurface', align, style, ...rest }: AppTextProps) {
  const { colors, typography } = useTheme();
  return <RNText {...rest} style={[typography[role], { color: colors[color], textAlign: align }, style]} />;
}
