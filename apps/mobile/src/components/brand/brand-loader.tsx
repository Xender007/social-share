import { StyleSheet, Text, View } from 'react-native';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { AnimatedBrandMark } from './animated-brand-mark';

/** Brand loader: the Broadcast mark in its loop (arcs pulse outward, dot orbits), plus an optional label. */
export function BrandLoader({ size = 56, label }: { size?: number; label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.root} accessible accessibilityRole="progressbar" accessibilityLabel={label ?? 'Loading'}>
      <AnimatedBrandMark size={size} mode="loop" haloColor={colors.surface} />
      {label ? (
        <Text style={[styles.label, { color: colors.onSurfaceVariant }]} numberOfLines={2}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 14, lineHeight: 20, letterSpacing: 0.1, textAlign: 'center' },
});
