"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useQueryClient } from "@tanstack/react-query"
import { FileText, Sparkles, Trash2, Download } from "lucide-react"
import { toast } from "sonner"
import { IKONA_INLINE_KLASA, Tooltip } from "@/components/ui/ikona-tooltip"
import { Button } from "@/components/ui/button"
import { useAkcijaToast } from "@/components/akcija-toast"
import {
  uploadDokumentAction,
  generateZapisnikAction,
  deleteDokumentAction,
  type ActionResult,
} from "@/app/(dashboard)/dokumenti/actions"
import { useUloga } from "@/providers/korisnik-provider"
import { jeAdmin, mozeUrediti } from "@/lib/auth/roles"
import { ACCEPT_ATTR, MAX_MB, validirajFajl } from "@/lib/dokumenti"
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
      // router.refresh() osvježava server caches/zapisnici (revalidatePath), ali NE refetch-uje
      // TanStack ["termin-detail", id] query koji sada hrani `dokumenti` prop u sheet-u — pa
      // eksplicitno invalidiraj taj keš da nova/generisana/obrisana stavka odmah bude vidljiva.
      void queryClient.invalidateQueries({ queryKey: ["termin-detail", terminId] })
      router.refresh()
    }
  }, [uploadState, genState, delState, router, queryClient, terminId])

  const greska =
    (uploadState.ok === false && uploadState.message) ||
    (genState.ok === false && genState.message) ||
    (delState.ok === false && delState.message) ||
    null

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

        {mozeUredjivati && (
          <form action={uploadAction} className="flex min-w-0 items-center gap-2">
            <input type="hidden" name="termin_id" value={terminId} />
            <input
              ref={fileRef}
              type="file"
              name="file"
              accept={ACCEPT_ATTR}
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
            <Button type="submit" variant="outline" disabled={uploadPending} data-testid="dokument-upload-submit">
              {uploadPending ? t("saljem") : t("uploadDugme")}
            </Button>
          </form>
        )}
      </div>

      {greska && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {greska}
        </p>
      )}

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
                <a
                  href={`/api/dokumenti/${d.id}`}
                  className={IKONA_INLINE_KLASA}
                  data-testid="dokument-download"
                  aria-label={t("preuzmi")}
                >
                  <Download className="h-4 w-4" aria-hidden />
                  <Tooltip>{t("preuzmi")}</Tooltip>
                </a>
                {mozeBrisati && (
                  <form action={delAction}>
                    <input type="hidden" name="dokument_id" value={d.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      disabled={delPending}
                      data-testid="dokument-delete"
                      aria-label={t("obrisiDokument")}
                      className="group/tt relative text-destructive hover:bg-destructive/20 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                      <Tooltip>{t("obrisiDokument")}</Tooltip>
                    </Button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
