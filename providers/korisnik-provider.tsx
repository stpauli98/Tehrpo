"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { Uloga } from "@/lib/auth/roles"
import { mozeUrediti } from "@/lib/auth/roles"

// null = uloga nepoznata (npr. profil red nedostaje) → tretira se kao najmanja privilegija.
const KorisnikContext = createContext<{ uloga: Uloga | null; ime: string | null }>({
  uloga: null,
  ime: null,
})

export function KorisnikProvider({
  uloga,
  ime = null,
  children,
}: {
  uloga: Uloga | null
  ime?: string | null
  children: ReactNode
}) {
  return <KorisnikContext.Provider value={{ uloga, ime }}>{children}</KorisnikContext.Provider>
}

export function useUloga(): Uloga | null {
  return useContext(KorisnikContext).uloga
}

/** Ime prijavljenog korisnika (za „(ti)" prijedlog u ZaduzeniPolje); null dok je nepoznato. */
export function useKorisnikIme(): string | null {
  return useContext(KorisnikContext).ime
}

/** true ako tekuća uloga smije uređivati (admin/operater); null/pregled → false. */
export function useMozeUrediti(): boolean {
  const u = useUloga()
  return u ? mozeUrediti(u) : false
}
