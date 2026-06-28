"use client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState, type ReactNode } from "react"

export function DashboardQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, gcTime: 300_000, retry: 1, refetchOnWindowFocus: false } },
    }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
