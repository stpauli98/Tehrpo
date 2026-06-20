export default function Home() {
  return (
    <main className="min-h-screen p-12">
      <h1 className="text-3xl font-semibold text-brand">Tehpro</h1>
      <p className="mt-2 text-slate-600">
        Sistem za termine i provjere — temelji postavljeni.
      </p>
      <div className="mt-6 flex gap-2">
        <span className="px-3 py-1 rounded-full text-xs font-medium text-white bg-status-planirano">Planirano</span>
        <span className="px-3 py-1 rounded-full text-xs font-medium text-white bg-status-zakazano">Zakazano</span>
        <span className="px-3 py-1 rounded-full text-xs font-medium text-white bg-status-izvrseno">Izvršeno</span>
        <span className="px-3 py-1 rounded-full text-xs font-medium text-white bg-status-kasni">Kasni</span>
      </div>
    </main>
  )
}
