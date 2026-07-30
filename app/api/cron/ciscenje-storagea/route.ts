/**
 * Noćno metenje osirotjelih objekata iz bucketa `tehpro-dokumenti` (cron: vercel.json).
 *
 * BRISANJE JE ISKLJUČENO DOK SE IZRIČITO NE UKLJUČI: bez `CISCENJE_STORAGEA_APPLY=1`
 * ruta radi PROBNI prolaz — izračuna odluku, ispiše u log tačno šta bi obrisala i vrati
 * `{ ok: true, probno: true, biObrisano, putanje }`, a `remove()` ne pozove. Isti odnos
 * kao kod ručnog `pnpm gc:dokumenti` (dry-run po defaultu, `--apply` za stvarno brisanje);
 * automatska varijanta je opasnija pa ne smije biti labavija. Prije uključivanja flag-a
 * pogledaj bar jedan probni prolaz u Vercel logovima.
 *
 * Bucket drži zakonski obavezne zapisnike zaštite na radu — brisanje je nepovratno.
 */
import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { isCronAuthorized } from "@/lib/reminders/cronAuth"
import { odluciSta } from "@/lib/dokumenti/sweep"
import { listajFajlove, svePutanjeUBazi, DOKUMENTI_BUCKET } from "@/lib/dokumenti/popis"
import { env } from "@/lib/env"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// Upload prvo piše fajl pa onda red u `dokumenti`. Fajl uhvaćen u tom procjepu izgleda
// osirotjelo. 24h je isti prag koji već koristi scripts/gc-orphan-dokumenti.ts.
const GRACE_MS = 24 * 60 * 60 * 1000

/** Brisanje se izvršava SAMO uz eksplicitni flag; sve ostalo (prazno, "0", "false") = probni prolaz. */
function brisanjeUkljuceno(): boolean {
  return env.CISCENJE_STORAGEA_APPLY === "1"
}

async function handle(req: Request) {
  if (!isCronAuthorized(req.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const supabase = createAdminSupabaseClient()
  try {
    const objekti = await listajFajlove(supabase)
    const { putanje, error } = await svePutanjeUBazi(supabase)
    if (error) return NextResponse.json({ ok: false, error }, { status: 500 })

    // Sve odluke (prekid na praznu bazu, prekid na prevelik udio, grace period,
    // set-difference) su u čistoj odluciSta — ruta samo prikuplja I/O i izvršava presudu.
    const odluka = odluciSta(objekti, putanje, Date.now(), GRACE_MS)
    if (odluka.akcija === "prekid") {
      console.warn(`[ciscenje-storagea] PREKID: ${odluka.razlog}`)
      return NextResponse.json({ ok: false, error: odluka.razlog }, { status: 500 })
    }

    // Red u bazi bez fajla se NIKAD ne dira, ali jeste signal korupcije — mora se vidjeti.
    if (odluka.slomljeniRedovi.length) {
      console.warn(
        `[ciscenje-storagea] slomljeni redovi (fajl fali, samo prijava): ${odluka.slomljeniRedovi.length}`,
        odluka.slomljeniRedovi,
      )
    }

    const zaBrisanje = odluka.putanje
    if (!zaBrisanje.length) {
      return NextResponse.json({ ok: true, obrisano: 0, slomljeniRedovi: odluka.slomljeniRedovi })
    }

    // Jedini trag o obrisanim fajlovima: tg_audit pokriva redove u `dokumenti`, ne storage
    // objekte. Bez ovog log-a se poslije pogrešnog brisanja ne bi znalo ni ŠTA tražiti u backupu.
    if (!brisanjeUkljuceno()) {
      console.warn(
        `[ciscenje-storagea] PROBNO (CISCENJE_STORAGEA_APPLY nije "1") — bi obrisao ${zaBrisanje.length} objekata:`,
        zaBrisanje,
      )
      return NextResponse.json({
        ok: true,
        probno: true,
        biObrisano: zaBrisanje.length,
        putanje: zaBrisanje,
        slomljeniRedovi: odluka.slomljeniRedovi,
      })
    }

    // Brisanje u grupama od 100, kao postojeći scripts/gc-orphan-dokumenti.ts.
    let obrisano = 0
    for (let i = 0; i < zaBrisanje.length; i += 100) {
      const grupa = zaBrisanje.slice(i, i + 100)
      console.warn(`[ciscenje-storagea] brišem ${grupa.length} objekata:`, grupa)
      // eslint-disable-next-line no-await-in-loop -- sekvencijalne grupe; broj grupa je mali
      const { data, error: greska } = await supabase.storage.from(DOKUMENTI_BUCKET).remove(grupa)
      if (greska) return NextResponse.json({ ok: false, error: greska.message }, { status: 500 })
      // remove() vraća STVARNO uklonjene objekte — grupa.length bi brojala namjeru.
      obrisano += data?.length ?? 0
    }
    return NextResponse.json({
      ok: true,
      obrisano,
      putanje: zaBrisanje,
      slomljeniRedovi: odluka.slomljeniRedovi,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
