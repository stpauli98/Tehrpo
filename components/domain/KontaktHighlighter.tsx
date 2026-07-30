"use client"

import { useEffect } from "react"

// Kad se dođe sa ?highlight=<kontaktId> (klik na kontakt u Lokacijama),
// scroll-uj do te kontakt kartice u tabu Kontakti i kratko je "osvijetli".
export function KontaktHighlighter({ targetId }: { targetId: string | null }) {
  useEffect(() => {
    if (!targetId) return
    const el = document.getElementById(`kontakt-${targetId}`)
    if (!el) return
    // S12: sa OS postavkom „reduce motion" skok mora biti trenutan.
    const smanjiPokret = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    el.scrollIntoView({ behavior: smanjiPokret ? "auto" : "smooth", block: "center" })
    el.classList.remove("kontakt-glow")
    void el.offsetWidth // reflow da animacija krene iz početka
    el.classList.add("kontakt-glow")
    const t = setTimeout(() => el.classList.remove("kontakt-glow"), 2200)
    return () => clearTimeout(t)
  }, [targetId])

  return null
}
