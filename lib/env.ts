import { z } from "zod"

const optionalSecret = z
  .string()
  .min(1)
  .optional()
  .or(z.literal("").transform(() => undefined))

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  RESEND_API_KEY: optionalSecret,
  EMAIL_FROM: optionalSecret,
  REMINDER_TO: z.string().optional(),
  CRON_SECRET: optionalSecret,
  ANTHROPIC_API_KEY: optionalSecret,
  ZAPISNIK_DRY_RUN: z.string().optional(),
  CHAT_DRY_RUN: z.string().optional(),
  // Podsjetnici — throttling (string-brojevi; default u kodu). Podigni kad nadogradiš Resend.
  REMINDER_MAX_PER_RUN: z.string().optional(),
  REMINDER_BATCH_SIZE: z.string().optional(),
  REMINDER_BATCH_DELAY_MS: z.string().optional(),
  // Firmin (klijentski) email brend — nezavisno od NEXT_PUBLIC_APP_NAME.
  FIRM_BRAND_NAME: z.string().min(1).default("TEHPRO"),
  FIRM_BRAND_TAGLINE: z.string().min(1).default("Zaštita na radu i zaštita od požara"),
  FIRM_CONTACT_EMAIL: optionalSecret,
  FIRM_CONTACT_PHONE: optionalSecret,
  FIRM_CONTACT_WEB: optionalSecret,
})

const parsed = envSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  REMINDER_TO: process.env.REMINDER_TO,
  CRON_SECRET: process.env.CRON_SECRET,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ZAPISNIK_DRY_RUN: process.env.ZAPISNIK_DRY_RUN,
  CHAT_DRY_RUN: process.env.CHAT_DRY_RUN,
  REMINDER_MAX_PER_RUN: process.env.REMINDER_MAX_PER_RUN,
  REMINDER_BATCH_SIZE: process.env.REMINDER_BATCH_SIZE,
  REMINDER_BATCH_DELAY_MS: process.env.REMINDER_BATCH_DELAY_MS,
  FIRM_BRAND_NAME: process.env.FIRM_BRAND_NAME,
  FIRM_BRAND_TAGLINE: process.env.FIRM_BRAND_TAGLINE,
  FIRM_CONTACT_EMAIL: process.env.FIRM_CONTACT_EMAIL,
  FIRM_CONTACT_PHONE: process.env.FIRM_CONTACT_PHONE,
  FIRM_CONTACT_WEB: process.env.FIRM_CONTACT_WEB,
})

if (!parsed.success) {
  console.error("❌ Invalid env vars:", parsed.error.flatten().fieldErrors)
  throw new Error("Invalid env vars — vidi .env.local.example")
}

export const env = parsed.data
