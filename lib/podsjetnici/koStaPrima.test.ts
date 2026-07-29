import { describe, it, expect } from "vitest"
import sr from "@/messages/sr.json"
import en from "@/messages/en.json"
import de from "@/messages/de.json"
import {
  izracunajIshodReda,
  izracunajStatusRadnika,
  stalniPrimaoci,
  nepokriveneLokacije,
  grupisiAdrese,
  trebaUpozorenje,
  jeOdsjeceno,
  type LokacijaRef,
} from "./koStaPrima"

describe("izracunajIshodReda", () => {
  const ok = { podsjetniciAktivni: true, saljiGlobalno: true, saljiFirmi: true, brojAdresa: 1 }

  it("prima kad su sva četiri uslova ispunjena", () => {
    expect(izracunajIshodReda(ok)).toEqual({ prima: true, razlog: null })
  })

  it("automatika je najviši razlog — nadjačava i globalni i firmin i adrese", () => {
    expect(izracunajIshodReda({ ...ok, podsjetniciAktivni: false })).toEqual({
      prima: false,
      razlog: "automatika",
    })
    expect(
      izracunajIshodReda({ podsjetniciAktivni: false, saljiGlobalno: false, saljiFirmi: false, brojAdresa: 0 }),
    ).toEqual({ prima: false, razlog: "automatika" })
  })

  it("globalni prekidač je iznad firminog", () => {
    expect(izracunajIshodReda({ ...ok, saljiGlobalno: false, saljiFirmi: false })).toEqual({
      prima: false,
      razlog: "globalno",
    })
  })

  it("firmin flag je iznad adresa", () => {
    expect(izracunajIshodReda({ ...ok, saljiFirmi: false, brojAdresa: 0 })).toEqual({
      prima: false,
      razlog: "firma",
    })
  })

  it("nema adrese je zadnji razlog", () => {
    expect(izracunajIshodReda({ ...ok, brojAdresa: 0 })).toEqual({
      prima: false,
      razlog: "nemaAdrese",
    })
  })
})

describe("katalozi — opis automatskog slanja", () => {
  const katalozi = { sr, en, de }

  it("ne tvrdi zastarjelo vrijeme slanja (cron je 09:00 i 13:00 UTC)", () => {
    for (const [jezik, k] of Object.entries(katalozi)) {
      const opis = k.postavke.podsjetniciKontrole.opis
      expect(opis, jezik).not.toMatch(/06:00|6:00/)
    }
  })

  it("čuva placeholder {lokacije} u poruci o nepokrivenim lokacijama", () => {
    for (const [jezik, k] of Object.entries(katalozi)) {
      expect(k.postavke.koStaPrima.nepokriveneLokacije, jezik).toContain("{lokacije}")
    }
  })

  it("kaže da obavijest o zakazivanju ima svoj prekidač", () => {
    // Nalaz #3: podsjetnici_aktivni NE gasi zabiljezi_zakazano_obavijest (gejtuje ga
    // samo zakazano_obavijest_aktivna). Opis to mora reći, jer se inače čita kao master.
    expect(sr.postavke.podsjetniciKontrole.opis).toContain("zakazivanju")
    expect(en.postavke.podsjetniciKontrole.opis.toLowerCase()).toContain("scheduling")
    expect(de.postavke.podsjetniciKontrole.opis.toLowerCase()).toContain("terminierung")
  })
})

describe("izracunajStatusRadnika", () => {
  it("nema dodijeljenih", () => {
    expect(izracunajStatusRadnika(0, 0)).toBe("nemaDodijeljenih")
  })

  it("ima dodijeljenih ali nijedan ne prima → optOut", () => {
    expect(izracunajStatusRadnika(3, 0)).toBe("optOut")
  })

  it("barem jedan prima → ima", () => {
    expect(izracunajStatusRadnika(3, 1)).toBe("ima")
    expect(izracunajStatusRadnika(1, 1)).toBe("ima")
  })
})

describe("stalniPrimaoci", () => {
  const admin = {
    id: "a1", email: "admin@firma.ba", uloga: "admin", aktivan: true, prima_podsjetnike: true,
  }

  it("uključuje aktivnog admina koji prima i REMINDER_TO adrese, lowercase i bez duplikata", () => {
    expect(stalniPrimaoci([admin], "Sef@Firma.ba, admin@firma.ba")).toEqual([
      "sef@firma.ba",
      "admin@firma.ba",
    ])
  })

  it("izostavlja admina koji je deaktiviran ili je isključio podsjetnike", () => {
    expect(stalniPrimaoci([{ ...admin, aktivan: false }], "")).toEqual([])
    expect(stalniPrimaoci([{ ...admin, prima_podsjetnike: false }], "")).toEqual([])
  })

  it("izostavlja ne-admine (oni primaju samo preko dodjele)", () => {
    expect(stalniPrimaoci([{ ...admin, uloga: "operater" }], "")).toEqual([])
  })

  it("preskače nevalidne adrese i prazan REMINDER_TO", () => {
    expect(stalniPrimaoci([{ ...admin, email: "nije-mejl" }], undefined)).toEqual([])
  })
})

describe("nepokriveneLokacije", () => {
  const lokA: LokacijaRef = { id: "a", naziv: "Lokacija A" }
  const lokB: LokacijaRef = { id: "b", naziv: "Lokacija B" }
  const lokC: LokacijaRef = { id: "c", naziv: "Lokacija C" }

  it("firma bez lokacija → prazan rezultat", () => {
    expect(
      nepokriveneLokacije({
        lokacije: [],
        brojAdresaFirme: 0,
        adresePoLokaciji: new Map(),
        imaTerminaBezLokacije: false,
      }),
    ).toEqual({ lokacije: [], terminiBezLokacije: false })
  })

  it("brojAdresaFirme > 0 → prazan rezultat bez obzira na adresePoLokaciji", () => {
    expect(
      nepokriveneLokacije({
        lokacije: [lokA, lokB],
        brojAdresaFirme: 1,
        adresePoLokaciji: new Map(),
        imaTerminaBezLokacije: false,
      }),
    ).toEqual({ lokacije: [], terminiBezLokacije: false })
  })

  it("brojAdresaFirme === 0, lokacija ima svoj kontakt → pokrivena", () => {
    expect(
      nepokriveneLokacije({
        lokacije: [lokA],
        brojAdresaFirme: 0,
        adresePoLokaciji: new Map([["a", 1]]),
        imaTerminaBezLokacije: false,
      }),
    ).toEqual({ lokacije: [], terminiBezLokacije: false })
  })

  it("brojAdresaFirme === 0, lokacija nema kontakt → nepokrivena", () => {
    expect(
      nepokriveneLokacije({
        lokacije: [lokA],
        brojAdresaFirme: 0,
        adresePoLokaciji: new Map(),
        imaTerminaBezLokacije: false,
      }),
    ).toEqual({ lokacije: [lokA], terminiBezLokacije: false })
  })

  it("miješan slučaj: tri lokacije, samo jedna ima kontakt → druge dvije u rezultatu, tim redom", () => {
    expect(
      nepokriveneLokacije({
        lokacije: [lokA, lokB, lokC],
        brojAdresaFirme: 0,
        adresePoLokaciji: new Map([["b", 2]]),
        imaTerminaBezLokacije: false,
      }),
    ).toEqual({ lokacije: [lokA, lokC], terminiBezLokacije: false })
  })

  it("adresePoLokaciji sa vrijednošću 0 za lokaciju → tretira se kao nepokrivena", () => {
    expect(
      nepokriveneLokacije({
        lokacije: [lokA],
        brojAdresaFirme: 0,
        adresePoLokaciji: new Map([["a", 0]]),
        imaTerminaBezLokacije: false,
      }),
    ).toEqual({ lokacije: [lokA], terminiBezLokacije: false })
  })

  it("unos u adresePoLokaciji za lokacija_id koji ne postoji u lokacije → ignoriše se, ne pada", () => {
    expect(
      nepokriveneLokacije({
        lokacije: [lokA],
        brojAdresaFirme: 0,
        adresePoLokaciji: new Map([["nepostojeca", 5]]),
        imaTerminaBezLokacije: false,
      }),
    ).toEqual({ lokacije: [lokA], terminiBezLokacije: false })
  })

  // ---- terminiBezLokacije ------------------------------------------------------------

  it("imaTerminaBezLokacije: false → terminiBezLokacije uvijek false, bez obzira na brojAdresaFirme", () => {
    expect(
      nepokriveneLokacije({
        lokacije: [],
        brojAdresaFirme: 0,
        adresePoLokaciji: new Map(),
        imaTerminaBezLokacije: false,
      }).terminiBezLokacije,
    ).toBe(false)
    expect(
      nepokriveneLokacije({
        lokacije: [],
        brojAdresaFirme: 5,
        adresePoLokaciji: new Map(),
        imaTerminaBezLokacije: false,
      }).terminiBezLokacije,
    ).toBe(false)
  })

  it("imaTerminaBezLokacije: true, brojAdresaFirme: 0 → terminiBezLokacije true", () => {
    expect(
      nepokriveneLokacije({
        lokacije: [],
        brojAdresaFirme: 0,
        adresePoLokaciji: new Map(),
        imaTerminaBezLokacije: true,
      }).terminiBezLokacije,
    ).toBe(true)
  })

  it("imaTerminaBezLokacije: true, brojAdresaFirme: 1 → terminiBezLokacije false (firma-adresa pokriva termine bez lokacije)", () => {
    expect(
      nepokriveneLokacije({
        lokacije: [],
        brojAdresaFirme: 1,
        adresePoLokaciji: new Map(),
        imaTerminaBezLokacije: true,
      }).terminiBezLokacije,
    ).toBe(false)
  })

  it("kombinacija: nepokrivene lokacije I termini bez lokacije istovremeno", () => {
    expect(
      nepokriveneLokacije({
        lokacije: [lokA, lokB],
        brojAdresaFirme: 0,
        adresePoLokaciji: new Map([["a", 1]]),
        imaTerminaBezLokacije: true,
      }),
    ).toEqual({ lokacije: [lokB], terminiBezLokacije: true })
  })
})

describe("grupisiAdrese", () => {
  it("kontakt bez lokacija_id ide u firma-adrese, sa lokacija_id u poLokaciji", () => {
    const rez = grupisiAdrese({
      kontakti: [
        { klijent_id: "k1", email: "firma@x.ba", podsjetnik_primalac: true, lokacija_id: null },
        { klijent_id: "k1", email: "lokacija@x.ba", podsjetnik_primalac: true, lokacija_id: "loc1" },
      ],
      klijenti: [],
    })
    const g = rez.get("k1")
    expect(g?.firma).toEqual(new Set(["firma@x.ba"]))
    expect(g?.poLokaciji.get("loc1")).toEqual(new Set(["lokacija@x.ba"]))
    expect(g?.sve).toEqual(new Set(["firma@x.ba", "lokacija@x.ba"]))
  })

  it("ad-hoc adrese (klijenti.podsjetnik_emails) idu u firma-adrese, NIKAD u poLokaciji", () => {
    const rez = grupisiAdrese({
      kontakti: [],
      klijenti: [{ id: "k1", podsjetnik_emails: ["adhoc@x.ba"] }],
    })
    const g = rez.get("k1")
    expect(g?.firma).toEqual(new Set(["adhoc@x.ba"]))
    expect(g?.poLokaciji.size).toBe(0)
    expect(g?.sve).toEqual(new Set(["adhoc@x.ba"]))
  })

  it("preskače kontakt bez podsjetnik_primalac (nije flagovan kao primalac)", () => {
    const rez = grupisiAdrese({
      kontakti: [{ klijent_id: "k1", email: "x@x.ba", podsjetnik_primalac: false, lokacija_id: null }],
      klijenti: [],
    })
    expect(rez.get("k1")).toBeUndefined()
  })

  it("preskače nevalidne adrese (EMAIL_RE) i kod kontakata i kod ad-hoc", () => {
    const rez = grupisiAdrese({
      kontakti: [{ klijent_id: "k1", email: "nije-mejl", podsjetnik_primalac: true, lokacija_id: null }],
      klijenti: [{ id: "k1", podsjetnik_emails: ["takodje-nije-mejl"] }],
    })
    expect(rez.get("k1")?.sve.size).toBe(0)
    expect(rez.get("k1")?.firma.size).toBe(0)
  })

  it("prazan string kao lokacija_id se tretira kao lokacijski (?? null, ne truthy) — usklađeno sa BUILD stranom engine-a", () => {
    // Napomena (vidi komentar uz grupisiAdrese): READ strana engine-a (firmaRecipientsZa,
    // recipients.ts:149) truthy-testira TERMINOV lokacijaId, ne kontaktov, pa kontakt sa
    // lokacija_id === "" ionako nikad ne dobije mejl — praktično nedostižno (uuid FK), ne
    // mijenjamo ponašanje zbog toga. Ovaj test provjerava samo BUILD stranu (bucket ključ).
    const rez = grupisiAdrese({
      kontakti: [{ klijent_id: "k1", email: "x@x.ba", podsjetnik_primalac: true, lokacija_id: "" }],
      klijenti: [],
    })
    const g = rez.get("k1")
    // "" nije null, pa NE smije završiti u `firma` (truthy provjera bi je pogrešno stavila tamo).
    expect(g?.firma.size).toBe(0)
    expect(g?.poLokaciji.get("")).toEqual(new Set(["x@x.ba"]))
  })

  it("adresa sa razmacima i bez dvojnika ipak završi u skupu (dokazuje da .trim() stvarno radi)", () => {
    // Prethodni test (dedup ispod) koristi DVA unosa koji se poslije trim/lowercase
    // poklapaju — bez .trim() bi nevalidan email jednostavno ispao (EMAIL_RE ne prolazi
    // razmake), a preživjeli bi normalizovani unos, pa bi test i dalje prošao a da .trim()
    // ne radi. Ovdje je SAMO jedan unos, sa razmacima, bez dvojnika — mora završiti u
    // skupu kao trimovan string, inače EMAIL_RE odbije razmake i skup ostane prazan.
    const rez = grupisiAdrese({
      kontakti: [{ klijent_id: "k1", email: "  jedina@firma.ba  ", podsjetnik_primalac: true, lokacija_id: null }],
      klijenti: [],
    })
    expect(rez.get("k1")?.firma).toEqual(new Set(["jedina@firma.ba"]))
  })

  it("dedup + normalizacija (trim/lowercase) kroz Set, uskladeno s engine-om", () => {
    const rez = grupisiAdrese({
      kontakti: [
        { klijent_id: "k1", email: "  Ana@Firma.ba ", podsjetnik_primalac: true, lokacija_id: null },
        { klijent_id: "k1", email: "ana@firma.ba", podsjetnik_primalac: true, lokacija_id: null },
      ],
      klijenti: [],
    })
    expect(rez.get("k1")?.firma).toEqual(new Set(["ana@firma.ba"]))
  })
})

describe("trebaUpozorenje", () => {
  const ok = { saljiGlobalno: true, saljiFirmi: true, brojAdresa: 1 }

  it("sva tri uslova ispunjena → true", () => {
    expect(trebaUpozorenje(ok)).toBe(true)
  })

  it("brojAdresa <= 0 → false, bez obzira na ostalo", () => {
    expect(trebaUpozorenje({ ...ok, brojAdresa: 0 })).toBe(false)
  })

  it("saljiGlobalno false → false", () => {
    expect(trebaUpozorenje({ ...ok, saljiGlobalno: false })).toBe(false)
  })

  it("saljiFirmi false → false", () => {
    expect(trebaUpozorenje({ ...ok, saljiFirmi: false })).toBe(false)
  })
})

describe("jeOdsjeceno", () => {
  it("count je null ili undefined → nije odsječeno", () => {
    expect(jeOdsjeceno(null, 5)).toBe(false)
    expect(jeOdsjeceno(undefined, 5)).toBe(false)
  })

  it("count jednak vraćenom → nije odsječeno", () => {
    expect(jeOdsjeceno(5, 5)).toBe(false)
  })

  it("count veći od vraćenog → odsječeno", () => {
    expect(jeOdsjeceno(6, 5)).toBe(true)
  })

  it("count manji od vraćenog (ne bi trebalo da se desi) → nije odsječeno", () => {
    expect(jeOdsjeceno(4, 5)).toBe(false)
  })
})
