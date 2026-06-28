import { Skeleton } from "@/components/ui/skeleton"

export default function ObilasciLoading() {
  return (
    <div className="space-y-6">
      <div><Skeleton className="h-8 w-40 mb-2" /><Skeleton className="h-4 w-72" /></div>
      <div className="flex items-center gap-4 flex-wrap">
        {[0,1,2].map((i) => <Skeleton key={i} className="h-10 w-36" />)}
      </div>
      {[0,1,2].map((g) => (
        <div key={g} className="rounded-xl border border-slate-200 p-4 space-y-3">
          <Skeleton className="h-6 w-40" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {[0,1,2,3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        </div>
      ))}
    </div>
  )
}
