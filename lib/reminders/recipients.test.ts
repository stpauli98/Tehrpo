import { describe, it, expect } from "vitest"
import { parseEmailList, assembleRecipients, buildRecipientIndex, recipientsForKlijent, firmaRecipientsForKlijent } from "./recipients"

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
  it("firmaRecipientsForKlijent vraća SAMO mejlove flagovanih kontakata", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti, kontakti, true)
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual(["firma@drina.ba"])
  })
  it("global prekidač isključen → firma prazna", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti, kontakti, false)
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual([])
  })
  it("per-firma flag isključen → firma prazna", () => {
    const idx = buildRecipientIndex(kor, dodjele, [{ id: "K1", salji_podsjetnik_klijentu: false }], kontakti, true)
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual([])
  })
  it("kontakt bez podsjetnik_primalac se ignoriše", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti,
      [{ klijent_id: "K1", email: "firma@drina.ba", podsjetnik_primalac: false }], true)
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual([])
  })
  it("flagovan kontakt bez emaila se ignoriše (nema praznog primaoca)", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti,
      [{ klijent_id: "K1", email: null, podsjetnik_primalac: true }], true)
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual([])
  })
  it("dva flagovana kontakta iste firme → obje adrese", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti, [
      { klijent_id: "K1", email: "a@firma.ba", podsjetnik_primalac: true },
      { klijent_id: "K1", email: "b@firma.ba", podsjetnik_primalac: true },
    ], true)
    expect(firmaRecipientsForKlijent(idx, "K1").sort()).toEqual(["a@firma.ba", "b@firma.ba"])
  })
  it("nevalidan mejl kontakta se odbacuje", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti,
      [{ klijent_id: "K1", email: "nijemejl", podsjetnik_primalac: true }], true)
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual([])
  })
  it("podsjetnik_emails (ad-hoc) se dodaju firminom kanalu uz flagovane kontakte", () => {
    const idx = buildRecipientIndex(
      kor, dodjele,
      [{ id: "K1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["adhoc@firma.ba"] }],
      kontakti, // firma@drina.ba (flagovan)
      true,
    )
    expect(firmaRecipientsForKlijent(idx, "K1").sort()).toEqual(["adhoc@firma.ba", "firma@drina.ba"])
  })
  it("ad-hoc mejl jednak flagovanom kontaktu → dedup (jednom)", () => {
    const idx = buildRecipientIndex(
      kor, dodjele,
      [{ id: "K1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["FIRMA@drina.ba"] }],
      kontakti,
      true,
    )
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual(["firma@drina.ba"])
  })
  it("global isključen → ni ad-hoc ne ide", () => {
    const idx = buildRecipientIndex(
      kor, dodjele,
      [{ id: "K1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["adhoc@firma.ba"] }],
      [], false,
    )
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual([])
  })
  it("per-firma isključen → ni ad-hoc ne ide", () => {
    const idx = buildRecipientIndex(
      kor, dodjele,
      [{ id: "K1", salji_podsjetnik_klijentu: false, podsjetnik_emails: ["adhoc@firma.ba"] }],
      [], true,
    )
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual([])
  })
  it("nevalidan ad-hoc mejl se odbacuje", () => {
    const idx = buildRecipientIndex(
      kor, dodjele,
      [{ id: "K1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["nijemejl"] }],
      [], true,
    )
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual([])
  })
})
