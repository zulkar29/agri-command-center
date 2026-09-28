import { QueryClient } from '@tanstack/react-query'

/** Single QueryClient (and cache) shared by the whole app. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
