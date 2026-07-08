import { env } from "@/lib/env"

export type FirmBrand = {
  name: string
  tagline: string
  email?: string
  phone?: string
  web?: string
}

/** Firmin (klijentski) brend iz env-a; nezavisno od APP_NAME. */
export function firmBrand(): FirmBrand {
  return {
    name: env.FIRM_BRAND_NAME,
    tagline: env.FIRM_BRAND_TAGLINE,
    email: env.FIRM_CONTACT_EMAIL,
    phone: env.FIRM_CONTACT_PHONE,
    web: env.FIRM_CONTACT_WEB,
  }
}
