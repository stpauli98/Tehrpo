"use client"
import { useEffect, useRef, useState } from "react"
import { useSearchParams, usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { usePendingFilteri } from "@/lib/use-pending-filteri"

export function AktivnostSearch() {
  const t = useTranslations("aktivnost")
  const pathname = usePathname()
  const sp = useSearchParams()
  const qUrl = sp.get("q") ?? ""
  const [value, setValue] = useState(qUrl)
  // Dijeljeni S10 hook (isti obrazac koji koriste AktivnostFilteri i ostali tabovi).
  const { isPending, push } = usePendingFilteri()
  // Razlikuje NAŠ push (debounce) od SPOLJAŠNJE promjene URL-a (Očisti, back/forward),
  // da sync-iz-URL-a ne pregazi tekst koji korisnik trenutno kuca.
  const lastPushedRef = useRef(qUrl)
  // Uvijek najsvježiji sp u ref-u (osvježava se poslije svakog rendera): debounce timeout ne smije
  // graditi URL iz zastarjelog snapshot-a (npr. filter promijenjen u međuvremenu bi se izgubio).
  const spRef = useRef(sp)
  useEffect(() => {
    spRef.current = sp
  })

  // Debounce push (300ms).
  useEffect(() => {
    const id = setTimeout(() => {
      const v = value.trim()
      if (v === lastPushedRef.current) return
      lastPushedRef.current = v
      const p = new URLSearchParams(spRef.current.toString())
      if (v) p.set("q", v)
      else p.delete("q")
      p.delete("strana")
      push(p.toString() ? `${pathname}?${p.toString()}` : pathname)
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Sync SAMO na spoljašnju promjenu q (npr. Očisti postavi q="").
  useEffect(() => {
    if (qUrl !== lastPushedRef.current) {
      setValue(qUrl)
      lastPushedRef.current = qUrl
    }
  }, [qUrl])

  return (
    <label className="flex flex-col gap-1 text-xs">
      {t("filteri.pretraga")}
      {/* Input se NE onemogućava tokom tranzicije (kucanje bi izgubilo fokus) —
          vidljivi pending signal je spinner + aria-busy na kontejneru (S10). */}
      <div className="relative w-72" aria-busy={isPending}>
        <Input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("filteri.pretraga")}
          data-testid="aktivnost-search"
          data-pending={isPending}
          className="pr-8"
        />
        {isPending && (
          <Loader2
            className="absolute right-2 top-1/2 -translate-y-1/2 h-[18px] w-[18px] shrink-0 animate-spin motion-reduce:animate-none text-muted-foreground"
            aria-hidden
          />
        )}
      </div>
    </label>
  )
}
