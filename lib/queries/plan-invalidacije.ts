"use client"

import { useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"

/**
 * Jedan izvor invalidacija za Plan-kompleks (lista/kalendar/matrica + detalj).
 *
 * Svaka mutacija termina (izmjena, označi izvršenim, otkaži, kreiranje) mora
 * osvježiti ISTI skup keševa — ranije su tri gotovo identična `useEffect` bloka u
 * `TerminSheet` i jedan mirror u `NoviTerminButton` održavali taj spisak ručno, pa
 * je dodavanje novog view-a značilo četiri mjesta za ažuriranje.
 *
 * `terminId` je opcion: prosljeđuje se kad mutacija mijenja OTVORENI termin
 * (detalj sheet), izostavlja se pri kreiranju novog.
 */
export function useInvalidatePlanQueries(): (terminId?: string) => void {
  const queryClient = useQueryClient()

  return useCallback(
    (terminId?: string) => {
      if (terminId) {
        void queryClient.invalidateQueries({ queryKey: ["termin-detail", terminId] })
      }
      void queryClient.invalidateQueries({ queryKey: ["termini-lista"] })
      void queryClient.invalidateQueries({ queryKey: ["termini-matrica"] })
      void queryClient.invalidateQueries({ queryKey: ["termini-kalendar"] })
    },
    [queryClient],
  )
}
