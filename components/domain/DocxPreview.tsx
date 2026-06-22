export function DocxPreview({ html }: { html: string }) {
  return (
    <div
      data-testid="docx-preview"
      className="prose prose-sm max-w-none rounded-xl border border-slate-200 bg-white p-6"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
