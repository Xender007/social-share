import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ConnectionView } from '@sp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { PlatformIcon, PlatformLabel } from '@/components/platform';
import { Button, type IconName } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Banner, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useCapabilities } from '@/hooks/use-capabilities';
import { api, ApiError } from '@/lib/api';
import { DEEP_LINK_SCHEME } from '@/lib/config';
import { platformBrand, type ColorScheme } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

const PROVIDERS = [
  { slug: 'google' as const, kind: 'GOOGLE', title: 'Google', platforms: ['youtube'], description: 'Publish to YouTube and read channel analytics.' },
  { slug: 'meta' as const, kind: 'META', title: 'Meta', platforms: ['instagram', 'facebook'], description: 'Publish Reels to Instagram and your Facebook Page.' },
];

const ERROR_MESSAGES: Record<string, string> = {
  ACCESS_DENIED: 'You cancelled the connection or access was denied.',
  OAUTH_STATE_INVALID: 'The sign-in link expired. Please try again.',
  OAUTH_FAILED: 'The platform did not complete the sign-in. Please try again.',
};

const ACCOUNT_STATUS: Record<string, string> = {
  ACTIVE: 'Publishing here',
  INACTIVE: 'Not selected',
  NOT_ELIGIBLE: 'Not eligible',
  REAUTH_REQUIRED: 'Reconnect needed',
  DISCONNECTED: 'Disconnected',
};

/** Overall provider status: icon + text is always shown, never colour alone. */
function providerStatus(connection: ConnectionView | undefined, needsReauth: boolean): { icon: IconName; text: string; tone: keyof ColorScheme } {
  if (!connection) return { icon: 'link-variant', text: 'Not connected', tone: 'onSurfaceVariant' };
  if (needsReauth) return { icon: 'alert-circle', text: 'Reconnect needed', tone: 'error' };
  return { icon: 'check-circle', text: 'Connected', tone: 'success' };
}

export default function ConnectionsScreen() {
  const { colors, dark } = useTheme();
  const reducedMotion = useReducedMotion();
  const qc = useQueryClient();
  const { caps } = useCapabilities();
  const connections = useQuery({ queryKey: ['connections'], queryFn: api.connections });
  const [connecting, setConnecting] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['connections'] });
    void qc.invalidateQueries({ queryKey: ['capabilities'] });
  };

  const connect = async (slug: 'google' | 'meta', title: string) => {
    setConnecting(slug);
    setNotice(null);
    try {
      const { authorizationUrl } = await api.startConnection(slug);
      const result = await WebBrowser.openAuthSessionAsync(authorizationUrl, `${DEEP_LINK_SCHEME}://connections/result`);
      if (result.type !== 'success') return;
      const { queryParams } = Linking.parse(result.url);
      refresh();
      if (queryParams?.status === 'success') {
        setNotice({ tone: 'success', message: `${title} connected.` });
        if (queryParams.needsChoice === 'true' && typeof queryParams.connectionId === 'string') {
          router.push({ pathname: '/connections/choose', params: { connectionId: queryParams.connectionId } });
        }
      } else {
        setNotice({ tone: 'error', message: ERROR_MESSAGES[String(queryParams?.code)] ?? 'Could not connect. Please try again.' });
      }
    } catch (e) {
      setNotice({ tone: 'error', message: e instanceof ApiError ? e.message : 'Could not start the connection.' });
    } finally {
      setConnecting(null);
    }
  };

  const validate = useMutation({ mutationFn: (id: string) => api.validateConnection(id), onSuccess: refresh });
  const disconnect = useMutation({ mutationFn: (id: string) => api.disconnect(id), onSuccess: refresh });

  const confirmDisconnect = (connection: ConnectionView, title: string) =>
    Alert.alert(`Disconnect ${title}?`, 'You will stop publishing to these accounts until you connect again. Your post history stays.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => disconnect.mutate(connection.id) },
    ]);

  if (connections.isLoading) return <Screen underHeader><LoadingState /></Screen>;
  if (connections.error) return <Screen underHeader><ErrorState message={(connections.error as Error).message} onRetry={connections.refetch} /></Screen>;

  return (
    <Screen underHeader refreshing={connections.isRefetching} onRefresh={refresh}>
      {notice ? <Banner tone={notice.tone} message={notice.message} /> : null}
      {PROVIDERS.map((provider, index) => {
        const allowed = provider.platforms.some((code) => caps?.platforms.find((p) => p.code === code)?.capabilities.connect);
        if (!allowed) return null;
        const connection = connections.data?.find((c) => c.provider === provider.kind);
        const needsReauth = connection?.status === 'REAUTH_REQUIRED' || connection?.status === 'REFRESH_FAILING';
        const status = providerStatus(connection, needsReauth);
        const glowColor = platformBrand[provider.platforms[0]]?.color ?? colors.primary;
        // The "connected" edge uses the app's own success colour, not the raw per-platform brand hex:
        // YouTube's red at any alpha still reads as an error/danger signal, which is the wrong meaning here.
        const connectedGlow =
          connection && !needsReauth
            ? {
                borderColor: `${colors.success}59`,
                borderWidth: 1,
                ...(dark ? {} : { shadowColor: colors.success, shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 4 }),
              }
            : null;

        return (
          <Animated.View key={provider.slug} entering={reducedMotion ? undefined : FadeInDown.delay(Math.min(index, 8) * 40).duration(300)}>
            <Card variant="outlined" style={[styles.card, connectedGlow]}>
              <View style={styles.titleRow}>
                <View style={[styles.iconBadge, { backgroundColor: `${glowColor}1F` }]}>
                  {provider.platforms.length > 1 ? (
                    <View style={styles.multiIcons}>
                      {provider.platforms.map((p) => (
                        <MaterialCommunityIcons key={p} name={(platformBrand[p]?.icon ?? 'web') as IconName} size={20} color={platformBrand[p]?.color ?? colors.onSurface} />
                      ))}
                    </View>
                  ) : (
                    <MaterialCommunityIcons name={(platformBrand[provider.platforms[0]]?.icon ?? 'web') as IconName} size={28} color={glowColor} />
                  )}
                </View>
                <View style={styles.flex}>
                  <Text role="titleLarge">{provider.title}</Text>
                  <Text role="bodySmall" color="onSurfaceVariant">
                    {connection ? `Signed in as ${connection.externalUserName ?? 'your account'}` : provider.description}
                  </Text>
                </View>
              </View>

              <View style={styles.statusRow}>
                <MaterialCommunityIcons name={status.icon} size={18} color={colors[status.tone]} />
                <Text role="labelLarge" color={status.tone}>
                  {status.text}
                </Text>
              </View>

              {needsReauth ? <Banner tone="warning" message="Access expired. Reconnect to keep publishing." /> : null}

              {connection?.accounts.map((account) => (
                <View key={account.id} style={styles.accountRow}>
                  <PlatformLabel platform={account.platform} name={account.handle ?? account.displayName} detail={account.statusReason ?? ACCOUNT_STATUS[account.status]} />
                  <MaterialCommunityIcons
                    name={account.status === 'ACTIVE' ? 'check-circle' : account.status === 'INACTIVE' ? 'circle-outline' : 'alert-circle'}
                    size={20}
                    color={account.status === 'ACTIVE' ? colors.success : account.status === 'INACTIVE' ? colors.onSurfaceVariant : colors.error}
                    accessibilityLabel={ACCOUNT_STATUS[account.status]}
                  />
                </View>
              ))}

              <View style={styles.actions}>
                {!connection || needsReauth ? (
                  <Button label={needsReauth ? 'Reconnect' : 'Connect'} icon="link-variant" onPress={() => connect(provider.slug, provider.title)} loading={connecting === provider.slug} testID={`connect-${provider.slug}`} />
                ) : (
                  <>
                    {connection.accounts.length > 1 ? (
                      <Button label="Choose accounts" variant="tonal" onPress={() => router.push({ pathname: '/connections/choose', params: { connectionId: connection.id } })} />
                    ) : null}
                    <Button label="Check" variant="text" icon="shield-check-outline" onPress={() => validate.mutate(connection.id)} loading={validate.isPending && validate.variables === connection.id} />
                    <Button label="Disconnect" variant="text" onPress={() => confirmDisconnect(connection, provider.title)} />
                  </>
                )}
              </View>
            </Card>
          </Animated.View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconBadge: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  multiIcons: { flexDirection: 'row', gap: 6 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  accountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
