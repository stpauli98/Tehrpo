"use client"
import { useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AktivnostTabela } from "@/components/domain/AktivnostTabela"
import { kursorOd } from "@/lib/aktivnost/kursor"
import type { AktivnostRed } from "@/lib/queries/aktivnost"

export function AktivnostLista({
  pocetna,
  imaJosPocetna,
  upit,
}: {
  pocetna: AktivnostRed[]
  imaJosPocetna: boolean
  upit: string
}) {
  const t = useTranslations("aktivnost")
  const [redovi, setRedovi] = useState<AktivnostRed[]>(pocetna)
  const [imaJos, setImaJos] = useState(imaJosPocetna)
  const [ucitavanje, setUcitavanje] = useState(false)
  const [greska, setGreska] = useState(false)

  async function ucitajJos() {
    const kursor = kursorOd(redovi)
    if (!kursor || ucitavanje) return
    setUcitavanje(true)
    setGreska(false)
    try {
      const p = new URLSearchParams(upit)
      p.set("prijeVrijeme", kursor.vrijeme)
      p.set("prijeId", String(kursor.id))
      const res = await fetch(`/api/aktivnost?${p.toString()}`)
      if (!res.ok) throw new Error(String(res.status))
      const podaci = (await res.json()) as { redovi: AktivnostRed[]; imaJos: boolean }
      // Dedup se računa unutar updatera, nad `prosli`, a NE nad `redovi` iz closure-a —
      // inače bi dva brza klika radila s ustajalim skupom i propustila duplikat.
      setRedovi((prosli) => {
        const poznati = new Set(prosli.map((r) => r.id))
        return [...prosli, ...podaci.redovi.filter((r) => !poznati.has(r.id))]
      })
      setImaJos(podaci.imaJos)
    } catch {
      // Već učitano se NE gubi — samo se ponudi ponovni pokušaj.
      setGreska(true)
    } finally {
      setUcitavanje(false)
    }
  }

  return (
    <div className="space-y-4">
      <AktivnostTabela redovi={redovi} />
      {/* Čitač ekrana mora saznati da je lista narasla; tabela sama to ne najavljuje.
          Gola cifra se čita besmisleno, pa ide kroz prevedenu rečenicu. */}
      <p className="sr-only" aria-live="polite">
        {t("prikazanoRedova", { count: redovi.length })}
      </p>
      {greska && (
        <p className="text-sm text-destructive" role="alert">
          {t("greskaPorcije")}
        </p>
      )}
      {imaJos ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={ucitajJos}
            disabled={ucitavanje}
            data-testid="aktivnost-ucitaj-jos"
          >
            {ucitavanje && (
              <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
            )}
            {ucitavanje ? t("ucitavanje") : t("ucitajJos")}
          </Button>
        </div>
      ) : (
        redovi.length > 0 && (
          <p className="text-center text-sm text-muted-foreground" data-testid="aktivnost-kraj">
            {t("krajListe")}
          </p>
        )
      )}
    </div>
  )
}
