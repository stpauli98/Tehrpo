export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          akcija: string
          detalji: Json | null
          entitet: string
          entitet_id: string | null
          id: number
          korisnik_id: string | null
          novo: Json | null
          staro: Json | null
          vrijeme: string
        }
        Insert: {
          akcija: string
          detalji?: Json | null
          entitet: string
          entitet_id?: string | null
          id?: never
          korisnik_id?: string | null
          novo?: Json | null
          staro?: Json | null
          vrijeme?: string
        }
        Update: {
          akcija?: string
          detalji?: Json | null
          entitet?: string
          entitet_id?: string | null
          id?: never
          korisnik_id?: string | null
          novo?: Json | null
          staro?: Json | null
          vrijeme?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_korisnik_id_fkey"
            columns: ["korisnik_id"]
            isOneToOne: false
            referencedRelation: "korisnici"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_poruke: {
        Row: {
          alat_pozivi: Json | null
          created_at: string
          id: string
          konverzacija_id: string
          korisnik_id: string
          sadrzaj: string
          uloga: Database["public"]["Enums"]["chat_uloga"]
        }
        Insert: {
          alat_pozivi?: Json | null
          created_at?: string
          id?: string
          konverzacija_id: string
          korisnik_id?: string
          sadrzaj: string
          uloga: Database["public"]["Enums"]["chat_uloga"]
        }
        Update: {
          alat_pozivi?: Json | null
          created_at?: string
          id?: string
          konverzacija_id?: string
          korisnik_id?: string
          sadrzaj?: string
          uloga?: Database["public"]["Enums"]["chat_uloga"]
        }
        Relationships: [
          {
            foreignKeyName: "chat_poruke_korisnik_id_fkey"
            columns: ["korisnik_id"]
            isOneToOne: false
            referencedRelation: "korisnici"
            referencedColumns: ["id"]
          },
        ]
      }
      dokumenti: {
        Row: {
          generated_by_ai: boolean
          id: string
          klijent_id: string
          mime_type: string | null
          naziv: string
          storage_path: string
          termin_id: string | null
          tip: string
          ugovor_id: string | null
          uploaded_at: string
          velicina_bajt: number | null
        }
        Insert: {
          generated_by_ai?: boolean
          id?: string
          klijent_id: string
          mime_type?: string | null
          naziv: string
          storage_path: string
          termin_id?: string | null
          tip?: string
          ugovor_id?: string | null
          uploaded_at?: string
          velicina_bajt?: number | null
        }
        Update: {
          generated_by_ai?: boolean
          id?: string
          klijent_id?: string
          mime_type?: string | null
          naziv?: string
          storage_path?: string
          termin_id?: string | null
          tip?: string
          ugovor_id?: string | null
          uploaded_at?: string
          velicina_bajt?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dokumenti_klijent_id_fkey"
            columns: ["klijent_id"]
            isOneToOne: false
            referencedRelation: "klijenti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dokumenti_klijent_id_fkey"
            columns: ["klijent_id"]
            isOneToOne: false
            referencedRelation: "klijenti_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dokumenti_termin_id_fkey"
            columns: ["termin_id"]
            isOneToOne: false
            referencedRelation: "termini"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dokumenti_termin_id_fkey"
            columns: ["termin_id"]
            isOneToOne: false
            referencedRelation: "termini_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dokumenti_ugovor_id_fkey"
            columns: ["ugovor_id"]
            isOneToOne: false
            referencedRelation: "ugovori"
            referencedColumns: ["id"]
          },
        ]
      }
      klijent_provjere: {
        Row: {
          aktivan: boolean
          created_at: string
          id: string
          interval_mjeseci: number | null
          klijent_id: string
          lokacija_id: string
          nacin_izvrsenja: Database["public"]["Enums"]["nacin_izvrsenja_tip"]
          ugovor_id: string | null
          vrsta_provjere_id: string
          zadnji_datum: string | null
        }
        Insert: {
          aktivan?: boolean
          created_at?: string
          id?: string
          interval_mjeseci?: number | null
          klijent_id: string
          lokacija_id: string
          nacin_izvrsenja?: Database["public"]["Enums"]["nacin_izvrsenja_tip"]
          ugovor_id?: string | null
          vrsta_provjere_id: string
          zadnji_datum?: string | null
        }
        Update: {
          aktivan?: boolean
          created_at?: string
          id?: string
          interval_mjeseci?: number | null
          klijent_id?: string
          lokacija_id?: string
          nacin_izvrsenja?: Database["public"]["Enums"]["nacin_izvrsenja_tip"]
          ugovor_id?: string | null
          vrsta_provjere_id?: string
          zadnji_datum?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "klijent_provjere_klijent_id_fkey"
            columns: ["klijent_id"]
            isOneToOne: false
            referencedRelation: "klijenti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "klijent_provjere_klijent_id_fkey"
            columns: ["klijent_id"]
            isOneToOne: false
            referencedRelation: "klijenti_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "klijent_provjere_lokacija_id_fkey"
            columns: ["lokacija_id"]
            isOneToOne: false
            referencedRelation: "lokacije"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "klijent_provjere_ugovor_id_fkey"
            columns: ["ugovor_id"]
            isOneToOne: false
            referencedRelation: "ugovori"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "klijent_provjere_vrsta_provjere_id_fkey"
            columns: ["vrsta_provjere_id"]
            isOneToOne: false
            referencedRelation: "vrste_provjera"
            referencedColumns: ["id"]
          },
        ]
      }
      klijenti: {
        Row: {
          adresa: string | null
          created_at: string
          email: string | null
          id: string
          maticni_broj: string | null
          napomena: string | null
          naziv: string
          pib: string | null
          podsjetnik_emails: string[]
          salji_podsjetnik_klijentu: boolean
          sifra_djelatnosti: string | null
          telefon: string | null
          tip_odnosa: string | null
          updated_at: string
          zaduzeni_tehpro_id: string | null
        }
        Insert: {
          adresa?: string | null
          created_at?: string
          email?: string | null
          id?: string
          maticni_broj?: string | null
          napomena?: string | null
          naziv: string
          pib?: string | null
          podsjetnik_emails?: string[]
          salji_podsjetnik_klijentu?: boolean
          sifra_djelatnosti?: string | null
          telefon?: string | null
          tip_odnosa?: string | null
          updated_at?: string
          zaduzeni_tehpro_id?: string | null
        }
        Update: {
          adresa?: string | null
          created_at?: string
          email?: string | null
          id?: string
          maticni_broj?: string | null
          napomena?: string | null
          naziv?: string
          pib?: string | null
          podsjetnik_emails?: string[]
          salji_podsjetnik_klijentu?: boolean
          sifra_djelatnosti?: string | null
          telefon?: string | null
          tip_odnosa?: string | null
          updated_at?: string
          zaduzeni_tehpro_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "klijenti_zaduzeni_tehpro_id_fkey"
            columns: ["zaduzeni_tehpro_id"]
            isOneToOne: false
            referencedRelation: "korisnici"
            referencedColumns: ["id"]
          },
        ]
      }
      kontakt_osobe: {
        Row: {
          created_at: string
          email: string | null
          funkcija: string | null
          id: string
          ime: string
          klijent_id: string
          podsjetnik_primalac: boolean
          telefon: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          funkcija?: string | null
          id?: string
          ime: string
          klijent_id: string
          podsjetnik_primalac?: boolean
          telefon?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          funkcija?: string | null
          id?: string
          ime?: string
          klijent_id?: string
          podsjetnik_primalac?: boolean
          telefon?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kontakt_osobe_klijent_id_fkey"
            columns: ["klijent_id"]
            isOneToOne: false
            referencedRelation: "klijenti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kontakt_osobe_klijent_id_fkey"
            columns: ["klijent_id"]
            isOneToOne: false
            referencedRelation: "klijenti_view"
            referencedColumns: ["id"]
          },
        ]
      }
      korisnici: {
        Row: {
          aktivan: boolean
          created_at: string
          email: string
          id: string
          ime: string
          prima_podsjetnike: boolean
          uloga: Database["public"]["Enums"]["korisnik_uloga"]
        }
        Insert: {
          aktivan?: boolean
          created_at?: string
          email: string
          id: string
          ime: string
          prima_podsjetnike?: boolean
          uloga?: Database["public"]["Enums"]["korisnik_uloga"]
        }
        Update: {
          aktivan?: boolean
          created_at?: string
          email?: string
          id?: string
          ime?: string
          prima_podsjetnike?: boolean
          uloga?: Database["public"]["Enums"]["korisnik_uloga"]
        }
        Relationships: []
      }
      korisnik_klijent: {
        Row: {
          klijent_id: string
          korisnik_id: string
        }
        Insert: {
          klijent_id: string
          korisnik_id: string
        }
        Update: {
          klijent_id?: string
          korisnik_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "korisnik_klijent_klijent_id_fkey"
            columns: ["klijent_id"]
            isOneToOne: false
            referencedRelation: "klijenti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "korisnik_klijent_klijent_id_fkey"
            columns: ["klijent_id"]
            isOneToOne: false
            referencedRelation: "klijenti_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "korisnik_klijent_korisnik_id_fkey"
            columns: ["korisnik_id"]
            isOneToOne: false
            referencedRelation: "korisnici"
            referencedColumns: ["id"]
          },
        ]
      }
      lokacije: {
        Row: {
          adresa: string | null
          created_at: string
          grad: string | null
          id: string
          klijent_id: string
          kontakt_email: string | null
          kontakt_osoba: string | null
          kontakt_telefon: string | null
          naziv: string
          regija: string | null
        }
        Insert: {
          adresa?: string | null
          created_at?: string
          grad?: string | null
          id?: string
          klijent_id: string
          kontakt_email?: string | null
          kontakt_osoba?: string | null
          kontakt_telefon?: string | null
          naziv: string
          regija?: string | null
        }
        Update: {
          adresa?: string | null
          created_at?: string
          grad?: string | null
          id?: string
          klijent_id?: string
          kontakt_email?: string | null
          kontakt_osoba?: string | null
          kontakt_telefon?: string | null
          naziv?: string
          regija?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lokacije_klijent_id_fkey"
            columns: ["klijent_id"]
            isOneToOne: false
            referencedRelation: "klijenti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lokacije_klijent_id_fkey"
            columns: ["klijent_id"]
            isOneToOne: false
            referencedRelation: "klijenti_view"
            referencedColumns: ["id"]
          },
        ]
      }
      podsjetnici: {
        Row: {
          dana_prije: number
          id: string
          kanal: string
          poslat_at: string
          poslat_na: string[]
          resend_id: string | null
          termin_id: string
        }
        Insert: {
          dana_prije: number
          id?: string
          kanal?: string
          poslat_at?: string
          poslat_na: string[]
          resend_id?: string | null
          termin_id: string
        }
        Update: {
          dana_prije?: number
          id?: string
          kanal?: string
          poslat_at?: string
          poslat_na?: string[]
          resend_id?: string | null
          termin_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "podsjetnici_termin_id_fkey"
            columns: ["termin_id"]
            isOneToOne: false
            referencedRelation: "termini"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podsjetnici_termin_id_fkey"
            columns: ["termin_id"]
            isOneToOne: false
            referencedRelation: "termini_view"
            referencedColumns: ["id"]
          },
        ]
      }
      postavke: {
        Row: {
          dana_prije: number[]
          id: number
          podsjetnici_aktivni: boolean
          salji_klijentima: boolean
          updated_at: string
          vrijeme_slanja_sat: number
          zadnje_slanje_datum: string | null
          zakazano_obavijest_aktivna: boolean
        }
        Insert: {
          dana_prije?: number[]
          id?: number
          podsjetnici_aktivni?: boolean
          salji_klijentima?: boolean
          updated_at?: string
          vrijeme_slanja_sat?: number
          zadnje_slanje_datum?: string | null
          zakazano_obavijest_aktivna?: boolean
        }
        Update: {
          dana_prije?: number[]
          id?: number
          podsjetnici_aktivni?: boolean
          salji_klijentima?: boolean
          updated_at?: string
          vrijeme_slanja_sat?: number
          zadnje_slanje_datum?: string | null
          zakazano_obavijest_aktivna?: boolean
        }
        Relationships: []
      }
      termin_zakazano_obavijest: {
        Row: {
          created_at: string
          datum_zakazan: string
          id: string
          poslat_na: string[]
          termin_id: string
        }
        Insert: {
          created_at?: string
          datum_zakazan: string
          id?: string
          poslat_na?: string[]
          termin_id: string
        }
        Update: {
          created_at?: string
          datum_zakazan?: string
          id?: string
          poslat_na?: string[]
          termin_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "termin_zakazano_obavijest_termin_id_fkey"
            columns: ["termin_id"]
            isOneToOne: false
            referencedRelation: "termini"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "termin_zakazano_obavijest_termin_id_fkey"
            columns: ["termin_id"]
            isOneToOne: false
            referencedRelation: "termini_view"
            referencedColumns: ["id"]
          },
        ]
      }
      termini: {
        Row: {
          created_at: string
          datum_izvrsenja: string | null
          datum_zadnjeg: string | null
          datum_zakazan: string | null
          id: string
          interval_mjeseci: number | null
          klijent_id: string
          lokacija_id: string | null
          nacin_izvrsenja: Database["public"]["Enums"]["nacin_izvrsenja_tip"]
          napomena: string | null
          rok_dospijeca: string
          status: Database["public"]["Enums"]["termini_status"]
          updated_at: string
          vrsta_provjere_id: string
          zaduzeni: string | null
        }
        Insert: {
          created_at?: string
          datum_izvrsenja?: string | null
          datum_zadnjeg?: string | null
          datum_zakazan?: string | null
          id?: string
          interval_mjeseci?: number | null
          klijent_id: string
          lokacija_id?: string | null
          nacin_izvrsenja?: Database["public"]["Enums"]["nacin_izvrsenja_tip"]
          napomena?: string | null
          rok_dospijeca: string
          status?: Database["public"]["Enums"]["termini_status"]
          updated_at?: string
          vrsta_provjere_id: string
          zaduzeni?: string | null
        }
        Update: {
          created_at?: string
          datum_izvrsenja?: string | null
          datum_zadnjeg?: string | null
          datum_zakazan?: string | null
          id?: string
          interval_mjeseci?: number | null
          klijent_id?: string
          lokacija_id?: string | null
          nacin_izvrsenja?: Database["public"]["Enums"]["nacin_izvrsenja_tip"]
          napomena?: string | null
          rok_dospijeca?: string
          status?: Database["public"]["Enums"]["termini_status"]
          updated_at?: string
          vrsta_provjere_id?: string
          zaduzeni?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "termini_klijent_id_fkey"
            columns: ["klijent_id"]
            isOneToOne: false
            referencedRelation: "klijenti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "termini_klijent_id_fkey"
            columns: ["klijent_id"]
            isOneToOne: false
            referencedRelation: "klijenti_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "termini_lokacija_id_fkey"
            columns: ["lokacija_id"]
            isOneToOne: false
            referencedRelation: "lokacije"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "termini_vrsta_provjere_id_fkey"
            columns: ["vrsta_provjere_id"]
            isOneToOne: false
            referencedRelation: "vrste_provjera"
            referencedColumns: ["id"]
          },
        ]
      }
      ugovori: {
        Row: {
          aktivan: boolean
          automatsko_obnavljanje: boolean
          broj_obilazaka_mjesecno: number | null
          created_at: string
          datum_isteka: string | null
          datum_potpisivanja: string | null
          id: string
          klijent_id: string
          napomena: string | null
          vazenje_mjeseci: number | null
          zavodni_broj: string | null
        }
        Insert: {
          aktivan?: boolean
          automatsko_obnavljanje?: boolean
          broj_obilazaka_mjesecno?: number | null
          created_at?: string
          datum_isteka?: string | null
          datum_potpisivanja?: string | null
          id?: string
          klijent_id: string
          napomena?: string | null
          vazenje_mjeseci?: number | null
          zavodni_broj?: string | null
        }
        Update: {
          aktivan?: boolean
          automatsko_obnavljanje?: boolean
          broj_obilazaka_mjesecno?: number | null
          created_at?: string
          datum_isteka?: string | null
          datum_potpisivanja?: string | null
          id?: string
          klijent_id?: string
          napomena?: string | null
          vazenje_mjeseci?: number | null
          zavodni_broj?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ugovori_klijent_id_fkey"
            columns: ["klijent_id"]
            isOneToOne: false
            referencedRelation: "klijenti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ugovori_klijent_id_fkey"
            columns: ["klijent_id"]
            isOneToOne: false
            referencedRelation: "klijenti_view"
            referencedColumns: ["id"]
          },
        ]
      }
      vrste_provjera: {
        Row: {
          aktivna: boolean
          id: string
          napomena: string | null
          naziv: string
          podrazumevani_interval_mjeseci: number | null
          sifra: string | null
          vodi_dokumentaciju: boolean
          zakonski_osnov: string | null
        }
        Insert: {
          aktivna?: boolean
          id?: string
          napomena?: string | null
          naziv: string
          podrazumevani_interval_mjeseci?: number | null
          sifra?: string | null
          vodi_dokumentaciju?: boolean
          zakonski_osnov?: string | null
        }
        Update: {
          aktivna?: boolean
          id?: string
          napomena?: string | null
          naziv?: string
          podrazumevani_interval_mjeseci?: number | null
          sifra?: string | null
          vodi_dokumentaciju?: boolean
          zakonski_osnov?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      aktivnost_view: {
        Row: {
          akcija: string | null
          detalji: Json | null
          entitet: string | null
          entitet_id: string | null
          id: number | null
          korisnik_email: string | null
          korisnik_id: string | null
          korisnik_ime: string | null
          novo: Json | null
          staro: Json | null
          vrijeme: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_korisnik_id_fkey"
            columns: ["korisnik_id"]
            isOneToOne: false
            referencedRelation: "korisnici"
            referencedColumns: ["id"]
          },
        ]
      }
      klijenti_view: {
        Row: {
          broj_aktivnih: number | null
          broj_izvrseno: number | null
          broj_kasni: number | null
          broj_lokacija: number | null
          broj_termina: number | null
          created_at: string | null
          id: string | null
          napomena: string | null
          naziv: string | null
          tip_odnosa: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      termini_view: {
        Row: {
          created_at: string | null
          datum_izvrsenja: string | null
          datum_prikaza: string | null
          datum_zadnjeg: string | null
          datum_zakazan: string | null
          id: string | null
          interval_mjeseci: number | null
          klijent_id: string | null
          klijent_naziv: string | null
          lokacija_grad: string | null
          lokacija_id: string | null
          lokacija_naziv: string | null
          nacin_izvrsenja:
            | Database["public"]["Enums"]["nacin_izvrsenja_tip"]
            | null
          napomena: string | null
          rok_dospijeca: string | null
          status: Database["public"]["Enums"]["termini_status"] | null
          status_izvedeni: string | null
          updated_at: string | null
          vrsta_naziv: string | null
          vrsta_provjere_id: string | null
          zaduzeni: string | null
        }
        Relationships: [
          {
            foreignKeyName: "termini_klijent_id_fkey"
            columns: ["klijent_id"]
            isOneToOne: false
            referencedRelation: "klijenti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "termini_klijent_id_fkey"
            columns: ["klijent_id"]
            isOneToOne: false
            referencedRelation: "klijenti_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "termini_lokacija_id_fkey"
            columns: ["lokacija_id"]
            isOneToOne: false
            referencedRelation: "lokacije"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "termini_vrsta_provjere_id_fkey"
            columns: ["vrsta_provjere_id"]
            isOneToOne: false
            referencedRelation: "vrste_provjera"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      dodaj_podsjetnik_email: {
        Args: { p_email: string; p_klijent_id: string }
        Returns: string
      }
      get_aktivnost: {
        Args: {
          p_akcija?: string
          p_do?: string
          p_entitet?: string
          p_korisnik?: string
          p_limit?: number
          p_od?: string
          p_offset?: number
          p_pretraga?: string
        }
        Returns: {
          akcija: string
          detalji: Json
          entitet: string
          entitet_id: string
          id: number
          korisnik_email: string
          korisnik_id: string
          korisnik_ime: string
          novo: Json
          staro: Json
          ukupno: number
          vrijeme: string
        }[]
      }
      get_due_podsjetnici: {
        Args: { dana_prije_arr: number[] }
        Returns: {
          dana_do_roka: number
          dana_prije: number
          klijent_id: string
          klijent_naziv: string
          lokacija_naziv: string
          rok_dospijeca: string
          termin_id: string
          vrsta_naziv: string
        }[]
      }
      get_opterecenje: {
        Args: { godina: number }
        Returns: {
          izvrseno: number
          kasni: number
          mjesec: number
          u_planu: number
          ukupno: number
        }[]
      }
      get_termini_stats: {
        Args: never
        Returns: {
          izvrseno_ovog_mjeseca: number
          kasni: number
          ovog_mjeseca: number
          ukupno: number
        }[]
      }
      ima_pristup_dokumentu: { Args: { p_path: string }; Returns: boolean }
      ima_pristup_klijentu: { Args: { p_klijent_id: string }; Returns: boolean }
      je_admin: { Args: never; Returns: boolean }
      je_pregled: { Args: never; Returns: boolean }
      obrisi_stare_dogadjaje: { Args: never; Returns: number }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      ukloni_podsjetnik_email: {
        Args: { p_email: string; p_klijent_id: string }
        Returns: undefined
      }
      zabiljezi_dogadjaje: { Args: { p_dogadjaji: Json }; Returns: undefined }
      zabiljezi_zakazano_obavijest: {
        Args: { p_base: string[]; p_datum_zakazan: string; p_termin_id: string }
        Returns: string[]
      }
    }
    Enums: {
      chat_uloga: "user" | "assistant"
      korisnik_uloga: "admin" | "operater" | "pregled"
      nacin_izvrsenja_tip: "izvrsava" | "pracenje"
      termini_status: "planirano" | "zakazano" | "izvrseno" | "otkazano"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      chat_uloga: ["user", "assistant"],
      korisnik_uloga: ["admin", "operater", "pregled"],
      nacin_izvrsenja_tip: ["izvrsava", "pracenje"],
      termini_status: ["planirano", "zakazano", "izvrseno", "otkazano"],
    },
  },
} as const

