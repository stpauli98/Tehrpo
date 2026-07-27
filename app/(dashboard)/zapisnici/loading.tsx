import { Skeleton } from "@/components/ui/skeleton"

// S16: raspored prati stvarnu stranicu (naslov → red pretraga+brojač →
// tabela-kartica). Preview blok i paginacija se ne skeletonizuju jer se
// renderuju uslovno. Vidi se i pri navigaciji na ?preview=<id> (Storage +
// mammoth roundtrip je spor).
export default function ZapisniciLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-40" />

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-8 w-full max-w-sm" />
          <Skeleton className="h-4 w-24 shrink-0" />
        </div>

        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="bg-muted px-3 py-2">
            <Skeleton className="h-4 w-full" />
          </div>
          <div className="divide-y divide-border">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              // 32px (Button size="icon" u koloni Akcije) + py-2 = 48px, tačna
              // visina stvarnog reda tabele — skeleton ne smije „skočiti" (S16).
              <div key={i} className="px-3 py-2">
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
