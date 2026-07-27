"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useQueryClient } from "@tanstack/react-query"
import { FileText, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Tooltip } from "@/components/ui/ikona-tooltip"
import { Button } from "@/components/ui/button"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { useAkcijaToast } from "@/components/akcija-toast"
import { FieldError } from "./FieldError"
import { PreuzmiDokumentButton } from "./PreuzmiDokumentButton"
import {
  uploadDokumentAction,
  generateZapisnikAction,
  deleteDokumentAction,
  type ActionResult,
} from "@/app/(dashboard)/dokumenti/actions"
import { useUloga } from "@/providers/korisnik-provider"
import { jeAdmin, mozeUrediti } from "@/lib/auth/roles"
import { ACCEPT_ATTR, DOKUMENT_TIPOVI, MAX_MB, validirajFajl } from "@/lib/dokumenti"
import type { Database } from "@/db/types"

type DokumentRow = Database["public"]["Tables"]["dokumenti"]["Row"]
const initial: ActionResult = { ok: true }

export function DokumentiSekcija({
  terminId,
  dokumenti,
  izvrsen,
}: {
  terminId: string
  dokumenti: DokumentRow[]
  izvrsen: boolean
}) {
  const t = useTranslations("dokumenti")
  const tc = useTranslations("common")
  const router = useRouter()
  const queryClient = useQueryClient()
  const uloga = useUloga()
  // Brisanje dokumenata je admin-only (server akcija to i nameće).
  const mozeBrisati = uloga !== null && jeAdmin(uloga)
  // Upload/generisanje zapisnika su operater+admin (pregled je read-only).
  const mozeUredjivati = uloga !== null && mozeUrediti(uloga)
  const [uploadState, uploadAction, uploadPending] = useActionState(uploadDokumentAction, initial)
  const [genState, genAction, genPending] = useActionState(generateZapisnikAction, initial)
  const [delState, delAction, delPending] = useActionState(deleteDokumentAction, initial)
  useAkcijaToast(uploadState, { uspjeh: t("uploadUspjeh"), greska: tc("greska") })
  useAkcijaToast(genState, { uspjeh: t("zapisnikUspjeh"), greska: tc("greska") })
  useAkcijaToast(delState, { uspjeh: tc("obrisano"), greska: tc("greska") })
  const fileRef = useRef<HTMLInputElement>(null)
  // S3/O3: brisanje unutar već otvorenog TerminSheet dialoga ide dvostepenim arm
  // obrascem (ne dialog-preko-dialoga). Arm je per-dokument.
  const [armedId, setArmedId] = useState<string | null>(null)

  // Mapa value→label za base-ui SelectValue (prikaz prevoda kad je select zatvoren).
  // MAX_MB više nije lokalan — dolazi iz lib/dokumenti (jedan izvor limita, S8.5).
  const tipItems: Record<string, string> = Object.fromEntries(
    DOKUMENT_TIPOVI.map((tip) => [tip, t(`tipovi.${tip}`)]),
  )

  // Refresh liste kad SE PROMIJENI ishod bilo koje akcije i taj (promijenjeni) ishod je uspjeh.
  // NE uslovljavati sa "sve tri ok" — zaglavljena greška iz jedne akcije bi blokirala
  // refresh nakon kasnijeg uspjeha druge akcije.
  const prev = useRef({ u: uploadState, g: genState, d: delState })
  useEffect(() => {
    const uChanged = uploadState !== prev.current.u
    const gChanged = genState !== prev.current.g
    const dChanged = delState !== prev.current.d
    if (!uChanged && !gChanged && !dChanged) return
    const uspjeh =
      (uChanged && uploadState.ok) || (gChanged && genState.ok) || (dChanged && delState.ok)
    prev.current = { u: uploadState, g: genState, d: delState }
    if (uspjeh) {
      if (uChanged && uploadState.ok && fileRef.current) fileRef.current.value = ""
      if (dChanged && delState.ok) setArmedId(null)
      // router.refresh() osvježava server caches/zapisnici (revalidatePath), ali NE refetch-uje
      // TanStack ["termin-detail", id] query koji sada hrani `dokumenti` prop u sheet-u — pa
      // eksplicitno invalidiraj taj keš da nova/generisana/obrisana stavka odmah bude vidljiva.
      void queryClient.invalidateQueries({ queryKey: ["termin-detail", terminId] })
      router.refresh()
    }
  }, [uploadState, genState, delState, router, queryClient, terminId])

  // `message` iz svih akcija ide ISKLJUČIVO toastom (useAkcijaToast gore) — inline
  // duplikat bi bio dupli kanal (S2). Inline ostaje samo `errors` za polje `tip`.
  const tipGreske = uploadState.ok === false ? uploadState.errors?.tip : undefined

  return (
    <section data-testid="sheet-dokumenti">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("naslov")}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {izvrsen ? (
          mozeUredjivati && (
            <form action={genAction}>
              <input type="hidden" name="termin_id" value={terminId} />
              <Button type="submit" variant="default" disabled={genPending} data-testid="generisi-zapisnik">
                <Sparkles className="w-4 h-4" aria-hidden /> {genPending ? t("generisem") : t("generisiZapisnik")}
              </Button>
            </form>
          )
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="zapisnik-nedostupan">
            {t("zapisnikNedostupan")}
          </p>
        )}

        {/* `flex-wrap` + `min-w-0`: native `input[type=file]` ima veliku intrinzičnu
            širinu (~300px) i bez ovoga razvuče cijeli dialog → horizontalni skrol. */}
        {mozeUredjivati && (
          <form action={uploadAction} className="flex min-w-0 flex-wrap items-center gap-2">
            <input type="hidden" name="termin_id" value={terminId} />
            <input
              ref={fileRef}
              type="file"
              name="file"
              accept={ACCEPT_ATTR}
              aria-label={t("fajlPolje")}
              data-testid="dokument-file"
              className="min-w-0 max-w-full text-sm"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const provjera = validirajFajl(file)
                if (provjera.ok) return
                toast.error(
                  provjera.razlog === "tip"
                    ? t("nedozvoljenTip")
                    : t("fajlPrevelik", { max: MAX_MB }),
                )
                e.target.value = ""
              }}
            />
            <div className="space-y-1">
              <Select name="tip" defaultValue="strucni_nalaz" items={tipItems}>
                <SelectTrigger
                  className="w-44"
                  aria-label={t("tipLabel")}
                  aria-describedby={tipGreske ? "greska-dokument-tip" : undefined}
                  data-testid="dokument-tip"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOKUMENT_TIPOVI.map((tip) => (
                    <SelectItem key={tip} value={tip}>{t(`tipovi.${tip}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError id="greska-dokument-tip" errors={tipGreske} />
            </div>
            <Button type="submit" variant="outline" disabled={uploadPending} data-testid="dokument-upload-submit">
              {uploadPending ? t("saljem") : t("uploadDugme")}
            </Button>
          </form>
        )}
      </div>

      {dokumenti.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("prazno")}</p>
      ) : (
        <ul className="mt-3 space-y-2" data-testid="dokumenti-lista">
          {dokumenti.map((d) => (
            <li
              key={d.id}
              data-testid="dokument-red"
              className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{d.naziv}</span>
                {d.generated_by_ai && (
                  <span data-testid="dokument-ai-badge" className="shrink-0 rounded-full bg-brand-light px-2 py-0.5 text-xs text-brand">{t("aiOznaka")}</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <PreuzmiDokumentButton
                  dokumentId={d.id}
                  label={t("preuzmi")}
                  testId="dokument-download"
                />
                {mozeBrisati && (
                  armedId === d.id ? (
                    /* Naoružano: tek drugi klik zaista briše. Potvrdno dugme nosi
                       `variant="destructive"` (O3) umjesto ručnih klasa. */
                    <form action={delAction} className="flex items-center gap-1">
                      <input type="hidden" name="dokument_id" value={d.id} />
                      <Button
                        type="submit"
                        variant="destructive"
                        size="sm"
                        disabled={delPending}
                        data-testid="dokument-delete-potvrdi"
                      >
                        {tc("obrisi")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setArmedId(null)}
                        data-testid="dokument-delete-odustani"
                      >
                        {tc("otkazi")}
                      </Button>
                    </form>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={delPending}
                      onClick={() => setArmedId(d.id)}
                      data-testid="dokument-delete"
                      aria-label={t("obrisiDokument")}
                      className="group/tt relative text-destructive hover:bg-destructive/20 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                      <Tooltip>{t("obrisiDokument")}</Tooltip>
                    </Button>
                  )
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
