import type { CapabilityPlatformView } from '@sp/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/query-client';

/** Server-resolved capabilities (§11). Refetched on foreground, every 5 minutes, and after 403 CAPABILITY_DENIED. */
export function useCapabilities() {
  const query = useQuery({ queryKey: ['capabilities'], queryFn: api.capabilities, refetchInterval: 5 * 60_000 });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void queryClient.invalidateQueries({ queryKey: ['capabilities'] });
    });
    return () => sub.remove();
  }, []);

  const caps = query.data;
  const platform = (code: string): CapabilityPlatformView | undefined => caps?.platforms.find((p) => p.code === code);
  return {
    ...query,
    caps,
    platform,
    can: (capability: string) => {
      if (!caps) return false;
      const [scope, feature] = capability.split('.');
      if (scope === 'global') return Boolean(caps.global[feature]);
      return Boolean(platform(scope)?.capabilities[feature]);
    },
    publishTargets: (caps?.platforms ?? []).filter((p) => p.capabilities.publish),
  };
}
