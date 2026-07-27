// Tipografija mammoth izlaza. `prose prose-sm` je bilo mrtvo — plugin
// @tailwindcss/typography nije u zavisnostima — pa hijerarhiju daju
// arbitrary-variant klase (minimalni set za h1/h2/p/ul/ol/table/strong).
const TIPOGRAFIJA =
  "text-sm leading-relaxed [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mb-3 " +
  "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_p]:my-2 " +
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_table]:my-3 [&_table]:w-full [&_td]:py-1 [&_strong]:font-semibold"

export function DocxPreview({ html }: { html: string }) {
  return (
    <div
      data-testid="docx-preview"
      className={`${TIPOGRAFIJA} max-w-none rounded-xl bg-card p-6 ring-1 ring-foreground/10`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
