"use client"

import { useEffect } from "react"

// Kad se dođe sa ?highlight=<lokacijaId> (klik na kontakt u Lokacijama),
// scroll-uj do te kontakt kartice u tabu Kontakti i kratko je "osvijetli".
export function KontaktHighlighter({ targetId }: { targetId: string | null }) {
  useEffect(() => {
    if (!targetId) return
    const el = document.getElementById(`kontakt-${targetId}`)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    el.classList.remove("kontakt-glow")
    void el.offsetWidth // reflow da animacija krene iz početka
    el.classList.add("kontakt-glow")
    const t = setTimeout(() => el.classList.remove("kontakt-glow"), 2200)
    return () => clearTimeout(t)
  }, [targetId])

  return null
}
