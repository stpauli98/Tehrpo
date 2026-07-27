import { Skeleton } from "@/components/ui/skeleton"

/**
 * S16: raspored prati stvarni ekran — naslov + (izvoz dugme, prebacivač prikaza),
 * pa traka toolbara/filtera, pa redovi sadržaja. Stat-kartice su davno uklonjene
 * sa Plana; skeleton koji ih je i dalje crtao „skakao" je pri prelasku u sadržaj.
 */
export default function PlanAktivnostiLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-8 w-48" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-8 w-56" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-8 w-56" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )
}
