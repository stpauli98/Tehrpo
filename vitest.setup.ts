// Dummy Supabase env da `lib/env.ts` (zod) ne baci pri importu test modula koji povlače runReminders.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost:54321"
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key"
