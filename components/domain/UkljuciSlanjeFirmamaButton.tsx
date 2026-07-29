"use client"

import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { updateSaljiKlijentima, type ActionResult } from "@/app/(dashboard)/postavke/actions"
import { useAkcijaToast } from "@/components/akcija-toast"
import { Button } from "@/components/ui/button"

const initial: ActionResult = { ok: true }

/**
 * Uključuje globalni prekidač „Šalji podsjetnike i firmama" direktno iz banner-a u
 * „Ko šta prima". Zašto dugme a ne link/anchor na sam prekidač: prekidač živi u
 * sekciji „Email podsjetnici" koja je `CollapsibleSection` zatvorena po defaultu i
 * NE renderuje svoj panel dok je zatvorena — anchor na njega ne bi imao gdje skočiti.
 *
 * Akcija je admin-gated (`zahtijevajAdmina`) i revalidira `/postavke`, pa se banner,
 * per-firma toggle-ovi i izvedeni badge-evi osvježe u istom prolazu. `router.refresh()`
 * pokriva drugu upotrebu — karticu firme (`?tab=podsjetnici`), koju akcija ne revalidira
 * jer ne zna o kojoj je firmi riječ.
 */
export function UkljuciSlanjeFirmamaButton() {
  const t = useTranslations("postavke.koStaPrima")
  const tc = useTranslations("common")
  const router = useRouter()
  const [state, action, pending] = useActionState(updateSaljiKlijentima, initial)
  useAkcijaToast(state, { uspjeh: tc("sacuvano"), greska: tc("greska") })
  useEffect(() => {
    if (state !== initial && state.ok) router.refresh()
  }, [state, router])

  return (
    <form action={action}>
      <input type="hidden" name="salji" value="on" />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending}
        data-testid="ksp-ukljuci-globalno"
      >
        {t("ukljuciGlobalno")}
      </Button>
    </form>
  )
}
