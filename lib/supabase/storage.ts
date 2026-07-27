import "server-only"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

export const DOKUMENTI_BUCKET = "tehpro-dokumenti"

// Upload limiti (`ALLOWED_MIME`, `MAX_BYTES`, `ACCEPT_ATTR`) žive u client-safe
// `lib/dokumenti.ts` — ovaj modul je `server-only` pa ih forme nisu mogle dijeliti (S8.5).

/** Upload (upsert) u privatni bucket. */
export async function uploadDokument(
  path: string,
  body: Buffer | Uint8Array | ArrayBuffer,
  contentType: string,
): Promise<void> {
  const supabase = createAdminSupabaseClient()
  const { error } = await supabase.storage
    .from(DOKUMENTI_BUCKET)
    .upload(path, body, { contentType, upsert: true })
  if (error) throw new Error(`Upload nije uspio: ${error.message}`)
}

/** Skida fajl kao Node Buffer (za mammoth preview). */
export async function downloadDokument(path: string): Promise<Buffer> {
  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase.storage.from(DOKUMENTI_BUCKET).download(path)
  if (error || !data) throw new Error(`Download nije uspio: ${error?.message ?? "nema podataka"}`)
  return Buffer.from(await data.arrayBuffer())
}

/** Kratkotrajni potpisani URL; downloadName forsira preuzimanje sa tim imenom. */
export async function signedUrl(
  path: string,
  opts?: { downloadName?: string },
): Promise<string> {
  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase.storage
    .from(DOKUMENTI_BUCKET)
    .createSignedUrl(path, 60, opts?.downloadName ? { download: opts.downloadName } : undefined)
  if (error || !data) throw new Error(`Signed URL nije uspio: ${error?.message ?? "nema URL-a"}`)
  return data.signedUrl
}

/** App-level cleanup — briše fajl iz bucket-a. */
export async function removeDokument(path: string): Promise<void> {
  const supabase = createAdminSupabaseClient()
  const { error } = await supabase.storage.from(DOKUMENTI_BUCKET).remove([path])
  if (error) throw new Error(`Brisanje fajla nije uspio: ${error.message}`)
}
