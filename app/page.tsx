import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

export default function Home() {
  return (
    <main className="min-h-screen p-12">
      <h1 className="text-3xl font-semibold text-brand">Tehpro</h1>
      <p className="mt-2 text-slate-600">
        Sistem za termine i provjere — temelji postavljeni.
      </p>

      <Card className="mt-6 max-w-md">
        <CardHeader>
          <CardTitle>shadcn/ui radi</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
        </CardContent>
      </Card>
    </main>
  )
}
