import { Skeleton } from "@/components/ui/skeleton"

/**
 * Raspored prati stvarnu stranicu (`page.tsx`): grid 260px sidebar + chat panel,
 * ista visina panela `h-[calc(100vh-10rem)]` kao `AsistentChat` — skeleton ne smije
 * „skočiti" pri učitavanju (S16).
 */
export default function AsistentLoading() {
  return (
    <div className="grid grid-cols-[260px_1fr] gap-4">
      <aside className="space-y-3 border-r border-border pr-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="space-y-1">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </aside>

      <section>
        <Skeleton className="mb-3 h-8 w-40" />
        <Skeleton className="h-[calc(100vh-10rem)] w-full" />
      </section>
    </div>
  )
}
