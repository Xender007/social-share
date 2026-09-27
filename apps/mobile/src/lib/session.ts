import type { TokenResponse } from '@sp/contracts';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { API_BASE_URL } from './config';

const REFRESH_KEY = 'sp.refreshToken';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionState {
  status: Status;
  accessToken: string | null;
  accessTokenExpiresAt: number;
  setTokens(tokens: TokenResponse): Promise<void>;
  signOut(): Promise<void>;
  restore(): Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  accessToken: null,
  accessTokenExpiresAt: 0,

  async setTokens(tokens) {
    await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken);
    set({ status: 'signedIn', accessToken: tokens.accessToken, accessTokenExpiresAt: Date.now() + (tokens.expiresIn - 30) * 1000 });
  },

  async signOut() {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
    set({ status: 'signedOut', accessToken: null, accessTokenExpiresAt: 0 });
    if (refreshToken) {
      fetch(`${API_BASE_URL}/v1/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) }).catch(() => undefined);
    }
  },

  async restore() {
    const ok = await refreshSession();
    if (!ok) set({ status: 'signedOut' });
  },
}));

let inflight: Promise<boolean> | null = null;

/** Single-flight refresh so parallel 401s trigger only one refresh (§12.3). */
export function refreshSession(): Promise<boolean> {
  if (inflight) return inflight;
  inflight = (async () => {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        if (res.status === 401) await SecureStore.deleteItemAsync(REFRESH_KEY);
        return false;
      }
      await useSession.getState().setTokens((await res.json()) as TokenResponse);
      return true;
    } catch {
      // Offline: keep the stored token so we can retry later.
      return false;
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
