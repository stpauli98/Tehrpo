import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { AsistentChat } from "@/components/domain/AsistentChat"
import { NoviRazgovorButton } from "@/components/domain/NoviRazgovorButton"
import type { UiPoruka } from "@/components/domain/ChatMessage"
import { href } from "@/i18n/routes"
import type { Database } from "@/db/types"

type PorukaRow = Database["public"]["Tables"]["chat_poruke"]["Row"]

export default async function AsistentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await getTranslations("asistent")
  const sp = await searchParams
  const aktivni = typeof sp.k === "string" ? sp.k : null

  const supabase = await createServerSupabaseClient()

  // Sidebar: prva user poruka po konverzaciji (distinct on)
  const { data: sve } = await supabase
    .from("chat_poruke")
    .select("konverzacija_id, uloga, sadrzaj, created_at")
    .order("created_at", { ascending: true })
  const razgovoriMap = new Map<string, { id: string; naslov: string; created_at: string }>()
  for (const r of (sve ?? []) as Pick<PorukaRow, "konverzacija_id" | "uloga" | "sadrzaj" | "created_at">[]) {
    if (!razgovoriMap.has(r.konverzacija_id) && r.uloga === "user") {
      razgovoriMap.set(r.konverzacija_id, {
        id: r.konverzacija_id,
        naslov: r.sadrzaj.slice(0, 60),
        created_at: r.created_at,
      })
    }
  }
  const razgovori = [...razgovoriMap.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))

  // Učitaj poruke aktivne konverzacije
  let pocetnePoruke: UiPoruka[] = []
  if (aktivni) {
    const poruke = (sve ?? []).filter((p) => p.konverzacija_id === aktivni)
    pocetnePoruke = poruke.map((p): UiPoruka => ({
      role: p.uloga as "user" | "assistant",
      text: p.sadrzaj,
    }))
  }

  return (
    <div className="grid grid-cols-[260px_1fr] gap-4">
      <aside className="space-y-3 border-r border-border pr-4" data-testid="razgovori-sidebar">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">{t("sidebar.naslov")}</h2>
          <NoviRazgovorButton />
        </div>
        <ul className="space-y-1">
          {razgovori.length === 0 && <li className="text-xs text-muted-foreground">{t("sidebar.prazno")}</li>}
          {razgovori.map((r) => (
            <li key={r.id}>
              <Link
                href={href(`/asistent?k=${r.id}`)}
                data-testid="razgovor-link"
                className={`block truncate rounded-md px-2 py-1 text-sm hover:bg-muted ${r.id === aktivni ? "bg-muted font-medium" : "text-muted-foreground"}`}
              >
                {r.naslov || t("sidebar.bezNaslova")}
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <section>
        <h1 className="mb-3 text-2xl font-semibold">{t("naslov")}</h1>
        {aktivni ? (
          <AsistentChat key={aktivni} konverzacijaId={aktivni} pocetnePoruke={pocetnePoruke} />
        ) : (
          <NoviRazgovorChat prazanRazgovor={t("prazanRazgovor")} />
        )}
      </section>
    </div>
  )
}

function NoviRazgovorChat({ prazanRazgovor }: { prazanRazgovor: string }) {
  return (
    <div data-testid="prazan-asistent" className="rounded-xl border border-border p-6 text-sm text-muted-foreground">
      {prazanRazgovor}
    </div>
  )
}
