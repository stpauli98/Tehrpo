/**
 * Standardni prikaz field-grešaka iz `ActionResult.errors` (S2).
 *
 * **Id ugovor:** komponenta renderuje kontejner sa proslijeđenim `id`, a forma
 * stavlja `aria-describedby={id}` na input **samo kad errors postoji**, npr:
 *
 * ```tsx
 * <Input id="ugovor-broj" aria-describedby={state.errors?.broj ? "greska-ugovor-broj" : undefined} … />
 * <FieldError id="greska-ugovor-broj" errors={state.errors?.broj} />
 * ```
 *
 * Više poruka = svaka u svojoj liniji unutar istog kontejnera (jedan `id`).
 * Bez i18n — poruke stižu već prevedene iz `ActionResult.errors` (Zod/server).
 */
export function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors || errors.length === 0) return null
  return (
    <div id={id} role="alert" className="text-destructive text-xs">
      {errors.map((poruka) => (
        <p key={poruka}>{poruka}</p>
      ))}
    </div>
  )
}
