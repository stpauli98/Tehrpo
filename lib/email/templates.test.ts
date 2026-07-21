import { describe, it, expect } from "vitest"
import {
  reminderSubject, reminderHtml, escapeHtml, testEmailSubject, testEmailHtml,
  reminderHtmlFirma, zakazanoNakonRokaHtml,
  rokIstekaoFirmaSubject, rokIstekaoFirmaHtml,
  digestSubject, digestHtml,
} from "./templates"

describe("escapeHtml", () => {
  it("escape-uje HTML meta znakove", () => {
    expect(escapeHtml('<b>"&\'')).toBe("&lt;b&gt;&quot;&amp;&#39;")
  })
})

describe("testEmail", () => {
  it("subject sadrži naziv aplikacije", () => {
    expect(testEmailSubject()).toContain("Testni email")
  })
  it("html ima pozdrav s imenom i escape-uje ga", () => {
    const html = testEmailHtml({ ime: "Marko <i>" })
    expect(html).toContain("Zdravo Marko &lt;i&gt;,")
    expect(html).toContain("TESTNI EMAIL")
  })
  it("html bez imena koristi generički pozdrav", () => {
    expect(testEmailHtml({ ime: null })).toContain("Zdravo,")
  })
})

describe("reminderSubject", () => {
  it("jednina za 1 dan", () => {
    expect(reminderSubject({ vrsta: "Servis PP aparata", klijent: "AS", danaDoRoka: 1 }))
      .toBe("Podsjetnik: Servis PP aparata — AS (rok za 1 dan)")
  })
  it("množina za 7 dana", () => {
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaDoRoka: 7 })).toContain("za 7 dana")
  })
  it("danas za 0", () => {
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaDoRoka: 0 })).toContain("rok danas")
  })
  it("kašnjenje (množina) za -3", () => {
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaDoRoka: -3 }))
      .toBe("Podsjetnik: Hidranti — AS (kasni 3 dana)")
  })
  it("kašnjenje (jednina) za -1", () => {
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaDoRoka: -1 })).toContain("kasni 1 dan")
  })
})

describe("reminderHtml", () => {
  const baza = { klijent: "AS & co", vrsta: "Hidranti", rok: "2026-09-15", danaDoRoka: 7, lokacija: null }

  it("sadrži klijenta, vrstu i formatiran rok; escape-uje vrijednosti", () => {
    const html = reminderHtml(baza)
    expect(html).toContain("AS &amp; co")
    expect(html).toContain("Hidranti")
    expect(html).toContain("15.09.2026.")
  })
  it("izostavlja lokaciju kad je null", () => {
    expect(reminderHtml(baza)).not.toContain("Lokacija")
  })
  it("status badge: USKORO za budući rok, KASNI za istekao", () => {
    expect(reminderHtml({ ...baza, danaDoRoka: 7 })).toContain("USKORO")
    const kasni = reminderHtml({ ...baza, danaDoRoka: -3 })
    expect(kasni).toContain("KASNI")
    expect(kasni).toContain("kasni 3 dana")
  })
  it("s baseUrl + id-jevima: oba dugmeta i tačni dashboard URL-ovi", () => {
    const html = reminderHtml({ ...baza, terminId: "t-123", klijentId: "k-456", baseUrl: "https://app.test" })
    expect(html).toContain("https://app.test/plan-aktivnosti?selected=t-123")
    expect(html).toContain("https://app.test/klijenti/k-456")
    expect(html).toContain("Otvori termin")
    expect(html).toContain("Otvori klijenta")
  })
  it("bez baseUrl: nema dugmadi ni linkova", () => {
    const html = reminderHtml({ ...baza, terminId: "t-123", klijentId: "k-456" })
    expect(html).not.toContain("Otvori termin")
    expect(html).not.toContain("/plan-aktivnosti?selected")
  })
})

describe("en lokal", () => {
  const baza = { klijent: "AS & co", vrsta: "Hidranti", rok: "2026-09-15", danaDoRoka: 7, lokacija: null }

  it("testEmailSubject na engleskom", () => {
    expect(testEmailSubject("en")).toContain("Test email")
  })
  it("testEmailHtml na engleskom: pozdrav, oznaka, html lang", () => {
    const html = testEmailHtml({ ime: "Marko" }, "en")
    expect(html).toContain("Hello Marko,")
    expect(html).toContain("TEST EMAIL")
    expect(html).toContain('<html lang="en">')
  })
  it("reminderSubject na engleskom: bez sr 'rok' prefiksa jer je već ugrađen u 'due'", () => {
    expect(reminderSubject({ vrsta: "Servis PP aparata", klijent: "AS", danaDoRoka: 1 }, "en"))
      .toBe("Reminder: Servis PP aparata — AS (due in 1 day)")
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaDoRoka: -3 }, "en"))
      .toBe("Reminder: Hidranti — AS (3 days overdue)")
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaDoRoka: 0 }, "en"))
      .toBe("Reminder: Hidranti — AS (due today)")
  })
  it("reminderHtml na engleskom: labele i dugmad", () => {
    const html = reminderHtml({ ...baza, terminId: "t-123", klijentId: "k-456", baseUrl: "https://app.test" }, "en")
    expect(html).toContain("Due date:")
    expect(html).toContain("Open appointment")
    expect(html).toContain("Open client")
    expect(html).toContain("UPCOMING")
    expect(html).toContain('<html lang="en">')
  })
})

describe("reminderHtmlFirma", () => {
  const brand = { name: "TEHPRO", tagline: "ZNR i ZOP", email: "info@tehpro.ba", phone: "+387 51 000 000" }
  const base = { klijent: "Drina Komerc d.o.o.", vrsta: "Ispitivanje hidrantske mreže", rok: "2026-07-18", danaDoRoka: 10, lokacija: "Centralni magacin", brand }

  it("NE sadrži interne linkove ka aplikaciji", () => {
    const html = reminderHtmlFirma(base)
    expect(html).not.toContain("/plan-aktivnosti")
    expect(html).not.toContain("/klijenti/")
    expect(html).not.toContain("Otvori termin")
  })
  it("prikazuje firmin brend i kontakt (ne APP_NAME)", () => {
    const html = reminderHtmlFirma(base)
    expect(html).toContain("TEHPRO")
    expect(html).toContain("ZNR i ZOP")
    expect(html).toContain("info@tehpro.ba")
  })
  it("prikazuje osnovne podatke roka", () => {
    const html = reminderHtmlFirma(base)
    expect(html).toContain("Drina Komerc d.o.o.")
    expect(html).toContain("Ispitivanje hidrantske mreže")
    expect(html).toContain("Centralni magacin")
  })
})

describe("osvježeni dijeljeni okvir", () => {
  const outs = [
    testEmailHtml({ ime: "X" }),
    reminderHtml({ klijent: "K", vrsta: "V", rok: "2026-09-15", danaDoRoka: 7, lokacija: null }),
    reminderHtmlFirma({ klijent: "K", vrsta: "V", rok: "2026-09-15", danaDoRoka: 7, lokacija: null, brand: { name: "B", tagline: "T" } }),
    zakazanoNakonRokaHtml({ klijent: "K", vrsta: "V", rok: "2026-09-15", zakazan: "2026-09-20", lokacija: null }),
  ]
  it("sve četiri poruke dijele osvježenu karticu (radius 12px + sjenka)", () => {
    for (const html of outs) {
      expect(html).toContain("border-radius:12px")
      expect(html).toContain("box-shadow:0 1px 3px rgba(15,23,42,.08)")
    }
  })
})

describe("rokIstekaoFirma", () => {
  const brand = { name: "TEHPRO", tagline: "Zaštita na radu i zaštita od požara" }

  it("subject ne sadrži riječ o kašnjenju", () => {
    const s = rokIstekaoFirmaSubject({ vrsta: "Obilazak", klijent: "CARMEUSE" })
    expect(s).toContain("CARMEUSE")
    expect(s.toLowerCase()).not.toContain("kasni")
  })

  it("html nema interne linkove ni dugmad", () => {
    const html = rokIstekaoFirmaHtml({
      klijent: "CARMEUSE", vrsta: "Obilazak", rok: "2026-07-13", brand,
    })
    expect(html).not.toContain("/plan-aktivnosti")
    expect(html).not.toContain("/klijenti/")
    expect(html).toContain("TEHPRO")
  })

  it("prikazuje zakazani datum kad postoji", () => {
    const html = rokIstekaoFirmaHtml({
      klijent: "CARMEUSE", vrsta: "Obilazak", rok: "2026-07-13", zakazanoZa: "2026-07-15", brand,
    })
    expect(html).toContain("15.07.2026")
    expect(html).toContain("13.07.2026")
  })

  it("escapuje naziv klijenta", () => {
    const html = rokIstekaoFirmaHtml({
      klijent: "A & B <test>", vrsta: "Obilazak", rok: "2026-07-13", brand,
    })
    expect(html).toContain("A &amp; B &lt;test&gt;")
    expect(html).not.toContain("<test>")
  })
})

describe("reminderHtml sa zakazanoZa", () => {
  it("prikazuje i rok i zakazani datum, i računa kašnjenje od zakazanog", () => {
    const html = reminderHtml({
      klijent: "CARMEUSE", vrsta: "Obilazak", rok: "2026-07-13",
      danaDoRoka: -2, zakazanoZa: "2026-07-15",
    })
    expect(html).toContain("13.07.2026")
    expect(html).toContain("15.07.2026")
  })
})

const stavka = (klijent: string, danaDoCiklusa: number, extra: Record<string, unknown> = {}) => ({
  klijent, vrsta: "Obilazak", rok: "2026-06-08", danaDoCiklusa, ...extra,
})

describe("digest", () => {
  it("subject nosi broj stavki", () => {
    expect(digestSubject({ broj: 3 })).toContain("3")
  })

  it("html sadrži svaku stavku", () => {
    const html = digestHtml({ stavke: [stavka("CARMEUSE", -6), stavka("WAIKIKI", -22)] })
    expect(html).toContain("CARMEUSE")
    expect(html).toContain("WAIKIKI")
  })

  it("escapuje nazive", () => {
    const html = digestHtml({ stavke: [stavka("A & B <x>", -6)] })
    expect(html).toContain("A &amp; B &lt;x&gt;")
    expect(html).not.toContain("<x>")
  })

  it("prikazuje zakazani datum kad se razlikuje od roka", () => {
    const html = digestHtml({ stavke: [stavka("CARMEUSE", -6, { zakazanoZa: "2026-07-15" })] })
    expect(html).toContain("15.07.2026")
  })

  it("dugme ka planu postoji samo uz baseUrl", () => {
    const bez = digestHtml({ stavke: [stavka("CARMEUSE", -6)] })
    expect(bez).not.toContain("plan-aktivnosti")
    const sa = digestHtml({ stavke: [stavka("CARMEUSE", -6)], baseUrl: "https://app.example.com" })
    expect(sa).toContain("plan-aktivnosti")
  })

  it("prazna lista ne baca", () => {
    expect(() => digestHtml({ stavke: [] })).not.toThrow()
  })

  it("redoslijed stavki slijedi redoslijed ulaza (ne sortira)", () => {
    // Stavke namjerno u redoslijedu koji NIJE sortiran po kašnjenju
    // (-3, -50, -1): bilo bi -50, -3, -1 da se sortiralo po kašnjenju.
    const html = digestHtml({
      stavke: [
        stavka("Alpha", -3),
        stavka("Beta", -50),
        stavka("Gamma", -1),
      ],
    })

    // Klijenti moraju biti u HTML-u u istom redoslijedu kao što su proslijeđeni.
    const posAlpha = html.indexOf("Alpha")
    const posBeta = html.indexOf("Beta")
    const posGamma = html.indexOf("Gamma")

    // Svi moraju biti pronađeni u HTML-u.
    expect(posAlpha).toBeGreaterThan(-1)
    expect(posBeta).toBeGreaterThan(-1)
    expect(posGamma).toBeGreaterThan(-1)

    // Redoslijed: Alpha → Beta → Gamma (kao što je proslijeđeno, ne sortirano)
    expect(posAlpha).toBeLessThan(posBeta)
    expect(posBeta).toBeLessThan(posGamma)
  })

  it("prikazuje tekst kašnjenja za danaDoCiklusa", () => {
    const html = digestHtml({ stavke: [stavka("CARMEUSE", -42)] })
    expect(html).toContain("kasni 42 dana")
  })
})
