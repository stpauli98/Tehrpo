"use client"

import { useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { toastRezultat } from "@/components/akcija-toast"
import { MoreHorizontal, Send, UserX, UserCheck, KeyRound, Pencil, Trash2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { PotvrdiBrisanjeDialog } from "./PotvrdiBrisanjeDialog"
import { UrediKorisnikaDialog } from "./UrediKorisnikaDialog"
import { posaljiTestniEmail, postaviAktivan, posaljiResetKorisniku, obrisiKorisnika } from "@/app/(dashboard)/postavke/actions"

export function KorisnikAkcije({
  korisnikId,
  ime,
  email,
  aktivan,
  jeJa,
}: {
  korisnikId: string
  ime: string
  email: string
  aktivan: boolean
  jeJa: boolean
}) {
  const t = useTranslations("postavke.korisnikAkcije")
  const router = useRouter()
  const [pending, start] = useTransition()
  // PotvrdiBrisanjeDialog (Talas 0) drži vlastito `open` stanje i otvara se ISKLJUČIVO
  // klikom na svoj `trigger` — nema `open`/`onOpenChange` propove. Stavka menija ne može
  // biti taj trigger: Base UI zatvara i unmount-uje popup menija na klik stavke, pa bi
  // trigger nestao prije nego se dialog otvori. Zato dialozi žive kao SIBLING menija sa
  // skrivenim dugmetom-triggerom, a stavka menija ga klikne programski. Primitiv se ne
  // mijenja (Talas 0 vlasništvo).
  const resetTriggerRef = useRef<HTMLButtonElement>(null)
  const deaktivirajTriggerRef = useRef<HTMLButtonElement>(null)
  const urediTriggerRef = useRef<HTMLButtonElement>(null)
  const obrisiTriggerRef = useRef<HTMLButtonElement>(null)

  // Odgoda za jedan tick: meni se prvo zatvori i vrati fokus na svoj trigger, pa tek
  // onda dialog preuzme fokus — sinhrono otvaranje bi to dvoje utrkivalo.
  function otvoriDialog(ref: React.RefObject<HTMLButtonElement | null>) {
    setTimeout(() => ref.current?.click(), 0)
  }

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

  // Aktivacija (false → true) nije destruktivna — ostaje direktna, bez potvrde.
  function aktiviraj() {
    start(async () => {
      const res = toastRezultat(await postaviAktivan(korisnikId, true), {
        uspjeh: t("korisnikAktiviran"),
        greska: t("greska"),
      })
      if (res.ok) router.refresh()
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={t("aria")} disabled={pending} data-testid={`akcije-${korisnikId}`}>
              <MoreHorizontal className="h-[18px] w-[18px] shrink-0" aria-hidden />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={testEmail} data-testid={`test-email-${korisnikId}`}>
            <Send aria-hidden /> {t("testEmail")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => otvoriDialog(resetTriggerRef)}
            data-testid={`posalji-reset-${korisnikId}`}
          >
            <KeyRound aria-hidden /> {t("posaljiReset")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => otvoriDialog(urediTriggerRef)} data-testid={`uredi-${korisnikId}`}>
            <Pencil aria-hidden /> {t("urediPodatke")}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant={aktivan ? "destructive" : "default"}
            disabled={jeJa}
            onClick={() => (aktivan ? otvoriDialog(deaktivirajTriggerRef) : aktiviraj())}
            data-testid={`deaktiviraj-${korisnikId}`}
          >
            {aktivan ? <UserX aria-hidden /> : <UserCheck aria-hidden />}
            {aktivan ? t("deaktivirajKorisnika") : t("aktivirajKorisnika")}
          </DropdownMenuItem>
          {!aktivan && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => otvoriDialog(obrisiTriggerRef)}
              data-testid={`obrisi-${korisnikId}`}
            >
              <Trash2 aria-hidden /> {t("obrisiTrajno")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Greška se prikazuje inline u dijalogu (dialog ostaje otvoren) — bez duplog
          toast kanala (S2); toast ide samo na uspjeh. */}
      <PotvrdiBrisanjeDialog
        trigger={<button type="button" ref={resetTriggerRef} tabIndex={-1} aria-hidden className="hidden" />}
        naslov={t("resetPotvrdaNaslov")}
        opis={t("resetPotvrdaOpis", { email })}
        potvrdiLabel={t("posaljiReset")}
        testId={`posalji-reset-potvrdi-${korisnikId}`}
        onPotvrdi={async () => {
          const res = await posaljiResetKorisniku(email)
          if (res.ok) toast.success(t("resetPoslat", { email }))
          return res.ok ? res : { ok: false as const, message: res.message ?? t("resetGreska") }
        }}
      />

      <UrediKorisnikaDialog
        trigger={<button type="button" ref={urediTriggerRef} tabIndex={-1} aria-hidden className="hidden" />}
        korisnikId={korisnikId}
        ime={ime}
        email={email}
      />

      {!aktivan && (
        <PotvrdiBrisanjeDialog
          trigger={<button type="button" ref={obrisiTriggerRef} tabIndex={-1} aria-hidden className="hidden" />}
          naslov={t("obrisiPotvrdaNaslov")}
          opis={t("obrisiPotvrdaOpis", { email })}
          potvrdiLabel={t("obrisiTrajno")}
          testId={`obrisi-potvrdi-${korisnikId}`}
          onPotvrdi={async () => {
            const res = await obrisiKorisnika(korisnikId)
            if (res.ok) toast.success(t("korisnikObrisan"))
            return res.ok ? res : { ok: false as const, message: res.message ?? t("greska") }
          }}
          onUspjeh={() => router.refresh()}
        />
      )}

      {aktivan && (
        <PotvrdiBrisanjeDialog
          trigger={<button type="button" ref={deaktivirajTriggerRef} tabIndex={-1} aria-hidden className="hidden" />}
          naslov={t("deaktivacijaPotvrdaNaslov")}
          opis={t("deaktivacijaPotvrdaOpis")}
          potvrdiLabel={t("deaktivirajKorisnika")}
          testId={`deaktiviraj-potvrdi-${korisnikId}`}
          onPotvrdi={async () => {
            const res = await postaviAktivan(korisnikId, false)
            if (res.ok) toast.success(t("korisnikDeaktiviran"))
            return res.ok ? res : { ok: false as const, message: res.message ?? t("greska") }
          }}
          onUspjeh={() => router.refresh()}
        />
      )}
    </>
  )
}
