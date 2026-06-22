import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { signedUrl } from "@/lib/supabase/storage"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: dok } = await supabase
    .from("dokumenti")
    .select("storage_path, naziv")
    .eq("id", id)
    .maybeSingle()
  if (!dok) return NextResponse.json({ error: "Dokument ne postoji" }, { status: 404 })

  const url = await signedUrl(dok.storage_path, { downloadName: dok.naziv })
  return NextResponse.redirect(url)
}
