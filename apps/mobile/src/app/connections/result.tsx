import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion, ZoomIn } from 'react-native-reanimated';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/theme/use-theme';

const HOLD_MS = 900;

/**
 * Fallback when the OS opens the OAuth return deep link as a route instead of the auth session.
 * Shows a brief animated success/failure confirmation, then redirects to the same destination
 * the plain <Redirect> used to go to immediately (connections/choose when a choice is needed, else connections).
 */
export default function ConnectionResult() {
  const params = useLocalSearchParams<{ status?: string; needsChoice?: string; connectionId?: string }>();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const [ready, setReady] = useState(false);
  const success = params.status === 'success';

  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['connections'] });
    void qc.invalidateQueries({ queryKey: ['capabilities'] });
    const timer = setTimeout(() => setReady(true), reducedMotion ? 0 : HOLD_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (success && params.needsChoice === 'true' && params.connectionId) {
      router.replace({ pathname: '/connections/choose', params: { connectionId: params.connectionId } });
    } else {
      router.replace('/connections');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const tone = success
    ? { bg: colors.successContainer, fg: colors.onSuccessContainer, icon: 'check-circle' as const, label: 'Connected' }
    : { bg: colors.errorContainer, fg: colors.onErrorContainer, icon: 'close-circle' as const, label: 'Could not connect' };

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]} accessibilityRole="alert" accessibilityLabel={tone.label}>
      <Animated.View entering={reducedMotion ? undefined : ZoomIn.springify().damping(14).stiffness(160)} style={[styles.badge, { backgroundColor: tone.bg }]}>
        <MaterialCommunityIcons name={tone.icon} size={48} color={tone.fg} />
      </Animated.View>
      <Text role="titleLarge" align="center">
        {tone.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 24 },
  badge: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
});
