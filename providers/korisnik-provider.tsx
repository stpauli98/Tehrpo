"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { Uloga } from "@/lib/auth/roles"

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
