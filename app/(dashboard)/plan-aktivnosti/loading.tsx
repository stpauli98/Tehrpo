import { Skeleton } from "@/components/ui/skeleton"

export default function PlanAktivnostiLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-8 w-48" /><Skeleton className="h-10 w-32" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {[0,1,2,3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
      <div className="space-y-2">
        {[0,1,2,3,4,5,6,7,8,9].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    </div>
  )
}
