import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import { useCapabilities } from '@/hooks/use-capabilities';
import { registerForPushIfPermitted } from '@/lib/push';
import { useDraft } from '@/stores/draft';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/** Signed-in side effects: share intents, push registration, notification taps. */
export function AppEffects() {
  const { hasShareIntent, shareIntent, resetShareIntent, error: shareError } = useShareIntentContext();
  const { caps } = useCapabilities();

  // The sending app may hand over a link we can't read (file deleted, permission not granted).
  useEffect(() => {
    if (!shareError) return;
    resetShareIntent();
    Alert.alert("Couldn't open that video", 'Try sharing it again, or pick it from your gallery in Create post.');
  }, [shareError, resetShareIntent]);

  useEffect(() => {
    if (!hasShareIntent || !caps) return;
    const file = shareIntent.files?.find((f) => f.mimeType?.startsWith('video/'));
    resetShareIntent();
    if (!caps.global.android_share) {
      Alert.alert('Sharing is turned off', 'Sharing videos into the app is disabled right now.');
      return;
    }
    if (!file) {
      // No name or type means the file couldn't be read (the native side reports it as a generic file).
      const unreadable = (shareIntent.files ?? []).some((f) => !f.fileName || !f.mimeType || f.mimeType === 'application/octet-stream');
      if (unreadable) Alert.alert("Couldn't open that video", 'Try sharing it again, or pick it from your gallery in Create post.');
      else Alert.alert('Only videos can be shared', 'Share a video file to create a post.');
      return;
    }
    useDraft.getState().startFromShare({ uri: file.path, fileName: file.fileName, mimeType: file.mimeType, size: file.size ?? null, durationMs: file.duration ?? null, width: file.width ?? null, height: file.height ?? null });
    router.push('/create');
  }, [hasShareIntent, shareIntent, caps, resetShareIntent]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      void Notifications.setNotificationChannelAsync('publishing', { name: 'Publishing updates', importance: Notifications.AndroidImportance.DEFAULT });
    }
    void registerForPushIfPermitted();
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === 'string' && url.startsWith('/')) router.push(url as never);
    });
    return () => sub.remove();
  }, []);

  return null;
}
