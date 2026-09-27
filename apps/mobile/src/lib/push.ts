import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from './api';
import { APP_VERSION } from './config';
import { queryClient } from './query-client';

let registered = false;

async function register(): Promise<boolean> {
  if (!Device.isDevice && !__DEV__) return false;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  try {
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api.registerDevice(token.data, APP_VERSION);
    registered = true;
    return true;
  } catch (error) {
    // Push needs an EAS project ID and FCM credentials; publishing works without it.
    console.log('[push] registration skipped:', (error as Error).message);
    return false;
  }
}

/** Registers silently when permission was already granted (never prompts). */
export async function registerForPushIfPermitted(): Promise<void> {
  if (registered) return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') await register();
}

/** Asks for notification permission at a meaningful moment: right after the first publish (§24.1). */
export async function askForPushAfterPublish(): Promise<void> {
  if (registered) return;
  const current = await Notifications.getPermissionsAsync();
  if (current.status === 'granted') return void (await register());
  if (!current.canAskAgain) return;
  const next = await Notifications.requestPermissionsAsync();
  // Settings shows the permission from a cached query; refresh it wherever the prompt was answered.
  void queryClient.invalidateQueries({ queryKey: ['push-permission'] });
  if (next.status === 'granted') await register();
}
