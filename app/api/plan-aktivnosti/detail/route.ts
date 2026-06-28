import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import type { TerminRow } from "@/components/domain/TerminiTable"

/**
 * GET /api/plan-aktivnosti/detail?id=<terminId>
 *
 * Returns the full termin detail for the TerminSheet:
 *   {
 *     termin:   TerminRow | null
 *     istorija: TerminRow[]   – last 5 executed cycles for same klijent+vrsta
 *     dokumenti: DokumentiRow[]
 *   }
 *
 * Used by all three plan-aktivnosti views (lista, matrica, kalendar) to open
 * the detail sheet on the client without a server round-trip on the parent view.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 })
  }

  const supabase = await createServerSupabaseClient()

  const { data: terminData, error } = await supabase
    .from("termini_view")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error }, { status: 400 })
  }

  const termin = (terminData as TerminRow | null)

  const [istorija, dokumenti] = termin
    ? await Promise.all([
        termin.klijent_id && termin.vrsta_provjere_id
          ? supabase
              .from("termini_view")
              .select("*")
              .eq("klijent_id", termin.klijent_id)
              .eq("vrsta_provjere_id", termin.vrsta_provjere_id)
              .eq("status", "izvrseno")
              .neq("id", termin.id ?? "")
              .order("datum_izvrsenja", { ascending: false })
              .limit(5)
              .then((r) => r.data ?? [])
          : Promise.resolve([]),
        supabase
          .from("dokumenti")
          .select("*")
          .eq("termin_id", id)
          .order("uploaded_at", { ascending: false })
          .then((r) => r.data ?? []),
      ])
    : [[], []]

  return NextResponse.json({ termin, istorija, dokumenti })
}
