"use client"
import { useEffect, useRef } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { dogadjajZaRutu, dogadjajZaFilter } from "@/lib/aktivnost/mapiranje"
import { noviBafer, dodaj, isprazni, type BaferStanje } from "@/lib/aktivnost/bafer"
import type { DogadjajUnos } from "@/lib/aktivnost/tipovi"

const FLUSH_MS = 5000

function posalji(redovi: DogadjajUnos[], beacon: boolean) {
  if (redovi.length === 0) return
  const telo = JSON.stringify({ dogadjaji: redovi })
  if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/aktivnost", new Blob([telo], { type: "application/json" }))
    return
  }
  void fetch("/api/aktivnost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: telo,
    keepalive: true,
  }).catch(() => {})
}

export function AktivnostTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const baferRef = useRef<BaferStanje>(noviBafer())

  // Zabilježi navigaciju/pregled + filter na promjenu rute ili parametara.
  useEffect(() => {
    const b = baferRef.current
    const ruta = dogadjajZaRutu(pathname)
    if (ruta) dodaj(b, ruta)
    const params = Object.fromEntries(searchParams.entries())
    const filter = dogadjajZaFilter(pathname, params)
    if (filter) dodaj(b, filter)
  }, [pathname, searchParams])

  // Periodičan flush.
  useEffect(() => {
    const id = setInterval(() => posalji(isprazni(baferRef.current), false), FLUSH_MS)
    return () => clearInterval(id)
  }, [])

  // Flush na napuštanje/sakrivanje stranice (pouzdano preko sendBeacon).
  useEffect(() => {
    const bafer = baferRef.current
    const onHide = () => posalji(isprazni(bafer), true)
    const onVis = () => {
      if (document.visibilityState === "hidden") onHide()
    }
    document.addEventListener("visibilitychange", onVis)
    window.addEventListener("pagehide", onHide)
    return () => {
      document.removeEventListener("visibilitychange", onVis)
      window.removeEventListener("pagehide", onHide)
    }
  }, [])

  return null
}
