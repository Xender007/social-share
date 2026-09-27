import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status ?? 0;
        return status === 0 && failureCount < 2;
      },
      refetchOnWindowFocus: true,
    },
  },
});
