import { ClipboardList, AlertTriangle, CheckCircle2, Bell } from "lucide-react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { StatCard } from "@/components/domain/StatCard"

export default async function TerminiPage() {
  const supabase = await createServerSupabaseClient()
  const { data: statsRows } = await supabase.rpc("get_termini_stats")
  const stats = statsRows?.[0] ?? {
    ukupno: 0, ovog_mjeseca: 0, kasni: 0, izvrseno_ovog_mjeseca: 0,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Termini</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4" data-testid="termini-stats">
        <StatCard
          testId="stat-ukupno"
          label="Ukupno termina"
          value={stats.ukupno}
          icon={ClipboardList}
        />
        <StatCard
          testId="stat-ovog-mjeseca"
          label="Ovog mjeseca"
          value={stats.ovog_mjeseca}
          sub="rok dospijeća"
          icon={Bell}
          tone="warning"
        />
        <StatCard
          testId="stat-kasni"
          label="Kasni rokovi"
          value={stats.kasni}
          sub="zahtijevaju akciju"
          icon={AlertTriangle}
          tone="danger"
        />
        <StatCard
          testId="stat-izvrseno"
          label="Izvršeni ovog mjeseca"
          value={stats.izvrseno_ovog_mjeseca}
          sub="završeno"
          icon={CheckCircle2}
          tone="success"
        />
      </div>
    </div>
  )
}
