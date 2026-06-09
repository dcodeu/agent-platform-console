// queryClient.ts — TanStack Query singleton for the v2 island.
//
// Defaults match the server's cache TTLs so we don't refetch faster than the
// data can possibly change:
//   - snapshot.json is 4s TTL on the server → staleTime 4000 here
//   - heavy.json is 60s TTL → staleTime 60000
//   - alerts are a light 10s poll → staleTime 10000
//
// Individual queries override staleTime per-resource via `useQuery({ staleTime })`.
// The default below covers anything that forgets to set one.

import { QueryClient } from "@tanstack/react-query";

export const SNAPSHOT_STALE_MS = 4_000;
export const HEAVY_STALE_MS = 60_000;
export const ALERTS_STALE_MS = 10_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: SNAPSHOT_STALE_MS,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8_000),
    },
  },
});
