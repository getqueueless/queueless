// Hand-written Database type for the ASSUMED SCHEMA (see repo root CLAUDE.md
// and docs/JUDGE_NOTES.md). The DB agent owns supabase/migrations; the moment
// real migrations land on origin/main, regenerate this file for real with:
//   npx supabase gen types typescript --local > apps/web/types/database.types.ts
// and delete this hand-written version.

export type TokenStatus = "waiting" | "called" | "serving" | "done" | "no_show"
export type StaffRole = "admin" | "counter"

export type ServiceRow = {
  id: string
  name: string
  code: string
}

export type CounterRow = {
  id: string
  service_id: string
  label: string
}

export type StaffRow = {
  id: string
  user_id: string
  role: StaffRole
  counter_id: string | null
}

export type TokenRow = {
  id: string
  service_id: string
  number: number
  status: TokenStatus
  counter_id: string | null
  priority: number
  created_at: string
  called_at: string | null
  done_at: string | null
}

export type PriorityRuleRow = {
  id: string
  service_id: string
  label: string
  weight: number
}

export interface Database {
  public: {
    Tables: {
      services: {
        Row: ServiceRow
        Insert: Partial<ServiceRow> & Pick<ServiceRow, "name" | "code">
        Update: Partial<ServiceRow>
        Relationships: []
      }
      counters: {
        Row: CounterRow
        Insert: Partial<CounterRow> & Pick<CounterRow, "service_id" | "label">
        Update: Partial<CounterRow>
        Relationships: [
          {
            foreignKeyName: "counters_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: StaffRow
        Insert: Partial<StaffRow> & Pick<StaffRow, "user_id" | "role">
        Update: Partial<StaffRow>
        Relationships: [
          {
            foreignKeyName: "staff_counter_id_fkey"
            columns: ["counter_id"]
            isOneToOne: false
            referencedRelation: "counters"
            referencedColumns: ["id"]
          },
        ]
      }
      tokens: {
        Row: TokenRow
        Insert: Partial<TokenRow> & Pick<TokenRow, "service_id" | "number">
        Update: Partial<TokenRow>
        Relationships: [
          {
            foreignKeyName: "tokens_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tokens_counter_id_fkey"
            columns: ["counter_id"]
            isOneToOne: false
            referencedRelation: "counters"
            referencedColumns: ["id"]
          },
        ]
      }
      priority_rules: {
        Row: PriorityRuleRow
        Insert: Partial<PriorityRuleRow> & Pick<PriorityRuleRow, "service_id" | "label" | "weight">
        Update: Partial<PriorityRuleRow>
        Relationships: [
          {
            foreignKeyName: "priority_rules_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: Record<string, never>
    Functions: {
      // RPCs the DB agent's Postgres functions are expected to expose.
      // Names/args/returns are unconfirmed until supabase/migrations lands --
      // reconcile against the real function signatures the moment it does.
      issue_token: {
        Args: { service_id: string }
        Returns: TokenRow
      }
      call_next: {
        Args: { counter_id: string }
        Returns: TokenRow | null
      }
      mark_done: {
        Args: { token_id: string }
        Returns: TokenRow
      }
      mark_no_show: {
        Args: { token_id: string }
        Returns: TokenRow
      }
      recall_token: {
        Args: { token_id: string }
        Returns: TokenRow
      }
      transfer_token: {
        Args: { token_id: string; target_counter_id: string }
        Returns: TokenRow
      }
    }
    Enums: {
      token_status: TokenStatus
      staff_role: StaffRole
    }
    CompositeTypes: Record<string, never>
  }
}
