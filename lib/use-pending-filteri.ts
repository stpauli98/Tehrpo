"use client"
import { useTransition } from "react"
import { useRouter } from "next/navigation"

/**
 * Standardni pending-obrazac za filter/toolbar kontrole koje mijenjaju URL
 * (S10): navigacija ide kroz `startTransition`, a `isPending` traje dok se
 * server komponenta sa novim searchParams ne izrenderuje.
 *
 * Hook standardizuje SAMO pending + tranziciju — građenje `URLSearchParams`,
 * debounce i brisanje paginacionog ključa (`strana`) ostaju kod konzumenata.
 *
 * Primjer upotrebe (S10 ugovor za konzumente):
 * ```tsx
 * const { isPending, push } = usePendingFilteri()
 *
 * <div aria-busy={isPending} className={isPending ? "opacity-60" : undefined}>
 *   <select
 *     disabled={isPending}
 *     onChange={(e) => {
 *       const p = new URLSearchParams(sp.toString())
 *       p.set("status", e.target.value)
 *       p.delete("strana")
 *       push(`${pathname}?${p.toString()}`)
 *     }}
 *   />
 * </div>
 * ```
 * Kontejner MORA dobiti `aria-busy={isPending}` i vizuelni signal
 * (`opacity-60` i/ili `disabled` na kontrole) — sam `data-pending`
 * atribut NIJE dovoljan.
 *
 * NAPOMENA (verifikacija): hook nije unit-testabilan u node vitest
 * okruženju (zahtijeva Next.js router kontekst) — verifikuju ga
 * konzumentske grane e2e testovima.
 */
export function usePendingFilteri(): {
  isPending: boolean
  push: (url: string) => void
  replace: (url: string) => void
} {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const push = (url: string) => {
    startTransition(() => router.push(url))
  }

  const replace = (url: string) => {
    startTransition(() => router.replace(url))
  }

  return { isPending, push, replace }
}
