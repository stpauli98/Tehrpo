import { Monitor } from "lucide-react"

export function DesktopOnlyGate() {
  return (
    <div className="lg:hidden fixed inset-0 z-50 bg-white flex items-center justify-center p-8">
      <div className="max-w-sm text-center space-y-4">
        <Monitor className="w-16 h-16 mx-auto text-brand" aria-hidden />
        <h1 className="text-xl font-semibold">Tehpro je optimizovan za desktop</h1>
        <p className="text-slate-600 text-sm">
          Za rad sa sistemom otvorite aplikaciju na laptopu ili desktop
          računaru (ekran minimalno 1024px širine).
        </p>
        <p className="text-xs text-slate-400">
          Mobilna verzija nije u obimu ovog projekta.
        </p>
      </div>
    </div>
  )
}
