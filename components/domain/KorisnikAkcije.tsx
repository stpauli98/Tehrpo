"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { MoreHorizontal, Send, UserX, UserCheck, KeyRound } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { posaljiTestniEmail, postaviAktivan, posaljiResetKorisniku } from "@/app/(dashboard)/postavke/actions"

export function KorisnikAkcije({
  korisnikId,
  email,
  aktivan,
  jeJa,
}: {
  korisnikId: string
  email: string
  aktivan: boolean
  jeJa: boolean
}) {
  const t = useTranslations("postavke.korisnikAkcije")
  const router = useRouter()
  const [pending, start] = useTransition()

  function testEmail() {
    start(async () => {
      const r = await posaljiTestniEmail(korisnikId)
      if (!r.ok) {
        toast.error(r.message ?? t("greskaSlanja"))
        return
      }
      if (r.dryRun) {
        toast.warning(t("dryRunNaslov"), {
          description: t("dryRunOpis", { email: r.email }),
        })
      } else if (!r.primaPodsjetnike) {
        toast.success(t("testniPoslat", { email: r.email }), {
          description: t("napomenaIskljuceniPodsjetnici"),
        })
      } else {
        toast.success(t("testniPoslat", { email: r.email }))
      }
    })
  }

  function posaljiReset() {
    start(async () => {
      const r = await posaljiResetKorisniku(email)
      if (r.ok) toast.success(t("resetPoslat", { email }))
      else toast.error(r.message ?? t("resetGreska"))
    })
  }

  function toggleAktivan() {
    start(async () => {
      const r = await postaviAktivan(korisnikId, !aktivan)
      if (r.ok) {
        toast.success(aktivan ? t("korisnikDeaktiviran") : t("korisnikAktiviran"))
        router.refresh()
      } else {
        toast.error(r.message ?? t("greska"))
      }
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={t("aria")} disabled={pending} data-testid={`akcije-${korisnikId}`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={testEmail} data-testid={`test-email-${korisnikId}`}>
          <Send /> {t("testEmail")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={posaljiReset} data-testid={`posalji-reset-${korisnikId}`}>
          <KeyRound /> {t("posaljiReset")}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant={aktivan ? "destructive" : "default"}
          disabled={jeJa}
          onClick={toggleAktivan}
          data-testid={`deaktiviraj-${korisnikId}`}
        >
          {aktivan ? <UserX /> : <UserCheck />}
          {aktivan ? t("deaktivirajKorisnika") : t("aktivirajKorisnika")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
