import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/use-theme';
import { GlowBackground } from './glow-background';
import { Text } from './text';

interface ScreenProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  /** Screens inside a native stack already get a header and top inset. */
  underHeader?: boolean;
  /** Ambient violet/magenta glow behind content. Defaults to true; set false for dense/data-heavy screens. */
  glow?: boolean;
}

export function Screen({ children, title, subtitle, scroll = true, refreshing, onRefresh, footer, contentStyle, underHeader, glow = true }: ScreenProps) {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const header = title ? (
    <View style={styles.header}>
      <Text role="headlineMedium" accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? (
        <Text role="bodyMedium" color="onSurfaceVariant">
          {subtitle}
        </Text>
      ) : null}
    </View>
  ) : null;

  const padding = [styles.content, { paddingTop: underHeader ? 12 : insets.top + 12, paddingBottom: footer ? 16 : insets.bottom + 24 }, contentStyle];

  // Only show the spinner for a refresh the user pulled for. Background refetches (on mount/focus)
  // also flip `refreshing`, and popping a spinner for those looks like a glitch.
  const [pulled, setPulled] = useState(false);
  const sawRefresh = useRef(false);
  useEffect(() => {
    if (!pulled) return;
    if (refreshing) {
      sawRefresh.current = true;
      return;
    }
    // Clear once the pulled refresh has started and finished, or after a safety timeout.
    if (sawRefresh.current) {
      sawRefresh.current = false;
      setPulled(false);
      return;
    }
    const t = setTimeout(() => setPulled(false), 8000);
    return () => clearTimeout(t);
  }, [pulled, refreshing]);
  const handleRefresh = () => {
    sawRefresh.current = false;
    setPulled(true);
    onRefresh?.();
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      {glow ? <GlowBackground dark={dark} /> : null}
      {scroll ? (
        <ScrollView
          contentContainerStyle={padding}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={pulled && !!refreshing}
                onRefresh={handleRefresh}
                colors={[colors.primary]}
                tintColor={colors.primary}
                progressBackgroundColor={colors.surfaceContainerHigh}
              />
            ) : undefined
          }>
          {header}
          {children}
        </ScrollView>
      ) : (
        <View style={[padding, styles.fill]}>
          {header}
          {children}
        </View>
      )}
      {footer ? <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: colors.surface, borderTopColor: colors.outlineVariant }]}>{footer}</View> : null}
      {/* Edge-to-edge: keep scrolled content from drawing under the status bar. */}
      {underHeader ? null : <View pointerEvents="none" style={[styles.statusBarScrim, { height: insets.top, backgroundColor: colors.surface }]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 16 },
  header: { gap: 4, marginBottom: 4 },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  statusBarScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
});
