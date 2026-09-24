/**
 * Ime storage bucketa za dokumente — JEDNA kopija.
 *
 * Ranije je isti literal stajao u `lib/supabase/storage.ts` i `lib/dokumenti/popis.ts`;
 * pošto oba hrane iste putanje (upload/potpis vs. GC popis), razlika u imenu bucketa
 * značila bi da GC gleda u prazan bucket dok upload puni drugi.
 *
 * Vrijednost dolazi iz `DOKUMENTI_BUCKET` env-a (vidi `lib/env.ts`) jer bucket ime
 * curi u korisnički vidljiv potpisani URL i zato ne smije biti brend u kodu.
 */
import { env } from "@/lib/env"

export const DOKUMENTI_BUCKET = env.DOKUMENTI_BUCKET
