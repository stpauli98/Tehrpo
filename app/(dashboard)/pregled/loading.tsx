import { Skeleton } from "@/components/ui/skeleton"

export default function PregledLoading() {
  return (
    <div className="space-y-6">
      <div><Skeleton className="h-8 w-32 mb-2" /><Skeleton className="h-4 w-48" /></div>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {[0,1,2,3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
      {/* Redoslijed prati stvarni raspored stranice: lista pa grafikon, oba pune širine (S16) */}
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-80 w-full" />
    </div>
  )
}
