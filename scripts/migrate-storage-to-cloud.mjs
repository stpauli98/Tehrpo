// One-off: kopira fajlove iz lokalnog Supabase storage bucketa na cloud.
// Putanje se prosljeđuju kao argumenti; isti path se zadržava (upsert).
// Env: LOCAL_URL, LOCAL_KEY, CLOUD_URL, CLOUD_KEY, BUCKET
import { createClient } from "@supabase/supabase-js"

const { LOCAL_URL, LOCAL_KEY, CLOUD_URL, CLOUD_KEY, BUCKET } = process.env
const paths = process.argv.slice(2)

if (!LOCAL_URL || !LOCAL_KEY || !CLOUD_URL || !CLOUD_KEY || !BUCKET) {
  console.error("Nedostaju env varijable (LOCAL_URL/LOCAL_KEY/CLOUD_URL/CLOUD_KEY/BUCKET)")
  process.exit(1)
}
if (paths.length === 0) {
  console.error("Nema putanja u argumentima")
  process.exit(1)
}

const local = createClient(LOCAL_URL, LOCAL_KEY, { auth: { persistSession: false } })
const cloud = createClient(CLOUD_URL, CLOUD_KEY, { auth: { persistSession: false } })

let ok = 0
let fail = 0
for (const path of paths) {
  const { data, error } = await local.storage.from(BUCKET).download(path)
  if (error || !data) {
    console.error(`DL FAIL  ${path}: ${error?.message ?? "nema podataka"}`)
    fail++
    continue
  }
  const buf = Buffer.from(await data.arrayBuffer())
  const contentType = data.type || "application/octet-stream"
  const { error: upErr } = await cloud.storage
    .from(BUCKET)
    .upload(path, buf, { contentType, upsert: true })
  if (upErr) {
    console.error(`UP FAIL  ${path}: ${upErr.message}`)
    fail++
    continue
  }
  console.log(`OK       ${path} (${buf.length}b, ${contentType})`)
  ok++
}
console.log(`DONE ok=${ok} fail=${fail}`)
process.exit(fail ? 1 : 0)
