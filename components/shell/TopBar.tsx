export function TopBar() {
  return (
    <header className="h-14 shrink-0 border-b border-slate-200 px-6 flex items-center justify-between bg-white">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded bg-brand text-white text-xs font-bold grid place-items-center">
          T
        </div>
        <span className="font-semibold">Tehpro</span>
        <span className="text-xs text-slate-400">Sistem za termine i provjere</span>
      </div>
      <div className="text-xs text-slate-400">v0.1 · MVP</div>
    </header>
  )
}
