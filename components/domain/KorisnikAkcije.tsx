"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { MoreHorizontal, Send, UserX, UserCheck } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { posaljiTestniEmail, postaviAktivan } from "@/app/(dashboard)/postavke/actions"

export function KorisnikAkcije({
  korisnikId,
  aktivan,
  jeJa,
}: {
  korisnikId: string
  aktivan: boolean
  jeJa: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function testEmail() {
    start(async () => {
      const r = await posaljiTestniEmail(korisnikId)
      if (!r.ok) {
        toast.error(r.message ?? "Greška pri slanju.")
        return
      }
      if (r.dryRun) {
        toast.warning("Email nije stvarno poslan (dry-run).", {
          description: `Resend nije konfigurisan. Test je simuliran za ${r.email}.`,
        })
      } else if (!r.primaPodsjetnike) {
        toast.success(`Testni email poslan na ${r.email}.`, {
          description: "Napomena: korisnik ima isključene podsjetnike.",
        })
      } else {
        toast.success(`Testni email poslan na ${r.email}.`)
      }
    })
  }

  function toggleAktivan() {
    start(async () => {
      const r = await postaviAktivan(korisnikId, !aktivan)
      if (r.ok) {
        toast.success(aktivan ? "Korisnik deaktiviran." : "Korisnik aktiviran.")
        router.refresh()
      } else {
        toast.error(r.message ?? "Greška.")
      }
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Akcije" disabled={pending} data-testid={`akcije-${korisnikId}`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={testEmail} data-testid={`test-email-${korisnikId}`}>
          <Send /> Pošalji test email
        </DropdownMenuItem>
        <DropdownMenuItem
          variant={aktivan ? "destructive" : "default"}
          disabled={jeJa}
          onClick={toggleAktivan}
          data-testid={`deaktiviraj-${korisnikId}`}
        >
          {aktivan ? <UserX /> : <UserCheck />}
          {aktivan ? "Deaktiviraj korisnika" : "Aktiviraj korisnika"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
