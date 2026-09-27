import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { ShareIntentProvider } from 'expo-share-intent';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppEffects } from '@/components/app-effects';
import { AnimatedSplash } from '@/components/brand/animated-splash';
import { queryClient } from '@/lib/query-client';
import { useSession } from '@/lib/session';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: true, duration: 200 });

export default function RootLayout() {
  const { dark, colors } = useTheme();
  const status = useSession((s) => s.status);
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  const [splashDone, setSplashDone] = useState(false);
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    void useSession.getState().restore();
  }, []);

  // The animated splash (same ink background) is on screen from the first JS frame: hand over now.
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  const ready = (fontsLoaded || fontError != null) && status !== 'loading';
  // Mount the app under the splash only once the logo intro has played: a big React mount stalls
  // Fabric-committed SVG animations, and it's far less visible during the loop than mid-intro.
  const showApp = ready && (introDone || splashDone);
  // Rendered in the same slot in both branches so it never remounts when the app appears underneath.
  const splash = splashDone ? null : (
    <AnimatedSplash ready={showApp} fontsLoaded={fontsLoaded} onIntroDone={() => setIntroDone(true)} onFinish={() => setSplashDone(true)} />
  );

  if (!showApp) {
    return (
      <GestureHandlerRootView style={[styles.root, { backgroundColor: colors.surface }]}>
        {null}
        {splash}
      </GestureHandlerRootView>
    );
  }

  const base = dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, primary: colors.primary, background: colors.surface, card: colors.surface, text: colors.onSurface, border: colors.outlineVariant },
  };
  const signedIn = status === 'signedIn';

  return (
    <GestureHandlerRootView style={[styles.root, { backgroundColor: colors.surface }]}>
      <ShareIntentProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={navTheme}>
            <StatusBar style={dark ? 'light' : 'dark'} />
            {signedIn ? <AppEffects /> : null}
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.surface },
                headerTintColor: colors.onSurface,
                headerTitleStyle: { fontFamily: fonts.displaySemi },
                headerShadowVisible: false,
                contentStyle: { backgroundColor: colors.surface },
                animation: 'slide_from_right',
              }}>
              <Stack.Protected guard={signedIn}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="create" options={{ title: 'New post', animation: 'slide_from_bottom' }} />
                <Stack.Screen name="posts/[id]" options={{ title: 'Post' }} />
                <Stack.Screen name="connections/index" options={{ title: 'Connections' }} />
                <Stack.Screen name="connections/choose" options={{ title: 'Choose accounts' }} />
                <Stack.Screen name="analytics/[accountId]" options={{ title: 'Account analytics' }} />
                <Stack.Screen name="console/index" options={{ title: 'Owner console' }} />
                <Stack.Screen name="console/platforms" options={{ title: 'Platforms & features' }} />
                <Stack.Screen name="console/kill-switches" options={{ title: 'Kill switches' }} />
                <Stack.Screen name="console/publications" options={{ title: 'Publishing queue' }} />
                <Stack.Screen name="console/audit" options={{ title: 'Audit log' }} />
              </Stack.Protected>
              <Stack.Protected guard={!signedIn}>
                <Stack.Screen name="login" options={{ headerShown: false }} />
              </Stack.Protected>
            </Stack>
          </ThemeProvider>
        </QueryClientProvider>
      </ShareIntentProvider>
      {splash}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
