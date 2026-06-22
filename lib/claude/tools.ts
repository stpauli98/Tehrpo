import Anthropic from "@anthropic-ai/sdk"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { generateZapisnik } from "@/lib/zapisnik/generate"
import { grupisiPoKlijentu } from "./grouping"

export type ToolName = "searchTermini" | "listFirme" | "predloziZapisnik" | "suggestGrupisanje"

export const TOOL_LABELS: Record<ToolName, string> = {
  searchTermini: "Pretražujem termine…",
  listFirme: "Pregledam firme…",
  suggestGrupisanje: "Grupišem termine po klijentu…",
  predloziZapisnik: "Pripremam prijedlog zapisnika…",
}

export type ProposalData = {
  terminId: string
  klijent: string
  vrsta: string
  datum: string
  nalaz: string
  zakljucak: string
}
export type ToolResult = { forModel: string; proposal?: ProposalData }

export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: "searchTermini",
    description:
      "Pretraži termine (preglede/provjere). Vrati listu termina sa klijentom, vrstom, lokacijom, rokom i statusom. Koristi za upite tipa 'koji termini kasne', 'termini za WAIKIKI', 'šta dospijeva ovog mjeseca'.",
    input_schema: {
      type: "object",
      properties: {
        pretraga: { type: "string", description: "Tekst za pretragu po nazivu klijenta ili lokacije (opcionalno)" },
        status: { type: "string", enum: ["kasni", "planirano", "zakazano", "izvrseno", "otkazano"], description: "Filter po statusu (opcionalno)" },
        limit: { type: "number", description: "Maks. broj rezultata (default 20)" },
      },
    },
  },
  {
    name: "listFirme",
    description:
      "Lista klijenata (firmi) sa brojem aktivnih, kasnih i izvršenih termina. Koristi za 'koje firme imamo', 'koja firma najviše kasni'.",
    input_schema: {
      type: "object",
      properties: {
        pretraga: { type: "string", description: "Tekst za pretragu po nazivu firme (opcionalno)" },
        limit: { type: "number", description: "Maks. broj rezultata (default 20)" },
      },
    },
  },
  {
    name: "suggestGrupisanje",
    description:
      "Grupiši aktivne (kasne/planirane/zakazane) termine po klijentu — pregled obaveza po firmi, sortirano po broju kasnih. Koristi za planiranje obilazaka po klijentu.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "predloziZapisnik",
    description:
      "Pripremi PRIJEDLOG teksta zapisnika za jedan termin (po termin_id, koji dobiješ iz searchTermini). Vraća nalaz i zaključak. NE snima — korisnik potvrđuje snimanje u interfejsu.",
    input_schema: {
      type: "object",
      properties: { termin_id: { type: "string", description: "UUID termina iz searchTermini rezultata" } },
      required: ["termin_id"],
    },
  },
]

const MAX = 20

export async function executeTool(name: string, input: unknown): Promise<ToolResult> {
  const args = (input ?? {}) as Record<string, unknown>
  const supabase = await createServerSupabaseClient()

  if (name === "searchTermini") {
    let q = supabase
      .from("termini_view")
      .select("id, klijent_naziv, vrsta_naziv, lokacija_naziv, lokacija_grad, rok_dospijeca, status_izvedeni, datum_izvrsenja")
      .order("rok_dospijeca", { ascending: true })
      .limit(typeof args.limit === "number" ? Math.min(args.limit, 50) : MAX)
    if (typeof args.pretraga === "string" && args.pretraga.trim()) {
      const p = args.pretraga.trim().replace(/[%,()*:."'\\]/g, "").slice(0, 50)
      q = q.or(`klijent_naziv.ilike.%${p}%,lokacija_naziv.ilike.%${p}%`)
    }
    if (typeof args.status === "string") q = q.eq("status_izvedeni", args.status)
    const { data, error } = await q
    if (error) return { forModel: `Greška pri pretrazi termina: ${error.message}` }
    return { forModel: JSON.stringify(data ?? []) }
  }

  if (name === "listFirme") {
    let q = supabase
      .from("klijenti_view")
      .select("id, naziv, broj_aktivnih, broj_kasni, broj_izvrseno, broj_termina, broj_lokacija")
      .order("broj_kasni", { ascending: false })
      .limit(typeof args.limit === "number" ? Math.min(args.limit, 50) : MAX)
    if (typeof args.pretraga === "string" && args.pretraga.trim()) {
      const p = args.pretraga.trim().replace(/[%,()*:."'\\]/g, "").slice(0, 50)
      q = q.ilike("naziv", `%${p}%`)
    }
    const { data, error } = await q
    if (error) return { forModel: `Greška pri listanju firmi: ${error.message}` }
    return { forModel: JSON.stringify(data ?? []) }
  }

  if (name === "suggestGrupisanje") {
    const { data, error } = await supabase
      .from("termini_view")
      .select("klijent_naziv, status_izvedeni")
      .neq("status_izvedeni", "izvrseno")
    if (error) return { forModel: `Greška pri grupisanju: ${error.message}` }
    return { forModel: JSON.stringify(grupisiPoKlijentu(data ?? [])) }
  }

  if (name === "predloziZapisnik") {
    const terminId = typeof args.termin_id === "string" ? args.termin_id : ""
    if (!terminId) return { forModel: "Nedostaje termin_id." }
    const { data: t } = await supabase
      .from("termini_view")
      .select("klijent_naziv, lokacija_naziv, vrsta_naziv, datum_izvrsenja")
      .eq("id", terminId)
      .maybeSingle()
    if (!t) return { forModel: "Termin sa tim ID-em ne postoji." }
    const datum = (t.datum_izvrsenja ?? new Date().toISOString()).slice(0, 10)
    const c = await generateZapisnik({
      klijent: t.klijent_naziv ?? "—",
      lokacija: t.lokacija_naziv ?? null,
      vrstaProvjere: t.vrsta_naziv ?? "—",
      datum,
      zaduzeni: null,
    })
    return {
      forModel: `Prijedlog zapisnika je pripremljen za ${t.klijent_naziv ?? "—"} (${t.vrsta_naziv ?? "—"}). Korisniku je prikazano dugme za snimanje. Ukratko prepričaj nalaz i zaključak i reci mu da klikne "Snimi zapisnik" ako želi sačuvati.`,
      proposal: {
        terminId,
        klijent: t.klijent_naziv ?? "—",
        vrsta: t.vrsta_naziv ?? "—",
        datum,
        nalaz: c.nalaz,
        zakljucak: c.zakljucak,
      },
    }
  }

  return { forModel: `Nepoznat alat: ${name}` }
}
