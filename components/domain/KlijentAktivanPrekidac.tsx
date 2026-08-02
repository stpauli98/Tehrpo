"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { BellOff, BellRing } from "lucide-react"
import { setKlijentAktivan } from "@/app/(dashboard)/klijenti/actions"
import { toastRezultat } from "@/components/akcija-toast"
import { useMozeUrediti } from "@/providers/korisnik-provider"
import { cn } from "@/lib/utils"

/**
 * Prekidač „saradnja aktivna / ugašena" na kartici klijenta (B1).
 *
 * Gašenjem klijent nestaje iz SVA TRI izvora mejlova (podsjetnici prije roka,
 * obavijesti poslije roka, sedmični digest) — filter je u bazi, ne ovdje
 * (migracija 20260802093000_klijent_aktivan.sql). Termini, dokumenti i istorija
 * ostaju netaknuti i vidljivi; prekidač se u svakom trenutku vraća.
 *
 * Zašto NIJE unutar <Link> kartice: dugme unutar <a> je nevalidan HTML i klik bi
 * se borio sa navigacijom. Roditelj ga postavlja kao apsolutno pozicioniranog
 * BRATA anchora, pa su obje mete nezavisne i za miš i za tastaturu.
 *
 * Uloga „pregled" ne dobija dugme (RLS bi je ionako odbio kroz `NOT je_pregled()`),
 * ali MORA vidjeti stanje — zato u tom slučaju ostaje statična oznaka za ugašenog
 * klijenta umjesto praznine.
 */
export function KlijentAktivanPrekidac({
  klijentId,
  aktivan,
}: {
  klijentId: string
  aktivan: boolean
}) {
  const t = useTranslations("klijenti.aktivan")
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const mozeUrediti = useMozeUrediti()

  if (!mozeUrediti) {
    if (aktivan) return null
    return (
      <span
        data-testid="klijent-neaktivan-oznaka"
        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border"
      >
        <BellOff className="h-3 w-3" aria-hidden />
        {t("ugasen")}
      </span>
    )
  }

  function prebaci() {
    const fd = new FormData()
    fd.append("id", klijentId)
    fd.append("aktivan", aktivan ? "false" : "true")
    startTransition(async () => {
      const res = toastRezultat(await setKlijentAktivan({ ok: true }, fd), {
        uspjeh: aktivan ? t("uspjehUgasen") : t("uspjehVracen"),
        greska: t("greskaFallback"),
      })
      // Kartica se crta na serveru iz `klijenti_view`; bez refresh-a bi prikaz
      // ostao na staroj vrijednosti do sljedeće navigacije.
      if (res.ok) router.refresh()
    })
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={aktivan}
      aria-label={aktivan ? t("ugasiAria") : t("vratiAria")}
      disabled={isPending}
      data-testid="klijent-aktivan-prekidac"
      data-aktivan={aktivan ? "1" : "0"}
      onClick={prebaci}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        "ring-1 ring-inset transition motion-reduce:transition-none",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        "disabled:opacity-60",
        aktivan
          ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 hover:bg-emerald-500/20 dark:text-emerald-400"
          : "bg-muted text-muted-foreground ring-border hover:bg-muted/70",
      )}
    >
      {aktivan ? <BellRing className="h-3 w-3" aria-hidden /> : <BellOff className="h-3 w-3" aria-hidden />}
      {aktivan ? t("aktivan") : t("ugasen")}
    </button>
  )
}
