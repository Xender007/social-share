/** API base URL. Set EXPO_PUBLIC_API_BASE_URL in apps/mobile/.env (LAN IP works for emulator and phone). */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://192.168.1.2:3000').replace(/\/$/, '');

export const DEEP_LINK_SCHEME = 'socialpublisher';

export const APP_VERSION = '1.0.0';
