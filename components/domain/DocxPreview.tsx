export function DocxPreview({ html }: { html: string }) {
  return (
    <div
      data-testid="docx-preview"
      className="prose prose-sm max-w-none rounded-xl border border-border bg-card p-6"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
