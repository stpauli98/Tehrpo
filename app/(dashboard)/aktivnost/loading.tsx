import { Skeleton } from "@/components/ui/skeleton"

export default function AktivnostLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-10 w-36" />
        <Skeleton className="h-10 w-36" />
        <Skeleton className="h-10 w-24" />
      </div>
      <div className="space-y-2">
        {[0,1,2,3,4,5,6,7,8,9].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    </div>
  )
}
