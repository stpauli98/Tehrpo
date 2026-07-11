"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { odlukaToast, type AkcijaRezultat } from "@/lib/akcija-toast"

/**
 * Hook za `useActionState` forme. Aditivan — okine toast na SVAKI novi rezultat
 * akcije (ne na inicijalni state). Ne dira postojeće success side-efekte forme.
 */
export function useAkcijaToast(
  state: AkcijaRezultat,
  opcije: { uspjeh: string; greska: string },
): void {
  const prethodni = useRef(state)
  useEffect(() => {
    if (state === prethodni.current) return // inicijalni render / nepromijenjen state
    prethodni.current = state
    const odluka = odlukaToast(state, opcije.uspjeh, opcije.greska)
    if (odluka) toast[odluka.tip](odluka.poruka)
  }, [state, opcije.uspjeh, opcije.greska])
}

/** Imperativni helper za direktne `await` pozive akcija. Vraća `res` prolazno. */
export function toastRezultat<T extends AkcijaRezultat>(
  res: T,
  opcije: { uspjeh: string; greska: string },
): T {
  const odluka = odlukaToast(res, opcije.uspjeh, opcije.greska)
  if (odluka) toast[odluka.tip](odluka.poruka)
  return res
}
