import { Skeleton } from "@/components/ui/skeleton"

/**
 * Skeleton preslikava STVARNI raspored `/postavke` (S16): naslov + niz zatvorenih
 * `CollapsibleSection` kartica. Mjere prate zaglavlje te komponente — kartica
 * `rounded-xl bg-card ring-1 ring-foreground/10`, unutra `px-4 py-3` red sa
 * `size-9` ikona-pločicom, dvije linije teksta i chevronom od 18px — da pri
 * učitavanju nema skoka rasporeda.
 *
 * Sekcije su zatvorene po defaultu, pa skeleton namjerno ne crta sadržaj panela.
 * Broj kartica = 5, koliko ih `page.tsx` renderuje adminu (Moj nalog, Podsjetnici,
 * Vrste pregleda, Korisnici, Ko šta prima); ostale uloge vide samo „Moj nalog", ali
 * njima ni ne dolazi teški fetch zbog kojeg ovaj skeleton postoji.
 */
export default function PostavkeLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-40" />

      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-9 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-72" />
            </div>
            <Skeleton className="size-[18px] shrink-0" />
          </div>
        </div>
      ))}
    </div>
  )
}
