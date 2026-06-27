import { Sidebar } from "@/components/shell/Sidebar"
import { TopBar } from "@/components/shell/TopBar"
import { DesktopOnlyGate } from "@/components/shell/DesktopOnlyGate"
import { Toaster } from "@/components/ui/sonner"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const korisnik = await getTrenutniKorisnik()
  return (
    <>
      <DesktopOnlyGate />
      <div className="hidden lg:flex flex-col h-screen">
        <TopBar korisnik={korisnik} />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-auto p-6">{children}</main>
        </div>
      </div>
      <Toaster />
    </>
  )
}
