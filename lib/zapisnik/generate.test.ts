/**
 * N11 — `generateZapisnik` ne smije šablonski (mock) sadržaj prijaviti kao model-generisan.
 *
 * Prije popravke: kod pada parsiranja funkcija je vraćala `dryGenerateZapisnik(...)`
 * sa `dryRun: false` — jedini signal o porijeklu teksta je lagao, a pozivaoci su
 * taj šablon snimali kao pravi zapisnik (`generated_by_ai: true`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const create = vi.fn()

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- SDK konstruktor prima opcije koje mock ignoriše
    constructor(_o: unknown) {}
  },
}))

const ULAZ = {
  klijent: "AUDIT DOO",
  lokacija: "Skladište 1",
  vrstaProvjere: "Pregled aparata za gašenje požara",
  datum: "2026-07-15",
  zaduzeni: "Marko Marković",
}

const MODEL_NALAZ = "Pregledano je 12 aparata za gašenje požara, svi ispravni."
const MODEL_ZAKLJUCAK = "Stanje zadovoljava. Naredni servis u zakonskom roku."

beforeEach(() => {
  vi.resetModules()
  create.mockReset()
  vi.unstubAllEnvs()
})

async function ucitaj() {
  const { generateZapisnik, ZapisnikGeneracijaGreska } = await import("./generate")
  const { dryGenerateZapisnik } = await import("./content")
  return { generateZapisnik, ZapisnikGeneracijaGreska, dryGenerateZapisnik }
}

describe("generateZapisnik — pošten izvor sadržaja", () => {
  it("dry-run (bez ANTHROPIC_API_KEY): izvor='sablon', model nije pozvan, napomena je u tekstu", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "")
    vi.stubEnv("ZAPISNIK_DRY_RUN", "")
    const { generateZapisnik } = await ucitaj()

    const c = await generateZapisnik(ULAZ)
    expect(create).not.toHaveBeenCalled()
    expect(c.izvor).toBe("sablon")
    expect(c.dryRun).toBe(true)
    expect(c.nalaz).toContain("šablonski nacrt")
  })

  it("ZAPISNIK_DRY_RUN=1 uz postojeći ključ i dalje radi offline (izvor='sablon')", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-lazni")
    vi.stubEnv("ZAPISNIK_DRY_RUN", "1")
    const { generateZapisnik } = await ucitaj()

    const c = await generateZapisnik(ULAZ)
    expect(create).not.toHaveBeenCalled()
    expect(c.izvor).toBe("sablon")
    expect(c.dryRun).toBe(true)
  })

  it("čist JSON od modela: izvor='model', tekst je modelov", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-lazni")
    vi.stubEnv("ZAPISNIK_DRY_RUN", "")
    create.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ nalaz: MODEL_NALAZ, zakljucak: MODEL_ZAKLJUCAK }) }],
    })
    const { generateZapisnik } = await ucitaj()

    const c = await generateZapisnik(ULAZ)
    expect(c).toEqual({ nalaz: MODEL_NALAZ, zakljucak: MODEL_ZAKLJUCAK, izvor: "model", dryRun: false })
  })

  it("OPORAVAK: ```json ograde se skidaju umjesto pada na šablon", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-lazni")
    vi.stubEnv("ZAPISNIK_DRY_RUN", "")
    create.mockResolvedValue({
      content: [
        {
          type: "text",
          text: "```json\n" + JSON.stringify({ nalaz: MODEL_NALAZ, zakljucak: MODEL_ZAKLJUCAK }) + "\n```",
        },
      ],
    })
    const { generateZapisnik, dryGenerateZapisnik } = await ucitaj()

    const c = await generateZapisnik(ULAZ)
    expect(c.nalaz).toBe(MODEL_NALAZ)
    expect(c.nalaz).not.toBe(dryGenerateZapisnik(ULAZ).nalaz)
    expect(c.izvor).toBe("model")
  })

  it("OPORAVAK: brbljanje oko JSON bloka — izvuče se prvi {...} blok", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-lazni")
    vi.stubEnv("ZAPISNIK_DRY_RUN", "")
    create.mockResolvedValue({
      content: [
        {
          type: "text",
          text:
            "Naravno! Evo zapisnika:\n" +
            JSON.stringify({ nalaz: MODEL_NALAZ, zakljucak: MODEL_ZAKLJUCAK }) +
            "\nAko treba dopuna, javi.",
        },
      ],
    })
    const { generateZapisnik } = await ucitaj()

    const c = await generateZapisnik(ULAZ)
    expect(c.nalaz).toBe(MODEL_NALAZ)
    expect(c.zakljucak).toBe(MODEL_ZAKLJUCAK)
    expect(c.izvor).toBe("model")
  })

  it("ODUSTAJANJE: odsječen odgovor (max_tokens) baca grešku — ne vraća šablon", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-lazni")
    vi.stubEnv("ZAPISNIK_DRY_RUN", "")
    create.mockResolvedValue({
      stop_reason: "max_tokens",
      content: [{ type: "text", text: '{"nalaz": "Izvršen je detaljan pregled hidrantske mre' }],
    })
    const { generateZapisnik, ZapisnikGeneracijaGreska } = await ucitaj()

    await expect(generateZapisnik(ULAZ)).rejects.toBeInstanceOf(ZapisnikGeneracijaGreska)
  })

  it("ODUSTAJANJE: validan JSON bez 'zakljucak' baca grešku — ne vraća šablon", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-lazni")
    vi.stubEnv("ZAPISNIK_DRY_RUN", "")
    create.mockResolvedValue({
      content: [{ type: "text", text: '{"nalaz": "Pravi nalaz koji je model napisao."}' }],
    })
    const { generateZapisnik, ZapisnikGeneracijaGreska } = await ucitaj()

    await expect(generateZapisnik(ULAZ)).rejects.toBeInstanceOf(ZapisnikGeneracijaGreska)
  })

  it("ODUSTAJANJE: prazan odgovor modela baca grešku", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-lazni")
    vi.stubEnv("ZAPISNIK_DRY_RUN", "")
    create.mockResolvedValue({ content: [] })
    const { generateZapisnik, ZapisnikGeneracijaGreska } = await ucitaj()

    await expect(generateZapisnik(ULAZ)).rejects.toBeInstanceOf(ZapisnikGeneracijaGreska)
  })

  it("`dryRun` je izveden iz `izvor` — nikad ga ne postavlja pozivalac", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-lazni")
    vi.stubEnv("ZAPISNIK_DRY_RUN", "")
    create.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ nalaz: MODEL_NALAZ, zakljucak: MODEL_ZAKLJUCAK }) }],
    })
    const { generateZapisnik, dryGenerateZapisnik } = await ucitaj()

    const model = await generateZapisnik(ULAZ)
    const sablon = dryGenerateZapisnik(ULAZ)
    for (const c of [model, sablon]) {
      expect(c.dryRun).toBe(c.izvor === "sablon")
    }
    // Nijedna grana ne smije proizvesti šablonski tekst sa izvor: "model"
    expect(model.nalaz).not.toBe(sablon.nalaz)
  })

  it("napomena preživi do .docx-a i kad pozivalac proslijedi samo nalaz/zakljucak", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "")
    vi.stubEnv("ZAPISNIK_DRY_RUN", "")
    const { generateZapisnik } = await ucitaj()
    const { buildZapisnikDocx } = await import("./template")
    const mammoth = (await import("mammoth")).default

    const c = await generateZapisnik(ULAZ)
    // Isti poziv kao app/(dashboard)/dokumenti/actions.ts — BEZ prosljeđivanja `izvor`.
    const docx = await buildZapisnikDocx({ ...ULAZ, nalaz: c.nalaz, zakljucak: c.zakljucak })
    const { value: html } = await mammoth.convertToHtml({ buffer: docx })
    expect(html).toContain("šablonski nacrt")
    expect(html).toContain("nije ga generisao AI model")

    // A kad pozivalac PROSLIJEDI izvor, napomena se ne duplira.
    const docx2 = await buildZapisnikDocx({ ...ULAZ, nalaz: c.nalaz, zakljucak: c.zakljucak, izvor: c.izvor })
    const { value: html2 } = await mammoth.convertToHtml({ buffer: docx2 })
    expect(html2.split("šablonski nacrt").length - 1).toBe(1)

    // Model-generisan sadržaj NE dobija napomenu.
    const docx3 = await buildZapisnikDocx({ ...ULAZ, nalaz: MODEL_NALAZ, zakljucak: MODEL_ZAKLJUCAK, izvor: "model" })
    const { value: html3 } = await mammoth.convertToHtml({ buffer: docx3 })
    expect(html3).not.toContain("šablonski nacrt")
  })
})
