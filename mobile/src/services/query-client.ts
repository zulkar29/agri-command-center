import { QueryClient } from '@tanstack/react-query'

/** Shared client — the root layout wraps the app in its provider, and the
 * connection code clears it when the demo ↔ live source switches. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
})
