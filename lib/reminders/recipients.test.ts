import { describe, it, expect } from "vitest"
import { parseEmailList, assembleRecipients, buildRecipientIndex, recipientsForKlijent, firmaRecipientsZa, jeDostavljiva } from "./recipients"

describe("jeDostavljiva", () => {
  // PROD 30.07.2026: korisnik „Test Admin" <admin@tehpro.local> je bio aktivan i
  // prima_podsjetnike=true, pa je ulazio u svaki interni podsjetnik. `.local` je
  // rezervisan TLD (RFC 6762) bez MX zapisa → tvrd bounce. Resend šalje JEDAN
  // bounce event za cijeli send (jedan email_id, više primalaca), pa je cijeli red
  // u „Poslatim mejlovima" postajao „Odbijeno" iako su ostali primaoci mejl primili.
  it("odbija rezervisane, nerutabilne domene", () => {
    expect(jeDostavljiva("admin@tehpro.local")).toBe(false)
    expect(jeDostavljiva("neko@masina.localhost")).toBe(false)
    expect(jeDostavljiva("neko@nesto.invalid")).toBe(false)
    expect(jeDostavljiva("neko@ruter.home.arpa")).toBe(false)
    expect(jeDostavljiva("root@localhost")).toBe(false)
  })
  it("velika slova i razmaci ne zaobilaze provjeru", () => {
    expect(jeDostavljiva("  Admin@TEHPRO.LOCAL ")).toBe(false)
  })
  it("poddomen koji samo liči na rezervisani TLD prolazi", () => {
    expect(jeDostavljiva("neko@local.ba")).toBe(true)
    expect(jeDostavljiva("neko@tehpro.localhost.ba")).toBe(true)
  })
  it("obične adrese prolaze", () => {
    expect(jeDostavljiva("nmil32@icloud.com")).toBe(true)
    expect(jeDostavljiva("pregled@nextpixel.dev")).toBe(true)
  })
  it("nevalidan oblik i dalje pada", () => {
    expect(jeDostavljiva("bez-monkeya")).toBe(false)
    expect(jeDostavljiva("")).toBe(false)
  })
})

describe("guard nerutabilnih domena u sastavljanju primalaca", () => {
  it("assembleRecipients izbacuje .local adresu, ostale zadržava", () => {
    const out = assembleRecipients({
      base: [],
      adminEmails: ["nmil32@icloud.com", "admin@tehpro.local", "pregled@nextpixel.dev"],
    })
    expect(out).toEqual(["nmil32@icloud.com", "pregled@nextpixel.dev"])
  })
  it("firmin kanal ne šalje na nerutabilnu adresu kontakta", () => {
    const idx = buildRecipientIndex(
      [],
      [],
      [{ id: "F1", salji_podsjetnik_klijentu: true }],
      [
        { klijent_id: "F1", email: "kontakt@firma.ba", podsjetnik_primalac: true },
        { klijent_id: "F1", email: "sef@firma.local", podsjetnik_primalac: true },
      ],
      true,
    )
    expect(firmaRecipientsZa(idx, "F1", null)).toEqual(["kontakt@firma.ba"])
  })
})

describe("parseEmailList", () => {
  it("razdvaja po zarezu i trim-uje", () => {
    expect(parseEmailList(" a@x.com , b@y.com ")).toEqual(["a@x.com", "b@y.com"])
  })
  it("prazno/undefined → []", () => {
    expect(parseEmailList("")).toEqual([])
    expect(parseEmailList(undefined)).toEqual([])
  })
})

describe("assembleRecipients", () => {
  it("spaja REMINDER_TO bazu + admine, dedupe (case-insensitive), filtrira nevalidne", () => {
    const out = assembleRecipients({
      base: ["tehpro@x.com"],
      adminEmails: ["TEHPRO@x.com", "admin@tehpro.com", "nevalidno"],
    })
    expect(out).toEqual(["tehpro@x.com", "admin@tehpro.com"])
  })
  it("prazno kad nema validnih primalaca", () => {
    expect(assembleRecipients({ base: [], adminEmails: [] })).toEqual([])
    expect(assembleRecipients({ base: [], adminEmails: ["x"] })).toEqual([])
  })
})

const K = (id: string, email: string, uloga: string, extra?: Partial<{ aktivan: boolean; prima_podsjetnike: boolean }>) => ({
  id, email, uloga, aktivan: extra?.aktivan ?? true, prima_podsjetnike: extra?.prima_podsjetnike ?? true,
})

describe("buildRecipientIndex + recipientsForKlijent", () => {
  it("operater dobija svoju firmu, ne tuđu; admin dobija sve firme", () => {
    const idx = buildRecipientIndex(
      [K("a", "admin@x.com", "admin"), K("o1", "op1@x.com", "operater"), K("o2", "op2@x.com", "operater")],
      [{ korisnik_id: "o1", klijent_id: "FA" }, { korisnik_id: "o2", klijent_id: "FB" }],
    )
    expect(recipientsForKlijent(idx, "FA", [])).toEqual(["op1@x.com", "admin@x.com"])
    expect(recipientsForKlijent(idx, "FB", [])).toEqual(["op2@x.com", "admin@x.com"])
  })

  it("prima_podsjetnike=false isključuje (i operatera i admina)", () => {
    const idx = buildRecipientIndex(
      [K("a", "admin@x.com", "admin", { prima_podsjetnike: false }), K("o1", "op1@x.com", "operater", { prima_podsjetnike: false })],
      [{ korisnik_id: "o1", klijent_id: "FA" }],
    )
    expect(recipientsForKlijent(idx, "FA", [])).toEqual([])
  })

  it("neaktivan korisnik se ignoriše", () => {
    const idx = buildRecipientIndex([K("o1", "op1@x.com", "operater", { aktivan: false })], [{ korisnik_id: "o1", klijent_id: "FA" }])
    expect(recipientsForKlijent(idx, "FA", [])).toEqual([])
  })

  it("firma bez dodjele → samo admini; base (REMINDER_TO) se dodaje i dedupira", () => {
    const idx = buildRecipientIndex([K("a", "admin@x.com", "admin")], [])
    expect(recipientsForKlijent(idx, "FX", ["admin@x.com", "bcc@x.com"])).toEqual(["admin@x.com", "bcc@x.com"])
  })

  it("pregled dodijeljen + prima → dobija (flag je kapija, ne uloga)", () => {
    const idx = buildRecipientIndex([K("p", "pregled@x.com", "pregled")], [{ korisnik_id: "p", klijent_id: "FA" }])
    expect(recipientsForKlijent(idx, "FA", [])).toEqual(["pregled@x.com"])
  })
})

describe("razdvajanje kanala (firmine adrese iz kontakata)", () => {
  const kor = [
    { id: "admin1", email: "admin@tehpro.test", uloga: "admin", aktivan: true, prima_podsjetnike: true },
    { id: "op1", email: "radnik@tehpro.test", uloga: "operater", aktivan: true, prima_podsjetnike: true },
  ]
  const dodjele = [{ korisnik_id: "op1", klijent_id: "K1" }]
  const klijenti = [{ id: "K1", salji_podsjetnik_klijentu: true }]
  const kontakti = [{ klijent_id: "K1", email: "firma@drina.ba", podsjetnik_primalac: true }]

  it("interni NE uključuje firmine adrese", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti, kontakti, true)
    const to = recipientsForKlijent(idx, "K1", [])
    expect(to).toContain("radnik@tehpro.test")
    expect(to).toContain("admin@tehpro.test")
    expect(to).not.toContain("firma@drina.ba")
  })
  it("firmaRecipientsZa vraća SAMO mejlove flagovanih kontakata", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti, kontakti, true)
    expect(firmaRecipientsZa(idx, "K1", null)).toEqual(["firma@drina.ba"])
  })
  it("global prekidač isključen → firma prazna", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti, kontakti, false)
    expect(firmaRecipientsZa(idx, "K1", null)).toEqual([])
  })
  it("per-firma flag isključen → firma prazna", () => {
    const idx = buildRecipientIndex(kor, dodjele, [{ id: "K1", salji_podsjetnik_klijentu: false }], kontakti, true)
    expect(firmaRecipientsZa(idx, "K1", null)).toEqual([])
  })
  it("kontakt bez podsjetnik_primalac se ignoriše", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti,
      [{ klijent_id: "K1", email: "firma@drina.ba", podsjetnik_primalac: false }], true)
    expect(firmaRecipientsZa(idx, "K1", null)).toEqual([])
  })
  it("flagovan kontakt bez emaila se ignoriše (nema praznog primaoca)", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti,
      [{ klijent_id: "K1", email: null, podsjetnik_primalac: true }], true)
    expect(firmaRecipientsZa(idx, "K1", null)).toEqual([])
  })
  it("dva flagovana kontakta iste firme → obje adrese", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti, [
      { klijent_id: "K1", email: "a@firma.ba", podsjetnik_primalac: true },
      { klijent_id: "K1", email: "b@firma.ba", podsjetnik_primalac: true },
    ], true)
    expect(firmaRecipientsZa(idx, "K1", null).sort()).toEqual(["a@firma.ba", "b@firma.ba"])
  })
  it("nevalidan mejl kontakta se odbacuje", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti,
      [{ klijent_id: "K1", email: "nijemejl", podsjetnik_primalac: true }], true)
    expect(firmaRecipientsZa(idx, "K1", null)).toEqual([])
  })
  it("podsjetnik_emails (ad-hoc) se dodaju firminom kanalu uz flagovane kontakte", () => {
    const idx = buildRecipientIndex(
      kor, dodjele,
      [{ id: "K1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["adhoc@firma.ba"] }],
      kontakti, // firma@drina.ba (flagovan)
      true,
    )
    expect(firmaRecipientsZa(idx, "K1", null).sort()).toEqual(["adhoc@firma.ba", "firma@drina.ba"])
  })
  it("ad-hoc mejl jednak flagovanom kontaktu → dedup (jednom)", () => {
    const idx = buildRecipientIndex(
      kor, dodjele,
      [{ id: "K1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["FIRMA@drina.ba"] }],
      kontakti,
      true,
    )
    expect(firmaRecipientsZa(idx, "K1", null)).toEqual(["firma@drina.ba"])
  })
  it("global isključen → ni ad-hoc ne ide", () => {
    const idx = buildRecipientIndex(
      kor, dodjele,
      [{ id: "K1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["adhoc@firma.ba"] }],
      [], false,
    )
    expect(firmaRecipientsZa(idx, "K1", null)).toEqual([])
  })
  it("per-firma isključen → ni ad-hoc ne ide", () => {
    const idx = buildRecipientIndex(
      kor, dodjele,
      [{ id: "K1", salji_podsjetnik_klijentu: false, podsjetnik_emails: ["adhoc@firma.ba"] }],
      [], true,
    )
    expect(firmaRecipientsZa(idx, "K1", null)).toEqual([])
  })
  it("nevalidan ad-hoc mejl se odbacuje", () => {
    const idx = buildRecipientIndex(
      kor, dodjele,
      [{ id: "K1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["nijemejl"] }],
      [], true,
    )
    expect(firmaRecipientsZa(idx, "K1", null)).toEqual([])
  })
})

describe("firmaRecipientsZa — podsjetnici po lokaciji", () => {
  const klijenti = [{ id: "K1", salji_podsjetnik_klijentu: true }]
  const kontakti = [
    { klijent_id: "K1", email: "hq@firma.ba", podsjetnik_primalac: true, lokacija_id: null },
    { klijent_id: "K1", email: "lok1@firma.ba", podsjetnik_primalac: true, lokacija_id: "L1" },
    { klijent_id: "K1", email: "lok2@firma.ba", podsjetnik_primalac: true, lokacija_id: "L2" },
  ]
  const idx = buildRecipientIndex([], [], klijenti, kontakti, true)

  // Doslovno prijavljeni problem: kontakt druge lokacije je dobijao tuđe podsjetnike.
  it("kontakt lokacije 2 NE dobija podsjetnik za lokaciju 1", () => {
    expect(firmaRecipientsZa(idx, "K1", "L1")).not.toContain("lok2@firma.ba")
  })

  it("termin na lokaciji ide vezanom kontaktu I kontaktu firme", () => {
    expect(firmaRecipientsZa(idx, "K1", "L1").sort()).toEqual(["hq@firma.ba", "lok1@firma.ba"])
  })

  it("termin bez lokacije ide samo kontaktima firme", () => {
    expect(firmaRecipientsZa(idx, "K1", null)).toEqual(["hq@firma.ba"])
  })

  it("lokacija bez vezanih kontakata pada na kontakte firme", () => {
    expect(firmaRecipientsZa(idx, "K1", "L9")).toEqual(["hq@firma.ba"])
  })

  it("isključen podsjetnik_primalac isključuje kontakt bez obzira na lokaciju", () => {
    const i2 = buildRecipientIndex([], [], klijenti, [
      { klijent_id: "K1", email: "lok1@firma.ba", podsjetnik_primalac: false, lokacija_id: "L1" },
    ], true)
    expect(firmaRecipientsZa(i2, "K1", "L1")).toEqual([])
  })

  it("ad-hoc adrese firme stižu i za lokacijski termin", () => {
    const i3 = buildRecipientIndex([], [],
      [{ id: "K1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["adhoc@firma.ba"] }],
      kontakti, true)
    expect(firmaRecipientsZa(i3, "K1", "L1")).toContain("adhoc@firma.ba")
  })
})
