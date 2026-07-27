import { Skeleton } from "@/components/ui/skeleton"

export default function ObilasciLoading() {
  return (
    <div className="space-y-6">
      <div><Skeleton className="h-8 w-40 mb-2" /><Skeleton className="h-4 w-72" /></div>
      {/* Filter red = ObilasciToolbar: 5 Select-a (period, status, grad, mjesec/kvartal, godina),
          SelectTrigger je h-8; isti raspored (flex flex-wrap items-center gap-3) da skeleton ne skače. */}
      <div className="flex flex-wrap items-center gap-3">
        {["w-40", "w-40", "w-44", "w-40", "w-28"].map((w, i) => (
          <Skeleton key={i} className={`h-8 ${w}`} />
        ))}
      </div>
      {[0,1,2].map((g) => (
        <div key={g} className="rounded-xl bg-card p-4 space-y-3 ring-1 ring-foreground/10">
          <Skeleton className="h-6 w-40" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {[0,1,2,3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        </div>
      ))}
    </div>
  )
}
