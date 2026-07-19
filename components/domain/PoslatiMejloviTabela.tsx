import { getTranslations } from "next-intl/server"
import type { Database } from "@/db/types"
import { Badge } from "@/components/ui/badge"
import { oznaciPregledanim } from "@/app/(dashboard)/poslati-mejlovi/actions"

type MejlTip = Database["public"]["Enums"]["mejl_tip"]
type MejlStatus = Database["public"]["Enums"]["mejl_status"]
type MejlDostava = Database["public"]["Enums"]["mejl_dostava_status"]

// Izvezeno radi ponovne upotrebe pri gradnji opcija filtera u page.tsx.
export const TIP_KEY = {
  podsjetnik_interni: "podsjetnikInterni",
  podsjetnik_firma: "podsjetnikFirma",
  podsjetnik_rok_istekao_interni: "podsjetnikRokIstekaoInterni",
  podsjetnik_rok_istekao_firma: "podsjetnikRokIstekaoFirma",
  podsjetnik_digest: "podsjetnikDigest",
  zakazano_nakon_roka: "zakazanoNakonRoka",
  test: "test",
} as const satisfies Record<MejlTip, string>

export const STATUS_KEY = {
  poslato: "poslato",
  greska_slanja: "greskaSlanja",
} as const satisfies Record<MejlStatus, string>

const DOSTAVA_KEY = {
  nepoznato: "nepoznato",
  delivered: "delivered",
  opened: "opened",
  delivery_failed: "deliveryFailed",
  bounced: "bounced",
  complained: "complained",
} as const satisfies Record<MejlDostava, string>

const DOSTAVA_VARIJANTA = {
  nepoznato: "secondary",
  delivered: "default",
  opened: "default",
  delivery_failed: "destructive",
  bounced: "destructive",
  complained: "destructive",
} as const satisfies Record<MejlDostava, "secondary" | "default" | "destructive">

// Podskup kolona RPC-a get_poslati_mejlovi koje tabela zapravo prikazuje.
// Generisani tip vraća sve kolone kao non-null (limitacija codegen-a), ali stvarne
// vrijednosti mogu biti null (npr. interni podsjetnik nema klijent_naziv) — otud
// klijent_naziv/greska ovdje eksplicitno dozvoljavaju null, a render koristi ?? "—".
type Red = {
  id: string
  created_at: string
  tip: MejlTip
  primaoci: string[] | null
  subject: string
  klijent_naziv: string | null
  status: MejlStatus
  greska: string | null
  delivery_status: MejlDostava
}

function jeGreska(r: Red): boolean {
  return (
    r.status === "greska_slanja" ||
    r.delivery_status === "bounced" ||
    r.delivery_status === "complained" ||
    r.delivery_status === "delivery_failed"
  )
}

export async function PoslatiMejloviTabela({ redovi }: { redovi: Red[] }) {
  const t = await getTranslations("poslatiMejlovi")

  if (redovi.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("prazno")}</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="px-3 py-2">{t("kolone.vrijeme")}</th>
            <th className="px-3 py-2">{t("kolone.tip")}</th>
            <th className="px-3 py-2">{t("kolone.primaoci")}</th>
            <th className="px-3 py-2">{t("kolone.naslov")}</th>
            <th className="px-3 py-2">{t("kolone.klijent")}</th>
            <th className="px-3 py-2">{t("kolone.slanje")}</th>
            <th className="px-3 py-2">{t("kolone.dostava")}</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {redovi.map((r) => (
            <tr
              key={r.id}
              className={
                jeGreska(r)
                  ? "border-t border-border bg-destructive/5"
                  : "border-t border-border"
              }
            >
              <td className="px-3 py-2 whitespace-nowrap">
                {new Date(r.created_at).toLocaleString("sr-Latn")}
              </td>
              <td className="px-3 py-2">{t(`tip.${TIP_KEY[r.tip]}` as never)}</td>
              <td className="px-3 py-2">{(r.primaoci ?? []).join(", ") || "—"}</td>
              <td className="px-3 py-2">{r.subject}</td>
              <td className="px-3 py-2">{r.klijent_naziv ?? "—"}</td>
              <td className="px-3 py-2">
                {t(`status.${STATUS_KEY[r.status]}` as never)}
                {r.greska && <span className="block text-xs text-destructive">{r.greska}</span>}
              </td>
              <td className="px-3 py-2">
                <Badge variant={DOSTAVA_VARIJANTA[r.delivery_status]}>
                  {t(`dostava.${DOSTAVA_KEY[r.delivery_status]}` as never)}
                </Badge>
              </td>
              <td className="px-3 py-2">
                {jeGreska(r) && (
                  <form action={oznaciPregledanim.bind(null, r.id)}>
                    <button type="submit" className="text-xs underline hover:no-underline">
                      {t("oznaciPregledanim")}
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
