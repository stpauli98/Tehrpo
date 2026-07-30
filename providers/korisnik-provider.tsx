"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { Uloga } from "@/lib/auth/roles"
import { mozeUrediti, smijePreuzeti } from "@/lib/auth/roles"
import { efektivneDozvole, PRAZNE_DOZVOLE, type Dozvole } from "@/lib/auth/dozvole"

// null = uloga nepoznata (npr. profil red nedostaje) → tretira se kao najmanja privilegija.
const KorisnikContext = createContext<{ uloga: Uloga | null; dozvole: Dozvole }>({
  uloga: null,
  dozvole: PRAZNE_DOZVOLE,
})

export function KorisnikProvider({
  uloga,
  dozvole,
  children,
}: {
  uloga: Uloga | null
  /** Sirove kolone sa `korisnici`; ulogu primjenjuje provider. */
  dozvole?: Dozvole
  children: ReactNode
}) {
  const vrijednost = useMemo(
    () => ({
      uloga,
      // Bez uloge nema povlastica — isti princip kao useMozeUrediti/useSmijePreuzeti.
      dozvole: uloga && dozvole ? efektivneDozvole(uloga, dozvole) : PRAZNE_DOZVOLE,
    }),
    [uloga, dozvole],
  )
  return <KorisnikContext.Provider value={vrijednost}>{children}</KorisnikContext.Provider>
}

export function useUloga(): Uloga | null {
  return useContext(KorisnikContext).uloga
}

/**
 * Efektivne dozvole tekućeg korisnika (admin → sve, pregled → ništa, operater → kolone).
 * Ogledalo za UI: izvor istine ostaje Postgres (RLS + trigeri). Sakriva se SAMO kontrola
 * brisanja — nikad okolni prikaz.
 */
export function useDozvole(): Dozvole {
  return useContext(KorisnikContext).dozvole
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
