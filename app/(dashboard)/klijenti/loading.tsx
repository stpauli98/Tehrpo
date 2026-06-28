import { Skeleton } from "@/components/ui/skeleton"

export default function KlijentiLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-3"><Skeleton className="h-10 w-64" /><Skeleton className="h-10 w-32" /></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[0,1,2,3,4,5,6,7,8].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
      </div>
    </div>
  )
}
