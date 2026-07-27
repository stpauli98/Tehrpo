import { Skeleton } from "@/components/ui/skeleton"

// Skeleton prati STVARNI raspored detalj stranice (S16): nazad-link, header red
// (avatar 12×12 + naslov + 2 dugmeta desno), tabs traka, pa sadržajni blok.
export default function KlijentDetaljLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-5 w-28" />

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>

      <Skeleton className="h-10 w-full" />

      <Skeleton className="h-64 w-full" />
    </div>
  )
}
