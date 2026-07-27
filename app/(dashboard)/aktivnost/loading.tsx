import { Skeleton } from "@/components/ui/skeleton"

// S16: skeleton prati stvarni raspored ekrana — filter kontrole su labela (text-xs)
// iznad kontrole visine h-8, a redovi tabele žive u kanonskom okviru (S6).
function FilterSkeleton({ sirina }: { sirina: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Skeleton className="h-3 w-16" />
      <Skeleton className={`h-8 ${sirina}`} />
    </div>
  )
}

export default function AktivnostLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <FilterSkeleton sirina="w-72" />
        <FilterSkeleton sirina="w-44" />
        <FilterSkeleton sirina="w-36" />
        <FilterSkeleton sirina="w-36" />
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="space-y-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
        {[0,1,2,3,4,5,6,7,8,9].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    </div>
  )
}
