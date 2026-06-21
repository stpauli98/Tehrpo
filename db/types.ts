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
      chat_poruke: {
        Row: {
          alat_pozivi: Json | null
          created_at: string
          id: string
          konverzacija_id: string
          sadrzaj: string
          uloga: Database["public"]["Enums"]["chat_uloga"]
        }
        Insert: {
          alat_pozivi?: Json | null
          created_at?: string
          id?: string
          konverzacija_id: string
          sadrzaj: string
          uloga: Database["public"]["Enums"]["chat_uloga"]
        }
        Update: {
          alat_pozivi?: Json | null
          created_at?: string
          id?: string
          konverzacija_id?: string
          sadrzaj?: string
          uloga?: Database["public"]["Enums"]["chat_uloga"]
        }
        Relationships: []
      }
      dokumenti: {
        Row: {
          generated_by_ai: boolean
          id: string
          mime_type: string | null
          naziv: string
          storage_path: string
          termin_id: string
          uploaded_at: string
          velicina_bajt: number | null
        }
        Insert: {
          generated_by_ai?: boolean
          id?: string
          mime_type?: string | null
          naziv: string
          storage_path: string
          termin_id: string
          uploaded_at?: string
          velicina_bajt?: number | null
        }
        Update: {
          generated_by_ai?: boolean
          id?: string
          mime_type?: string | null
          naziv?: string
          storage_path?: string
          termin_id?: string
          uploaded_at?: string
          velicina_bajt?: number | null
        }
        Relationships: [
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
        ]
      }
      klijenti: {
        Row: {
          created_at: string
          id: string
          napomena: string | null
          naziv: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          napomena?: string | null
          naziv: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          napomena?: string | null
          naziv?: string
          updated_at?: string
        }
        Relationships: []
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
          poslat_at: string
          poslat_na: string[]
          resend_id: string | null
          termin_id: string
        }
        Insert: {
          dana_prije: number
          id?: string
          poslat_at?: string
          poslat_na: string[]
          resend_id?: string | null
          termin_id: string
        }
        Update: {
          dana_prije?: number
          id?: string
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
      vrste_provjera: {
        Row: {
          aktivna: boolean
          id: string
          napomena: string | null
          naziv: string
          podrazumevani_interval_mjeseci: number | null
          sifra: string | null
          zakonski_osnov: string | null
        }
        Insert: {
          aktivna?: boolean
          id?: string
          napomena?: string | null
          naziv: string
          podrazumevani_interval_mjeseci?: number | null
          sifra?: string | null
          zakonski_osnov?: string | null
        }
        Update: {
          aktivna?: boolean
          id?: string
          napomena?: string | null
          naziv?: string
          podrazumevani_interval_mjeseci?: number | null
          sifra?: string | null
          zakonski_osnov?: string | null
        }
        Relationships: []
      }
    }
    Views: {
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
          updated_at: string | null
        }
        Relationships: []
      }
      termini_view: {
        Row: {
          created_at: string | null
          datum_izvrsenja: string | null
          datum_zadnjeg: string | null
          datum_zakazan: string | null
          id: string | null
          interval_mjeseci: number | null
          klijent_id: string | null
          klijent_naziv: string | null
          lokacija_grad: string | null
          lokacija_id: string | null
          lokacija_naziv: string | null
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      chat_uloga: "user" | "assistant"
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
      termini_status: ["planirano", "zakazano", "izvrseno", "otkazano"],
    },
  },
} as const

