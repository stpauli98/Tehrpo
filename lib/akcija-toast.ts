export type AkcijaRezultat =
  | { ok: true }
  | { ok: false; message?: string; errors?: Record<string, string[] | undefined> }

export type ToastOdluka = { tip: "success" | "error"; poruka: string } | null

/**
 * Odlučuje koji toast (ako ijedan) prikazati za rezultat mutacione akcije.
 * Field-level greške (`errors`) se NE toastaju — prikazuju se inline pod poljima.
 */
export function odlukaToast(
  res: AkcijaRezultat,
  uspjeh: string,
  greskaFallback: string,
): ToastOdluka {
  if (res.ok) return { tip: "success", poruka: uspjeh }
  if (res.message) return { tip: "error", poruka: res.message }
  if (res.errors && Object.keys(res.errors).length > 0) return null
  return { tip: "error", poruka: greskaFallback }
}
