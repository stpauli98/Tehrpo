import { createServerSupabaseClient } from "@/lib/supabase/server"
import { NoviKorisnikButton } from "./NoviKorisnikButton"
import { DodjelaKlijenata } from "./DodjelaKlijenata"
import { PrimaPodsjetnikeToggle } from "./PrimaPodsjetnikeToggle"

export async function KorisniciTab() {
  const supabase = await createServerSupabaseClient()
  const [korisniciRes, klijentiRes, dodjeleRes] = await Promise.all([
    supabase.from("korisnici").select("id, ime, email, uloga, aktivan, prima_podsjetnike").order("ime"),
    supabase.from("klijenti").select("id, naziv").order("naziv"),
    supabase.from("korisnik_klijent").select("korisnik_id, klijent_id"),
  ])
  const korisnici = korisniciRes.data ?? []
  const klijenti = klijentiRes.data ?? []
  const dodjele = dodjeleRes.data ?? []

  return (
    <section className="rounded-xl border border-slate-200 p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-base font-medium">Korisnici</h2>
        <NoviKorisnikButton />
      </div>
      <ul className="divide-y divide-slate-100">
        {korisnici.map((k) => (
          <li key={k.id} className="py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">{k.ime} {!k.aktivan && <span className="text-xs text-slate-400">(deaktiviran)</span>}</div>
              <div className="text-xs text-slate-500">{k.email} · {k.uloga}</div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <PrimaPodsjetnikeToggle korisnikId={k.id} prima={k.prima_podsjetnike} />
              {k.uloga !== "admin" && (
                <DodjelaKlijenata
                  korisnikId={k.id}
                  klijenti={klijenti}
                  izabrani={dodjele.filter((d) => d.korisnik_id === k.id).map((d) => d.klijent_id)}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
