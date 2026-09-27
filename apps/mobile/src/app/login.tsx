import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Device from 'expo-device';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnimatedBrandMark } from '@/components/brand/animated-brand-mark';
import { FacebookPreview, PhoneCarousel, ReelsPreview, ShortsPreview, type PhoneSlide } from '@/components/mockups';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Banner } from '@/components/ui/feedback';
import { GlowBackground } from '@/components/ui/glow-background';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { api, ApiError } from '@/lib/api';
import { API_BASE_URL } from '@/lib/config';
import { useSession } from '@/lib/session';
import { brand } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/** Sample caption shown in the preview carousel — no real media, so it renders the gradient placeholder. */
const SAMPLE_CAPTION = 'Golden hour at the beach #travel';

const SLIDES: PhoneSlide[] = [
  { key: 'shorts', label: 'YouTube Shorts', render: ({ active, width }) => <ShortsPreview caption={SAMPLE_CAPTION} accountName="yourchannel" active={active} width={width} /> },
  { key: 'reels', label: 'Instagram Reels', render: ({ active, width }) => <ReelsPreview caption={SAMPLE_CAPTION} accountName="yourchannel" active={active} width={width} /> },
  { key: 'facebook', label: 'Facebook', render: ({ active, width }) => <FacebookPreview caption={SAMPLE_CAPTION} accountName="Your Page" active={active} width={width} /> },
];

/** Wordmark and tagline sit directly on the fixed dark-ink hero, independent of theme (BROADCAST.md). */
const WHITE = '#FFFFFF';

export default function LoginScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const setTokens = useSession((s) => s.setTokens);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailError(null);
    setLoading(true);
    try {
      const tokens = await api.login(email.trim(), password, Device.deviceName ?? Device.modelName ?? 'Android');
      await setTokens(tokens);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const enter = (delay: number) => (reducedMotion ? undefined : FadeInDown.delay(delay).duration(450).springify().damping(18));

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.root, { backgroundColor: brand.ink }]}>
        <GlowBackground dark />
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 28 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Animated.View entering={enter(0)} style={styles.brand}>
            <AnimatedBrandMark size={72} mode="intro" />
            <Text role="displaySmall" align="center" accessibilityRole="header" style={styles.wordmark}>
              Social Publisher
            </Text>
            <Text role="bodyLarge" align="center" style={styles.tagline}>
              Post once. Everywhere.
            </Text>
          </Animated.View>

          <Animated.View entering={enter(120)}>
            <PhoneCarousel slides={SLIDES} phoneWidth={160} autoPlay={3500} tone="dark" accessibilityLabel="Preview of your post on YouTube Shorts, Instagram Reels and Facebook" />
          </Animated.View>

          <Animated.View entering={enter(220)}>
            <Card variant="glass" style={styles.formCard}>
              {error ? <Banner tone="error" message={error} /> : null}

              <View style={styles.form}>
                <TextField
                  testID="login-email"
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  error={emailError}
                  onBlur={() => setEmailError(email && !/^\S+@\S+\.\S+$/.test(email.trim()) ? 'Enter a valid email address.' : null)}
                  returnKeyType="next"
                />
                <View>
                  <TextField
                    testID="login-password"
                    label="Password"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoComplete="password"
                    textContentType="password"
                    onSubmitEditing={submit}
                    returnKeyType="go"
                  />
                  <Pressable
                    onPress={() => setShowPassword((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                    hitSlop={8}
                    style={styles.eye}>
                    <MaterialCommunityIcons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.onSurfaceVariant} />
                  </Pressable>
                </View>
                <Button testID="login-submit" label="Sign in" onPress={submit} loading={loading} disabled={!email || !password} fullWidth />
              </View>
            </Card>
          </Animated.View>

          <Text role="bodySmall" align="center" style={styles.serverLabel}>
            Server: {API_BASE_URL}
          </Text>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, gap: 20 },
  brand: { alignItems: 'center', gap: 8 },
  wordmark: { color: WHITE },
  tagline: { color: 'rgba(255,255,255,0.72)' },
  formCard: { gap: 12 },
  form: { gap: 8 },
  eye: { position: 'absolute', right: 12, top: 34, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  serverLabel: { color: 'rgba(255,255,255,0.45)' },
});
