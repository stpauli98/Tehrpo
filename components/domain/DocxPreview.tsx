export function DocxPreview({ html }: { html: string }) {
  return (
    <div
      data-testid="docx-preview"
      className="prose prose-sm max-w-none rounded-xl bg-card p-6 ring-1 ring-foreground/10"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
