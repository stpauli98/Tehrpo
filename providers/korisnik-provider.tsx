"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { Uloga } from "@/lib/auth/roles"
import { mozeUrediti, smijePreuzeti } from "@/lib/auth/roles"

// null = uloga nepoznata (npr. profil red nedostaje) → tretira se kao najmanja privilegija.
const KorisnikContext = createContext<{ uloga: Uloga | null }>({ uloga: null })

export function KorisnikProvider({
  uloga,
  children,
}: {
  uloga: Uloga | null
  children: ReactNode
}) {
  return <KorisnikContext.Provider value={{ uloga }}>{children}</KorisnikContext.Provider>
}

export function useUloga(): Uloga | null {
  return useContext(KorisnikContext).uloga
}

/** true ako tekuća uloga smije uređivati (admin/operater); null/pregled → false. */
export function useMozeUrediti(): boolean {
  const u = useUloga()
  return u ? mozeUrediti(u) : false
}

/** true ako tekuća uloga smije preuzimati/izvoziti; null/pregled → false. */
export function useSmijePreuzeti(): boolean {
  const u = useUloga()
  return u ? smijePreuzeti(u) : false
}
