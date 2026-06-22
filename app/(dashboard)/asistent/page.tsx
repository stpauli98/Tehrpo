import Link from "next/link"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { AsistentChat } from "@/components/domain/AsistentChat"
import { NoviRazgovorButton } from "@/components/domain/NoviRazgovorButton"
import type { UiPoruka } from "@/components/domain/ChatMessage"
import type { Database } from "@/db/types"

type PorukaRow = Database["public"]["Tables"]["chat_poruke"]["Row"]

export default async function AsistentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
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
      <aside className="space-y-3 border-r border-slate-200 pr-4" data-testid="razgovori-sidebar">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-600">Razgovori</h2>
          <NoviRazgovorButton />
        </div>
        <ul className="space-y-1">
          {razgovori.length === 0 && <li className="text-xs text-slate-400">Nema razgovora.</li>}
          {razgovori.map((r) => (
            <li key={r.id}>
              <Link
                href={`/asistent?k=${r.id}`}
                data-testid="razgovor-link"
                className={`block truncate rounded-md px-2 py-1 text-sm hover:bg-slate-50 ${r.id === aktivni ? "bg-slate-100 font-medium" : "text-slate-600"}`}
              >
                {r.naslov || "Razgovor"}
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <section>
        <h1 className="mb-3 text-2xl font-semibold">Asistent</h1>
        {aktivni ? (
          <AsistentChat key={aktivni} konverzacijaId={aktivni} pocetnePoruke={pocetnePoruke} />
        ) : (
          <NoviRazgovorChat />
        )}
      </section>
    </div>
  )
}

function NoviRazgovorChat() {
  return (
    <div data-testid="prazan-asistent" className="rounded-xl border border-slate-200 p-6 text-sm text-slate-500">
      Klikni &bdquo;+ Novi razgovor&rdquo; za početak, ili izaberi postojeći razgovor lijevo.
    </div>
  )
}
