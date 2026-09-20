export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
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
      commission_events: {
        Row: {
          actor_id: string | null
          after: Json | null
          before: Json | null
          commission_id: string
          created_at: string
          event_type: string
          id: string
          reason: string | null
          sale_id: string
          sale_unit_id: string
        }
        Insert: {
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          commission_id: string
          created_at?: string
          event_type: string
          id?: string
          reason?: string | null
          sale_id: string
          sale_unit_id: string
        }
        Update: {
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          commission_id?: string
          created_at?: string
          event_type?: string
          id?: string
          reason?: string | null
          sale_id?: string
          sale_unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_events_commission_id_fkey"
            columns: ["commission_id"]
            isOneToOne: false
            referencedRelation: "sale_commissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_events_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_events_sale_unit_id_fkey"
            columns: ["sale_unit_id"]
            isOneToOne: false
            referencedRelation: "sale_units"
            referencedColumns: ["id"]
          },
        ]
      }
      financing_contract_events: {
        Row: {
          changed_by: string | null
          contract_id: string
          created_at: string
          from_status: string | null
          id: string
          note: string | null
          to_status: string
        }
        Insert: {
          changed_by?: string | null
          contract_id: string
          created_at?: string
          from_status?: string | null
          id?: string
          note?: string | null
          to_status: string
        }
        Update: {
          changed_by?: string | null
          contract_id?: string
          created_at?: string
          from_status?: string | null
          id?: string
          note?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "financing_contract_events_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financing_contract_events_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "sale_financing_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_unit_events: {
        Row: {
          actor_id: string | null
          changes: Json | null
          created_at: string
          event_type: string
          from_status: string | null
          id: string
          inventory_unit_id: string
          reason: string | null
          sale_id: string | null
          sale_unit_id: string | null
          to_status: string | null
        }
        Insert: {
          actor_id?: string | null
          changes?: Json | null
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: string
          inventory_unit_id: string
          reason?: string | null
          sale_id?: string | null
          sale_unit_id?: string | null
          to_status?: string | null
        }
        Update: {
          actor_id?: string | null
          changes?: Json | null
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          inventory_unit_id?: string
          reason?: string | null
          sale_id?: string | null
          sale_unit_id?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_unit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_unit_events_inventory_unit_id_fkey"
            columns: ["inventory_unit_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_unit_events_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_unit_events_sale_unit_id_fkey"
            columns: ["sale_unit_id"]
            isOneToOne: false
            referencedRelation: "sale_units"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_units: {
        Row: {
          base_commission_cents: number | null
          created_at: string
          id: string
          legacy_status: string | null
          note: string | null
          product_id: string
          reference_price_cents: number | null
          status: string
          updated_at: string
          variant_id: string | null
          vin: string | null
        }
        Insert: {
          base_commission_cents?: number | null
          created_at?: string
          id?: string
          legacy_status?: string | null
          note?: string | null
          product_id: string
          reference_price_cents?: number | null
          status?: string
          updated_at?: string
          variant_id?: string | null
          vin?: string | null
        }
        Update: {
          base_commission_cents?: number | null
          created_at?: string
          id?: string
          legacy_status?: string | null
          note?: string | null
          product_id?: string
          reference_price_cents?: number | null
          status?: string
          updated_at?: string
          variant_id?: string | null
          vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_units_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_units_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_delivery_errors: {
        Row: {
          context: Json | null
          created_at: string
          id: string
          message: string | null
          source: string
          sqlstate: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          id?: string
          message?: string | null
          source: string
          sqlstate?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          id?: string
          message?: string | null
          source?: string
          sqlstate?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          destination_url: string | null
          entity_id: string | null
          entity_type: string | null
          event_key: string | null
          id: string
          message: string
          metadata: Json | null
          read_at: string | null
          recipient_user_id: string
          sale_id: string | null
          title: string
          type: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          destination_url?: string | null
          entity_id?: string | null
          entity_type?: string | null
          event_key?: string | null
          id?: string
          message: string
          metadata?: Json | null
          read_at?: string | null
          recipient_user_id: string
          sale_id?: string | null
          title: string
          type: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          destination_url?: string | null
          entity_id?: string | null
          entity_type?: string | null
          event_key?: string | null
          id?: string
          message?: string
          metadata?: Json | null
          read_at?: string | null
          recipient_user_id?: string
          sale_id?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_method_plans: {
        Row: {
          created_at: string
          fee_bps: number
          id: string
          is_active: boolean
          label: string
          legacy_code: string | null
          payment_method_id: string
          position: number
          term_months: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          fee_bps: number
          id?: string
          is_active?: boolean
          label: string
          legacy_code?: string | null
          payment_method_id: string
          position?: number
          term_months?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          fee_bps?: number
          id?: string
          is_active?: boolean
          label?: string
          legacy_code?: string | null
          payment_method_id?: string
          position?: number
          term_months?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_method_plans_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          branch_scope: string | null
          conditional_above_fee_bps: number | null
          conditional_below_fee_cents: number | null
          conditional_threshold_cents: number | null
          created_at: string
          fee_strategy: string
          flat_fee_bps: number | null
          flat_fee_cents: number | null
          has_queue: boolean
          icon_key: string | null
          id: string
          instructions: string | null
          interest_paid_by_customer_fee_bps: number | null
          is_active: boolean
          legacy_id: string
          method_type: string
          name: string
          only_florida: boolean
          position: number
          queue_daily_limit: number | null
          queue_limit_mode: string | null
          requires_signed_contract: boolean
          subtext: string | null
          updated_at: string
          website_enabled: boolean
          website_url: string | null
          zelle_account: string | null
        }
        Insert: {
          branch_scope?: string | null
          conditional_above_fee_bps?: number | null
          conditional_below_fee_cents?: number | null
          conditional_threshold_cents?: number | null
          created_at?: string
          fee_strategy: string
          flat_fee_bps?: number | null
          flat_fee_cents?: number | null
          has_queue?: boolean
          icon_key?: string | null
          id?: string
          instructions?: string | null
          interest_paid_by_customer_fee_bps?: number | null
          is_active?: boolean
          legacy_id: string
          method_type: string
          name: string
          only_florida?: boolean
          position?: number
          queue_daily_limit?: number | null
          queue_limit_mode?: string | null
          requires_signed_contract?: boolean
          subtext?: string | null
          updated_at?: string
          website_enabled?: boolean
          website_url?: string | null
          zelle_account?: string | null
        }
        Update: {
          branch_scope?: string | null
          conditional_above_fee_bps?: number | null
          conditional_below_fee_cents?: number | null
          conditional_threshold_cents?: number | null
          created_at?: string
          fee_strategy?: string
          flat_fee_bps?: number | null
          flat_fee_cents?: number | null
          has_queue?: boolean
          icon_key?: string | null
          id?: string
          instructions?: string | null
          interest_paid_by_customer_fee_bps?: number | null
          is_active?: boolean
          legacy_id?: string
          method_type?: string
          name?: string
          only_florida?: boolean
          position?: number
          queue_daily_limit?: number | null
          queue_limit_mode?: string | null
          requires_signed_contract?: boolean
          subtext?: string | null
          updated_at?: string
          website_enabled?: boolean
          website_url?: string | null
          zelle_account?: string | null
        }
        Relationships: []
      }
      payment_provider_events: {
        Row: {
          actor_id: string | null
          changes: Json | null
          created_at: string
          event_type: string
          id: string
          plan_id: string | null
          provider_id: string
        }
        Insert: {
          actor_id?: string | null
          changes?: Json | null
          created_at?: string
          event_type: string
          id?: string
          plan_id?: string | null
          provider_id: string
        }
        Update: {
          actor_id?: string | null
          changes?: Json | null
          created_at?: string
          event_type?: string
          id?: string
          plan_id?: string | null
          provider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_provider_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_provider_events_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "payment_method_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_provider_events_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      product_catalog_events: {
        Row: {
          actor_id: string | null
          changes: Json | null
          created_at: string
          event_type: string
          id: string
          image_id: string | null
          product_id: string
          variant_id: string | null
        }
        Insert: {
          actor_id?: string | null
          changes?: Json | null
          created_at?: string
          event_type: string
          id?: string
          image_id?: string | null
          product_id: string
          variant_id?: string | null
        }
        Update: {
          actor_id?: string | null
          changes?: Json | null
          created_at?: string
          event_type?: string
          id?: string
          image_id?: string | null
          product_id?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_catalog_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_catalog_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_catalog_events_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          created_at: string
          id: string
          legacy_path: string | null
          position: number
          product_id: string
          storage_path: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          legacy_path?: string | null
          position?: number
          product_id: string
          storage_path?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          legacy_path?: string | null
          position?: number
          product_id?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          color_name: string
          color_normalized: string
          created_at: string
          id: string
          is_active: boolean
          product_id: string
          quantity_reported: number
          updated_at: string
        }
        Insert: {
          color_name: string
          color_normalized: string
          created_at?: string
          id?: string
          is_active?: boolean
          product_id: string
          quantity_reported?: number
          updated_at?: string
        }
        Update: {
          color_name?: string
          color_normalized?: string
          created_at?: string
          id?: string
          is_active?: boolean
          product_id?: string
          quantity_reported?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          base_price_cents: number | null
          brand: string | null
          category: string | null
          created_at: string
          cuba_total_cents: number | null
          default_base_commission_cents: number | null
          default_reference_price_cents: number | null
          displacement: string | null
          engine: string | null
          id: string
          is_active: boolean
          legacy_commission_cents: number | null
          legacy_id: string | null
          legacy_timestamp: number | null
          metadata: Json
          name: string
          power: string | null
          shipping_cents: number | null
          status: string | null
          stock_mode: string | null
          updated_at: string
          weight: string | null
        }
        Insert: {
          base_price_cents?: number | null
          brand?: string | null
          category?: string | null
          created_at?: string
          cuba_total_cents?: number | null
          default_base_commission_cents?: number | null
          default_reference_price_cents?: number | null
          displacement?: string | null
          engine?: string | null
          id?: string
          is_active?: boolean
          legacy_commission_cents?: number | null
          legacy_id?: string | null
          legacy_timestamp?: number | null
          metadata?: Json
          name: string
          power?: string | null
          shipping_cents?: number | null
          status?: string | null
          stock_mode?: string | null
          updated_at?: string
          weight?: string | null
        }
        Update: {
          base_price_cents?: number | null
          brand?: string | null
          category?: string | null
          created_at?: string
          cuba_total_cents?: number | null
          default_base_commission_cents?: number | null
          default_reference_price_cents?: number | null
          displacement?: string | null
          engine?: string | null
          id?: string
          is_active?: boolean
          legacy_commission_cents?: number | null
          legacy_id?: string | null
          legacy_timestamp?: number | null
          metadata?: Json
          name?: string
          power?: string | null
          shipping_cents?: number | null
          status?: string | null
          stock_mode?: string | null
          updated_at?: string
          weight?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          account_status: string
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          invited_at: string | null
          invited_by: string | null
          is_active: boolean
          is_sandbox: boolean
          phone: string | null
          reactivated_at: string | null
          reactivated_by: string | null
          role: string
          suspended_at: string | null
          suspended_by: string | null
          suspension_reason: string | null
          updated_at: string
        }
        Insert: {
          account_status?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          invited_at?: string | null
          invited_by?: string | null
          is_active?: boolean
          is_sandbox?: boolean
          phone?: string | null
          reactivated_at?: string | null
          reactivated_by?: string | null
          role?: string
          suspended_at?: string | null
          suspended_by?: string | null
          suspension_reason?: string | null
          updated_at?: string
        }
        Update: {
          account_status?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          is_active?: boolean
          is_sandbox?: boolean
          phone?: string | null
          reactivated_at?: string | null
          reactivated_by?: string | null
          role?: string
          suspended_at?: string | null
          suspended_by?: string | null
          suspension_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_reactivated_by_fkey"
            columns: ["reactivated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_suspended_by_fkey"
            columns: ["suspended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_change_history: {
        Row: {
          change_type: string
          changed_at: string
          changed_by: string | null
          edit_group: string
          edit_kind: string | null
          field_path: string
          id: string
          new_value: string | null
          old_value: string | null
          reason: string | null
          request_id: string | null
          requested_by: string | null
          sale_id: string
        }
        Insert: {
          change_type: string
          changed_at?: string
          changed_by?: string | null
          edit_group: string
          edit_kind?: string | null
          field_path: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          reason?: string | null
          request_id?: string | null
          requested_by?: string | null
          sale_id: string
        }
        Update: {
          change_type?: string
          changed_at?: string
          changed_by?: string | null
          edit_group?: string
          edit_kind?: string | null
          field_path?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          reason?: string | null
          request_id?: string | null
          requested_by?: string | null
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_change_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_change_history_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "sale_edit_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_change_history_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_change_history_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_commissions: {
        Row: {
          base_commission_cents: number
          calculated_at: string
          created_at: string
          eligible_at: string | null
          final_commission_cents: number
          id: string
          liquidation_id: string | null
          price_difference_cents: number
          reference_price_cents: number
          sale_id: string
          sale_price_cents: number
          sale_unit_id: string
          seller_difference_share_cents: number
          seller_id: string
          source_id: string | null
          source_type: string
          status: string
          updated_at: string
        }
        Insert: {
          base_commission_cents: number
          calculated_at?: string
          created_at?: string
          eligible_at?: string | null
          final_commission_cents: number
          id?: string
          liquidation_id?: string | null
          price_difference_cents: number
          reference_price_cents: number
          sale_id: string
          sale_price_cents: number
          sale_unit_id: string
          seller_difference_share_cents: number
          seller_id: string
          source_id?: string | null
          source_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          base_commission_cents?: number
          calculated_at?: string
          created_at?: string
          eligible_at?: string | null
          final_commission_cents?: number
          id?: string
          liquidation_id?: string | null
          price_difference_cents?: number
          reference_price_cents?: number
          sale_id?: string
          sale_price_cents?: number
          sale_unit_id?: string
          seller_difference_share_cents?: number
          seller_id?: string
          source_id?: string | null
          source_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_commissions_liquidation_id_fkey"
            columns: ["liquidation_id"]
            isOneToOne: false
            referencedRelation: "weekly_liquidations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_commissions_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_commissions_sale_unit_id_fkey"
            columns: ["sale_unit_id"]
            isOneToOne: true
            referencedRelation: "sale_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_commissions_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_cuba_recipients: {
        Row: {
          created_at: string
          date_of_birth: string | null
          delivery_address: string | null
          full_name: string | null
          id: string
          identity_address: string | null
          identity_number: string | null
          municipality: string | null
          primary_phone: string | null
          province: string | null
          sale_id: string
          secondary_phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_of_birth?: string | null
          delivery_address?: string | null
          full_name?: string | null
          id?: string
          identity_address?: string | null
          identity_number?: string | null
          municipality?: string | null
          primary_phone?: string | null
          province?: string | null
          sale_id: string
          secondary_phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_of_birth?: string | null
          delivery_address?: string | null
          full_name?: string | null
          id?: string
          identity_address?: string | null
          identity_number?: string | null
          municipality?: string | null
          primary_phone?: string | null
          province?: string | null
          sale_id?: string
          secondary_phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_cuba_recipients_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: true
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_deliveries: {
        Row: {
          created_at: string
          delivery_notes: string | null
          id: string
          method: string | null
          pickup_reference: string | null
          sale_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivery_notes?: string | null
          id?: string
          method?: string | null
          pickup_reference?: string | null
          sale_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivery_notes?: string | null
          id?: string
          method?: string | null
          pickup_reference?: string | null
          sale_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_deliveries_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: true
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_documents: {
        Row: {
          created_at: string
          extraction_metadata: Json
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          party_id: string | null
          recipient_id: string | null
          sale_id: string
          side: string
          storage_path: string
          subject_type: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          extraction_metadata?: Json
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          party_id?: string | null
          recipient_id?: string | null
          sale_id: string
          side: string
          storage_path: string
          subject_type: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          extraction_metadata?: Json
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          party_id?: string | null
          recipient_id?: string | null
          sale_id?: string
          side?: string
          storage_path?: string
          subject_type?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_documents_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "sale_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_documents_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "sale_cuba_recipients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_documents_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_edit_requests: {
        Row: {
          created_at: string
          id: string
          reason: string
          requested_by: string
          requested_changes: Json
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sale_id: string
          sale_status_at_request: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason: string
          requested_by: string
          requested_changes: Json
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sale_id: string
          sale_status_at_request: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
          requested_by?: string
          requested_changes?: Json
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sale_id?: string
          sale_status_at_request?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_edit_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_edit_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_edit_requests_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_extras: {
        Row: {
          created_at: string
          description: string | null
          id: string
          position: number
          quantity: number
          sale_id: string
          sale_unit_id: string | null
          unit_price_cents: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          position?: number
          quantity?: number
          sale_id: string
          sale_unit_id?: string | null
          unit_price_cents?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          position?: number
          quantity?: number
          sale_id?: string
          sale_unit_id?: string | null
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_extras_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_extras_sale_unit_id_fkey"
            columns: ["sale_unit_id"]
            isOneToOne: false
            referencedRelation: "sale_units"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_financing_contracts: {
        Row: {
          accredited_at: string | null
          accredited_by: string | null
          contract_file_size_bytes: number | null
          contract_mime_type: string | null
          contract_storage_path: string | null
          created_at: string
          fee_amount_cents: number
          gross_amount_cents: number
          id: string
          net_amount_cents: number
          payment_allocation_id: string
          payment_method_id: string
          plan_code_snapshot: string | null
          plan_label_snapshot: string | null
          provider_name_snapshot: string
          sale_id: string
          sent_at: string
          sent_by: string | null
          signed_at: string | null
          signed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accredited_at?: string | null
          accredited_by?: string | null
          contract_file_size_bytes?: number | null
          contract_mime_type?: string | null
          contract_storage_path?: string | null
          created_at?: string
          fee_amount_cents: number
          gross_amount_cents: number
          id?: string
          net_amount_cents: number
          payment_allocation_id: string
          payment_method_id: string
          plan_code_snapshot?: string | null
          plan_label_snapshot?: string | null
          provider_name_snapshot: string
          sale_id: string
          sent_at?: string
          sent_by?: string | null
          signed_at?: string | null
          signed_by?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          accredited_at?: string | null
          accredited_by?: string | null
          contract_file_size_bytes?: number | null
          contract_mime_type?: string | null
          contract_storage_path?: string | null
          created_at?: string
          fee_amount_cents?: number
          gross_amount_cents?: number
          id?: string
          net_amount_cents?: number
          payment_allocation_id?: string
          payment_method_id?: string
          plan_code_snapshot?: string | null
          plan_label_snapshot?: string | null
          provider_name_snapshot?: string
          sale_id?: string
          sent_at?: string
          sent_by?: string | null
          signed_at?: string | null
          signed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_financing_contracts_accredited_by_fkey"
            columns: ["accredited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_financing_contracts_payment_allocation_id_fkey"
            columns: ["payment_allocation_id"]
            isOneToOne: true
            referencedRelation: "sale_payment_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_financing_contracts_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_financing_contracts_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_financing_contracts_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_financing_contracts_signed_by_fkey"
            columns: ["signed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_parties: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          country_code: string | null
          created_at: string
          date_of_birth: string | null
          document_expiration: string | null
          document_number: string | null
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          party_role: string
          phone: string | null
          postal_code: string | null
          sale_id: string
          state: string | null
          updated_at: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string
          date_of_birth?: string | null
          document_expiration?: string | null
          document_number?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          party_role: string
          phone?: string | null
          postal_code?: string | null
          sale_id: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string
          date_of_birth?: string | null
          document_expiration?: string | null
          document_number?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          party_role?: string
          phone?: string | null
          postal_code?: string | null
          sale_id?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_parties_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_payment_allocations: {
        Row: {
          created_at: string
          fee_amount_cents: number
          fee_bps_snapshot: number | null
          fee_strategy_snapshot: string
          fixed_fee_cents_snapshot: number | null
          gross_amount_cents: number
          id: string
          input_mode: string
          net_amount_cents: number
          notes: string | null
          payment_method_id: string
          payment_method_plan_id: string | null
          plan_label_snapshot: string | null
          position: number
          provider_name_snapshot: string
          reference: string | null
          requires_signed_contract_snapshot: boolean
          sale_id: string
          settled_at: string | null
          settled_by: string | null
          settlement_status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          fee_amount_cents?: number
          fee_bps_snapshot?: number | null
          fee_strategy_snapshot: string
          fixed_fee_cents_snapshot?: number | null
          gross_amount_cents?: number
          id?: string
          input_mode: string
          net_amount_cents?: number
          notes?: string | null
          payment_method_id: string
          payment_method_plan_id?: string | null
          plan_label_snapshot?: string | null
          position?: number
          provider_name_snapshot: string
          reference?: string | null
          requires_signed_contract_snapshot?: boolean
          sale_id: string
          settled_at?: string | null
          settled_by?: string | null
          settlement_status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          fee_amount_cents?: number
          fee_bps_snapshot?: number | null
          fee_strategy_snapshot?: string
          fixed_fee_cents_snapshot?: number | null
          gross_amount_cents?: number
          id?: string
          input_mode?: string
          net_amount_cents?: number
          notes?: string | null
          payment_method_id?: string
          payment_method_plan_id?: string | null
          plan_label_snapshot?: string | null
          position?: number
          provider_name_snapshot?: string
          reference?: string | null
          requires_signed_contract_snapshot?: boolean
          sale_id?: string
          settled_at?: string | null
          settled_by?: string | null
          settlement_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_payment_allocations_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_payment_allocations_payment_method_plan_id_fkey"
            columns: ["payment_method_plan_id"]
            isOneToOne: false
            referencedRelation: "payment_method_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_payment_allocations_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_payment_allocations_settled_by_fkey"
            columns: ["settled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_status_history: {
        Row: {
          changed_by: string | null
          created_at: string
          from_status: string | null
          id: string
          reason: string | null
          sale_id: string
          to_status: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          sale_id: string
          to_status: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          sale_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_status_history_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_unit_logistics: {
        Row: {
          carrier_reference: string | null
          container_reference: string | null
          created_at: string
          delivered_at: string | null
          delivered_by: string | null
          estimated_delivery_date: string | null
          hold_reason: string | null
          id: string
          last_event_at: string
          sale_unit_id: string
          shipment_reference: string | null
          status: string
          updated_at: string
        }
        Insert: {
          carrier_reference?: string | null
          container_reference?: string | null
          created_at?: string
          delivered_at?: string | null
          delivered_by?: string | null
          estimated_delivery_date?: string | null
          hold_reason?: string | null
          id?: string
          last_event_at?: string
          sale_unit_id: string
          shipment_reference?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          carrier_reference?: string | null
          container_reference?: string | null
          created_at?: string
          delivered_at?: string | null
          delivered_by?: string | null
          estimated_delivery_date?: string | null
          hold_reason?: string | null
          id?: string
          last_event_at?: string
          sale_unit_id?: string
          shipment_reference?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_unit_logistics_delivered_by_fkey"
            columns: ["delivered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_unit_logistics_sale_unit_id_fkey"
            columns: ["sale_unit_id"]
            isOneToOne: true
            referencedRelation: "sale_units"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_unit_logistics_events: {
        Row: {
          actor_id: string | null
          event_type: string
          from_status: string | null
          id: string
          metadata: Json | null
          note: string | null
          occurred_at: string
          sale_unit_id: string
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          event_type: string
          from_status?: string | null
          id?: string
          metadata?: Json | null
          note?: string | null
          occurred_at?: string
          sale_unit_id: string
          to_status: string
        }
        Update: {
          actor_id?: string | null
          event_type?: string
          from_status?: string | null
          id?: string
          metadata?: Json | null
          note?: string | null
          occurred_at?: string
          sale_unit_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_unit_logistics_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_unit_logistics_events_sale_unit_id_fkey"
            columns: ["sale_unit_id"]
            isOneToOne: false
            referencedRelation: "sale_units"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_units: {
        Row: {
          agreed_price_cents: number
          brand_snapshot: string | null
          created_at: string
          cuba_total_cents_snapshot: number | null
          id: string
          inventory_unit_id: string | null
          list_price_cents_snapshot: number | null
          position: number
          product_id: string
          product_name_snapshot: string
          product_variant_id: string | null
          sale_id: string
          tracking_code: string | null
          updated_at: string
          variant_snapshot: string | null
        }
        Insert: {
          agreed_price_cents?: number
          brand_snapshot?: string | null
          created_at?: string
          cuba_total_cents_snapshot?: number | null
          id?: string
          inventory_unit_id?: string | null
          list_price_cents_snapshot?: number | null
          position?: number
          product_id: string
          product_name_snapshot: string
          product_variant_id?: string | null
          sale_id: string
          tracking_code?: string | null
          updated_at?: string
          variant_snapshot?: string | null
        }
        Update: {
          agreed_price_cents?: number
          brand_snapshot?: string | null
          created_at?: string
          cuba_total_cents_snapshot?: number | null
          id?: string
          inventory_unit_id?: string | null
          list_price_cents_snapshot?: number | null
          position?: number
          product_id?: string
          product_name_snapshot?: string
          product_variant_id?: string | null
          sale_id?: string
          tracking_code?: string | null
          updated_at?: string
          variant_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_units_inventory_unit_id_fkey"
            columns: ["inventory_unit_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_units_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_units_product_variant_id_fkey"
            columns: ["product_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_units_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          amount_collected_cents: number | null
          amount_outstanding_cents: number | null
          closing_reviewed_at: string | null
          closing_reviewed_by: string | null
          created_at: string
          currency: string
          delivery_total_cents: number | null
          extras_total_cents: number | null
          id: string
          internal_notes: string | null
          operation_type: string
          paid_at: string | null
          paid_by: string | null
          review_requested_at: string | null
          review_requested_by: string | null
          sale_date: string | null
          sale_number: string | null
          sale_total_cents: number | null
          seller_id: string
          settlement_status: string | null
          share_commission: boolean
          sold_at: string | null
          sold_by: string | null
          status: string
          units_total_cents: number | null
          updated_at: string
        }
        Insert: {
          amount_collected_cents?: number | null
          amount_outstanding_cents?: number | null
          closing_reviewed_at?: string | null
          closing_reviewed_by?: string | null
          created_at?: string
          currency?: string
          delivery_total_cents?: number | null
          extras_total_cents?: number | null
          id?: string
          internal_notes?: string | null
          operation_type: string
          paid_at?: string | null
          paid_by?: string | null
          review_requested_at?: string | null
          review_requested_by?: string | null
          sale_date?: string | null
          sale_number?: string | null
          sale_total_cents?: number | null
          seller_id: string
          settlement_status?: string | null
          share_commission?: boolean
          sold_at?: string | null
          sold_by?: string | null
          status?: string
          units_total_cents?: number | null
          updated_at?: string
        }
        Update: {
          amount_collected_cents?: number | null
          amount_outstanding_cents?: number | null
          closing_reviewed_at?: string | null
          closing_reviewed_by?: string | null
          created_at?: string
          currency?: string
          delivery_total_cents?: number | null
          extras_total_cents?: number | null
          id?: string
          internal_notes?: string | null
          operation_type?: string
          paid_at?: string | null
          paid_by?: string | null
          review_requested_at?: string | null
          review_requested_by?: string | null
          sale_date?: string | null
          sale_number?: string | null
          sale_total_cents?: number | null
          seller_id?: string
          settlement_status?: string | null
          share_commission?: boolean
          sold_at?: string | null
          sold_by?: string | null
          status?: string
          units_total_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_closing_reviewed_by_fkey"
            columns: ["closing_reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_confirmed_by_fkey"
            columns: ["sold_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_review_requested_by_fkey"
            columns: ["review_requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_account_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          reason: string | null
          seller_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          reason?: string | null
          seller_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          reason?: string | null
          seller_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_account_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_account_events_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_invitations: {
        Row: {
          accepted_at: string | null
          cancelled_at: string | null
          created_at: string
          email: string
          email_attempts: number
          email_delivery_status: string | null
          email_last_attempt_at: string | null
          email_last_error: string | null
          email_sent_at: string | null
          id: string
          invited_at: string
          invited_by: string
          invited_user_id: string | null
          link_digest: string | null
          status: string
        }
        Insert: {
          accepted_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          email: string
          email_attempts?: number
          email_delivery_status?: string | null
          email_last_attempt_at?: string | null
          email_last_error?: string | null
          email_sent_at?: string | null
          id?: string
          invited_at?: string
          invited_by: string
          invited_user_id?: string | null
          link_digest?: string | null
          status?: string
        }
        Update: {
          accepted_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          email?: string
          email_attempts?: number
          email_delivery_status?: string | null
          email_last_attempt_at?: string | null
          email_last_error?: string | null
          email_sent_at?: string | null
          id?: string
          invited_at?: string
          invited_by?: string
          invited_user_id?: string | null
          link_digest?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_invitations_invited_user_id_fkey"
            columns: ["invited_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_liquidation_adjustments: {
        Row: {
          adjustment_type: string
          amount_cents: number
          created_at: string
          created_by: string
          id: string
          liquidation_id: string
          reason: string
        }
        Insert: {
          adjustment_type: string
          amount_cents: number
          created_at?: string
          created_by: string
          id?: string
          liquidation_id: string
          reason: string
        }
        Update: {
          adjustment_type?: string
          amount_cents?: number
          created_at?: string
          created_by?: string
          id?: string
          liquidation_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_liquidation_adjustments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_liquidation_adjustments_liquidation_id_fkey"
            columns: ["liquidation_id"]
            isOneToOne: false
            referencedRelation: "weekly_liquidations"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_liquidation_events: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: Json | null
          event_type: string
          id: string
          liquidation_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          event_type: string
          id?: string
          liquidation_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          event_type?: string
          id?: string
          liquidation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_liquidation_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_liquidation_events_liquidation_id_fkey"
            columns: ["liquidation_id"]
            isOneToOne: false
            referencedRelation: "weekly_liquidations"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_liquidations: {
        Row: {
          adjustments_total_cents: number
          approved_at: string | null
          approved_by: string | null
          commissions_subtotal_cents: number
          created_at: string
          id: string
          paid_at: string | null
          paid_by: string | null
          payment_reference: string | null
          seller_id: string
          status: string
          total_to_pay_cents: number
          updated_at: string
          week_end_date: string
          week_start_date: string
        }
        Insert: {
          adjustments_total_cents?: number
          approved_at?: string | null
          approved_by?: string | null
          commissions_subtotal_cents?: number
          created_at?: string
          id?: string
          paid_at?: string | null
          paid_by?: string | null
          payment_reference?: string | null
          seller_id: string
          status?: string
          total_to_pay_cents?: number
          updated_at?: string
          week_end_date: string
          week_start_date: string
        }
        Update: {
          adjustments_total_cents?: number
          approved_at?: string | null
          approved_by?: string | null
          commissions_subtotal_cents?: number
          created_at?: string
          id?: string
          paid_at?: string | null
          paid_by?: string | null
          payment_reference?: string | null
          seller_id?: string
          status?: string
          total_to_pay_cents?: number
          updated_at?: string
          week_end_date?: string
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_liquidations_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_liquidations_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_liquidations_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _commission_config_missing_rows: {
        Args: never
        Returns: {
          entity_id: string
          entity_label: string
          kind: string
          product_id: string
          product_name: string
        }[]
      }
      _dealer_day_start_at: { Args: { p_date: string }; Returns: string }
      _dealer_timezone: { Args: never; Returns: string }
      _inventory_reconciliation_rows: {
        Args: never
        Returns: {
          difference: number
          product_id: string
          product_name: string
          reported_quantity: number
          vin_count: number
        }[]
      }
      _liquidation_alert_rows: {
        Args: never
        Returns: {
          amount_cents: number
          liquidation_id: string
          liquidation_status: string
          seller_id: string
          seller_name: string
          week_end: string
          week_start: string
        }[]
      }
      _liquidation_week_close_at: {
        Args: { p_week_start: string }
        Returns: string
      }
      _liquidation_week_of_instant: { Args: { p_ts: string }; Returns: string }
      _liquidation_week_open_at: {
        Args: { p_week_start: string }
        Returns: string
      }
      _liquidation_week_start: { Args: { p_date: string }; Returns: string }
      _log_notification_error: {
        Args: {
          p_context: Json
          p_message: string
          p_source: string
          p_sqlstate: string
        }
        Returns: undefined
      }
      _logistics_status_label: { Args: { p_status: string }; Returns: string }
      _notification_money: { Args: { p_cents: number }; Returns: string }
      _notification_person: { Args: { p_profile_id: string }; Returns: string }
      _notification_sale_context: {
        Args: { p_sale_id: string }
        Returns: Record<string, unknown>
      }
      _notifications_enabled: { Args: { p_event_at: string }; Returns: boolean }
      _notify: {
        Args: {
          p_actor: string
          p_entity_id: string
          p_entity_type: string
          p_event_key: string
          p_message: string
          p_metadata?: Json
          p_recipient: string
          p_sale_id: string
          p_title: string
          p_type: string
          p_url: string
        }
        Returns: undefined
      }
      _notify_admins: {
        Args: {
          p_actor: string
          p_entity_id: string
          p_entity_type: string
          p_event_key: string
          p_message: string
          p_metadata?: Json
          p_sale_id: string
          p_subject: string
          p_title: string
          p_type: string
          p_url: string
        }
        Returns: undefined
      }
      _pay_net_from_gross: {
        Args: {
          p_ca_bps: number
          p_cb: number
          p_ct: number
          p_flat_bps: number
          p_flat_cents: number
          p_gross: number
          p_plan_bps: number
          p_strategy: string
        }
        Returns: number
      }
      _product_pricing_configured: {
        Args: { p_fixed_commission: number; p_fixed_price: number }
        Returns: boolean
      }
      _sale_commission_preview: { Args: { p_sale_id: string }; Returns: Json }
      _sale_pricing_errors: { Args: { p_sale_id: string }; Returns: string[] }
      _weekly_sale_row: {
        Args: { p_counted: string[]; p_sale_id: string }
        Returns: Json
      }
      accept_seller_invitation: { Args: never; Returns: Json }
      admin_actionable_financing_contracts: {
        Args: never
        Returns: {
          allocation_id: string
          buyer_name: string
          contract_id: string
          contract_status: string
          gross_cents: number
          last_update: string
          net_cents: number
          plan_label: string
          provider_name: string
          sale_id: string
          sale_number: string
          seller_id: string
          seller_name: string
        }[]
      }
      admin_activity_feed: {
        Args: {
          p_actor_id?: string
          p_category?: string
          p_end_date?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_seller_id?: string
          p_start_date?: string
        }
        Returns: Json
      }
      admin_add_product_image: {
        Args: { p_product_id: string; p_storage_path: string }
        Returns: Json
      }
      admin_alerts_list: {
        Args: {
          p_category?: string
          p_limit?: number
          p_offset?: number
          p_priority?: string
          p_seller_id?: string
        }
        Returns: Json
      }
      admin_alerts_summary: { Args: never; Returns: Json }
      admin_approvals_counts: { Args: never; Returns: Json }
      admin_approvals_todo: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      admin_assign_inventory_vin: {
        Args: { p_inventory_unit_id: string; p_sale_unit_id: string }
        Returns: Json
      }
      admin_begin_invitation_email: {
        Args: { p_link_digest: string; p_seller_id: string }
        Returns: Json
      }
      admin_bulk_create_inventory_units: {
        Args: { p_product_id: string; p_variant_id?: string; p_vins?: string[] }
        Returns: Json
      }
      admin_cancel_seller_invitation: {
        Args: { p_seller_id: string }
        Returns: Json
      }
      admin_collections_inbox: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_seller_id?: string
        }
        Returns: Json
      }
      admin_commission_kpis: { Args: never; Returns: Json }
      admin_commission_list: {
        Args: {
          p_end_date?: string
          p_limit?: number
          p_offset?: number
          p_product_id?: string
          p_search?: string
          p_seller_id?: string
          p_start_date?: string
          p_status?: string
        }
        Returns: Json
      }
      admin_confirm_sale_closing: { Args: { p_sale_id: string }; Returns: Json }
      admin_contracts_inbox: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_seller_id?: string
          p_status?: string
        }
        Returns: Json
      }
      admin_create_inventory_unit: {
        Args: {
          p_note?: string
          p_product_id: string
          p_variant_id?: string
          p_vin?: string
        }
        Returns: Json
      }
      admin_create_payment_plan: {
        Args: {
          p_fee_bps?: number
          p_label: string
          p_position?: number
          p_provider_id: string
          p_term_months?: number
        }
        Returns: Json
      }
      admin_create_payment_provider: {
        Args: {
          p_conditional_above_fee_bps?: number
          p_conditional_below_fee_cents?: number
          p_conditional_threshold_cents?: number
          p_fee_strategy?: string
          p_flat_fee_bps?: number
          p_flat_fee_cents?: number
          p_instructions?: string
          p_is_active?: boolean
          p_legacy_id: string
          p_method_type: string
          p_name: string
          p_only_florida?: boolean
          p_position?: number
          p_requires_signed_contract?: boolean
          p_subtext?: string
          p_website_enabled?: boolean
          p_website_url?: string
        }
        Returns: Json
      }
      admin_create_product: {
        Args: {
          p_base_price_cents?: number
          p_brand?: string
          p_category?: string
          p_cuba_total_cents?: number
          p_displacement?: string
          p_engine?: string
          p_is_active?: boolean
          p_legacy_id?: string
          p_name: string
          p_power?: string
          p_shipping_cents?: number
          p_stock_mode?: string
          p_weight?: string
        }
        Returns: Json
      }
      admin_create_product_variant: {
        Args: {
          p_color_name: string
          p_product_id: string
          p_quantity_reported?: number
        }
        Returns: Json
      }
      admin_dashboard_data: {
        Args: { p_end: string; p_start: string }
        Returns: Json
      }
      admin_dealer_today: { Args: never; Returns: Json }
      admin_disable_seller: {
        Args: { p_reason?: string; p_seller_id: string }
        Returns: Json
      }
      admin_duplicate_product: {
        Args: { p_include_variants?: boolean; p_product_id: string }
        Returns: Json
      }
      admin_edit_request_detail: {
        Args: { p_request_id: string }
        Returns: Json
      }
      admin_edit_requests_list: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
        }
        Returns: Json
      }
      admin_finish_invitation_email: {
        Args: {
          p_error?: string
          p_link_digest: string
          p_seller_id: string
          p_sent: boolean
        }
        Returns: Json
      }
      admin_global_search: {
        Args: { p_limit?: number; p_query: string }
        Returns: Json
      }
      admin_inventory_detail: {
        Args: { p_inventory_unit_id: string }
        Returns: Json
      }
      admin_inventory_kpis: { Args: never; Returns: Json }
      admin_inventory_list: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_product_id?: string
          p_search?: string
          p_status?: string
          p_stock_mode?: string
          p_variant_id?: string
        }
        Returns: Json
      }
      admin_inventory_reconciliation: { Args: never; Returns: Json }
      admin_liquidation_add_adjustment: {
        Args: {
          p_amount_cents: number
          p_liquidation_id: string
          p_reason: string
          p_type: string
        }
        Returns: Json
      }
      admin_liquidation_approve: {
        Args: { p_liquidation_id: string }
        Returns: Json
      }
      admin_liquidation_create_draft: {
        Args: { p_seller_id: string; p_week_start: string }
        Returns: Json
      }
      admin_liquidation_current_week: { Args: never; Returns: Json }
      admin_liquidation_detail: {
        Args: { p_liquidation_id: string }
        Returns: Json
      }
      admin_liquidation_mark_paid: {
        Args: { p_liquidation_id: string; p_payment_reference?: string }
        Returns: Json
      }
      admin_liquidation_refresh: {
        Args: { p_liquidation_id: string }
        Returns: Json
      }
      admin_liquidation_week_list: {
        Args: { p_week_start?: string }
        Returns: Json
      }
      admin_logistics_correct_status: {
        Args: { p_new_status: string; p_reason: string; p_sale_unit_id: string }
        Returns: Json
      }
      admin_logistics_kpis: { Args: never; Returns: Json }
      admin_logistics_list: {
        Args: {
          p_commercial_status?: string
          p_limit?: number
          p_offset?: number
          p_product_id?: string
          p_search?: string
          p_seller_id?: string
          p_status?: string
        }
        Returns: Json
      }
      admin_logistics_update_status: {
        Args: { p_new_status: string; p_note?: string; p_sale_unit_id: string }
        Returns: Json
      }
      admin_mark_sale_paid: { Args: { p_sale_id: string }; Returns: Json }
      admin_payment_provider_detail: {
        Args: { p_provider_id: string }
        Returns: Json
      }
      admin_payment_provider_list: {
        Args: {
          p_contract?: string
          p_search?: string
          p_status?: string
          p_type?: string
        }
        Returns: Json
      }
      admin_product_detail: { Args: { p_product_id: string }; Returns: Json }
      admin_product_list: {
        Args: { p_category?: string; p_search?: string; p_status?: string }
        Returns: Json
      }
      admin_reactivate_seller: { Args: { p_seller_id: string }; Returns: Json }
      admin_ready_to_pay_inbox: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_seller_id?: string
        }
        Returns: Json
      }
      admin_record_seller_invitation: {
        Args: { p_email: string; p_link_digest?: string; p_seller_id: string }
        Returns: Json
      }
      admin_release_inventory_vin: {
        Args: { p_reason: string; p_sale_unit_id: string }
        Returns: Json
      }
      admin_remove_product_image: {
        Args: { p_image_id: string }
        Returns: Json
      }
      admin_reorder_payment_plans: {
        Args: { p_ordered_plan_ids: string[]; p_provider_id: string }
        Returns: Json
      }
      admin_reorder_product_images: {
        Args: { p_ordered_image_ids: string[]; p_product_id: string }
        Returns: Json
      }
      admin_reports_collection: {
        Args: { p_end?: string; p_start?: string }
        Returns: Json
      }
      admin_reports_commissions: {
        Args: { p_end?: string; p_start?: string }
        Returns: Json
      }
      admin_reports_financing: {
        Args: { p_end?: string; p_start?: string }
        Returns: Json
      }
      admin_reports_funnel: {
        Args: { p_end?: string; p_start?: string }
        Returns: Json
      }
      admin_reports_liquidations: {
        Args: { p_end?: string; p_start?: string }
        Returns: Json
      }
      admin_reports_overview: {
        Args: { p_end?: string; p_start?: string }
        Returns: Json
      }
      admin_reports_products: {
        Args: {
          p_category?: string
          p_end?: string
          p_start?: string
          p_stock_mode?: string
        }
        Returns: Json
      }
      admin_reports_sales_trend: {
        Args: { p_end?: string; p_granularity?: string; p_start?: string }
        Returns: Json
      }
      admin_reports_sellers: {
        Args: {
          p_end?: string
          p_order?: string
          p_sort?: string
          p_start?: string
        }
        Returns: Json
      }
      admin_reports_top_products: {
        Args: {
          p_end?: string
          p_limit?: number
          p_metric?: string
          p_start?: string
        }
        Returns: Json
      }
      admin_sales_list: {
        Args: {
          p_collection_status?: string
          p_end_date?: string
          p_financing_status?: string
          p_limit?: number
          p_offset?: number
          p_sale_status?: string
          p_search?: string
          p_seller_id?: string
          p_start_date?: string
        }
        Returns: Json
      }
      admin_sales_queue_list: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: Json
      }
      admin_seller_detail: { Args: { p_seller_id: string }; Returns: Json }
      admin_seller_list: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
        }
        Returns: Json
      }
      admin_set_payment_plan_active: {
        Args: { p_active: boolean; p_plan_id: string }
        Returns: Json
      }
      admin_set_payment_provider_active: {
        Args: { p_active: boolean; p_provider_id: string }
        Returns: Json
      }
      admin_set_primary_product_image: {
        Args: { p_image_id: string }
        Returns: Json
      }
      admin_set_product_active: {
        Args: { p_active: boolean; p_product_id: string }
        Returns: Json
      }
      admin_set_product_variant_active: {
        Args: { p_active: boolean; p_variant_id: string }
        Returns: Json
      }
      admin_sold_sales_settlement: {
        Args: never
        Returns: {
          buyer_name: string
          collected_cents: number
          outstanding_cents: number
          ready_for_paid: boolean
          sale_id: string
          sale_number: string
          sale_total_cents: number
          seller_id: string
          seller_name: string
          sold_at: string
        }[]
      }
      admin_suspend_seller: {
        Args: { p_reason?: string; p_seller_id: string }
        Returns: Json
      }
      admin_touch_seller_invitation: {
        Args: { p_link_digest?: string; p_seller_id: string }
        Returns: Json
      }
      admin_update_cuba_sale: {
        Args: {
          p_admin_correction?: boolean
          p_expected_updated_at?: string
          p_payload: Json
          p_reason: string
          p_sale_id: string
        }
        Returns: Json
      }
      admin_update_inventory_commission_config: {
        Args: {
          p_base_commission_cents: number
          p_reference_price_cents: number
          p_unit_id: string
        }
        Returns: Json
      }
      admin_update_inventory_vin: {
        Args: { p_new_vin: string; p_reason?: string; p_unit_id: string }
        Returns: Json
      }
      admin_update_payment_plan: {
        Args: {
          p_fee_bps?: number
          p_label: string
          p_plan_id: string
          p_term_months?: number
        }
        Returns: Json
      }
      admin_update_payment_provider: {
        Args: {
          p_conditional_above_fee_bps?: number
          p_conditional_below_fee_cents?: number
          p_conditional_threshold_cents?: number
          p_fee_strategy?: string
          p_flat_fee_bps?: number
          p_flat_fee_cents?: number
          p_instructions?: string
          p_name: string
          p_only_florida?: boolean
          p_position?: number
          p_provider_id: string
          p_requires_signed_contract?: boolean
          p_subtext?: string
          p_website_enabled?: boolean
          p_website_url?: string
        }
        Returns: Json
      }
      admin_update_product: {
        Args: {
          p_base_price_cents?: number
          p_brand?: string
          p_category?: string
          p_cuba_total_cents?: number
          p_displacement?: string
          p_engine?: string
          p_name: string
          p_power?: string
          p_product_id: string
          p_shipping_cents?: number
          p_stock_mode?: string
          p_weight?: string
        }
        Returns: Json
      }
      admin_update_product_commission_defaults: {
        Args: {
          p_default_base_commission_cents: number
          p_default_reference_price_cents: number
          p_product_id: string
        }
        Returns: Json
      }
      admin_update_product_variant: {
        Args: {
          p_color_name: string
          p_quantity_reported?: number
          p_variant_id: string
        }
        Returns: Json
      }
      approve_sale_edit_request: {
        Args: { p_request_id: string }
        Returns: Json
      }
      attach_financing_contract_document: {
        Args: {
          p_contract_id: string
          p_file_size_bytes?: number
          p_mime_type?: string
          p_storage_path: string
        }
        Returns: Json
      }
      cancel_sale_edit_request: {
        Args: { p_request_id: string }
        Returns: Json
      }
      compute_payment_fee: {
        Args: {
          p_cond_above_bps?: number
          p_cond_below?: number
          p_cond_threshold?: number
          p_flat_bps?: number
          p_flat_cents?: number
          p_gross: number
          p_plan_bps?: number
          p_strategy: string
        }
        Returns: number
      }
      create_sale_draft: {
        Args: { p_operation_type?: string }
        Returns: string
      }
      get_cuba_sale_draft: { Args: { p_sale_id: string }; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      log_sale_field_change: {
        Args: {
          p_by: string
          p_group: string
          p_new: string
          p_old: string
          p_path: string
          p_reason: string
          p_sale_id: string
          p_type: string
        }
        Returns: undefined
      }
      mark_financing_accredited: {
        Args: { p_contract_id: string; p_note?: string }
        Returns: Json
      }
      mark_financing_sent: {
        Args: {
          p_contract_storage_path?: string
          p_payment_allocation_id: string
          p_sale_id: string
        }
        Returns: Json
      }
      mark_financing_signed: {
        Args: { p_contract_id: string; p_note?: string }
        Returns: Json
      }
      mark_payment_allocation_settled: {
        Args: { p_allocation_id: string }
        Returns: Json
      }
      mark_sale_sold: { Args: { p_sale_id: string }; Returns: Json }
      notification_mark_all_read: { Args: never; Returns: Json }
      notification_mark_read: {
        Args: { p_notification_id: string }
        Returns: Json
      }
      notification_unread_count: { Args: never; Returns: number }
      payment_bps_fee: {
        Args: { p_amount: number; p_bps: number }
        Returns: number
      }
      payment_fee_settlement: {
        Args: {
          p_amount: number
          p_cond_above_bps?: number
          p_cond_below?: number
          p_cond_threshold?: number
          p_flat_bps?: number
          p_flat_cents?: number
          p_input_mode: string
          p_plan_bps?: number
          p_strategy: string
        }
        Returns: Json
      }
      record_sale_document: {
        Args: {
          p_file_size_bytes?: number
          p_mime_type?: string
          p_sale_id: string
          p_side: string
          p_storage_path: string
          p_subject_type: string
        }
        Returns: undefined
      }
      reject_sale_edit_request: {
        Args: { p_request_id: string; p_review_note: string }
        Returns: Json
      }
      remove_sale_document: {
        Args: { p_sale_id: string; p_side: string; p_subject_type: string }
        Returns: undefined
      }
      request_sale_edit: {
        Args: { p_changes: Json; p_reason: string; p_sale_id: string }
        Returns: Json
      }
      request_sale_review: { Args: { p_sale_id: string }; Returns: Json }
      return_sale_to_draft: {
        Args: { p_reason: string; p_sale_id: string }
        Returns: Json
      }
      sale_commission_summary: { Args: { p_sale_id: string }; Returns: Json }
      sale_edit_snapshot: { Args: { p_sale_id: string }; Returns: Json }
      sale_is_own: { Args: { p_sale_id: string }; Returns: boolean }
      sale_is_own_draft: { Args: { p_sale_id: string }; Returns: boolean }
      sale_settlement_amounts: {
        Args: { p_sale_id: string }
        Returns: {
          all_covered: boolean
          collected_cents: number
        }[]
      }
      sale_unit_inventory_status: { Args: { p_sale_id: string }; Returns: Json }
      sale_unit_logistics_status: { Args: { p_sale_id: string }; Returns: Json }
      save_cuba_sale_draft: {
        Args: { p_payload: Json; p_sale_id: string }
        Returns: Json
      }
      seller_commission_kpis: { Args: never; Returns: Json }
      seller_commission_list: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      seller_dashboard_data: {
        Args: {
          p_end: string
          p_prev_end: string
          p_prev_start: string
          p_start: string
        }
        Returns: Json
      }
      seller_liquidation_detail: {
        Args: { p_liquidation_id: string }
        Returns: Json
      }
      seller_liquidation_list: { Args: never; Returns: Json }
      seller_sale_commission_previews: {
        Args: { p_sale_ids: string[] }
        Returns: Json
      }
      seller_sales_list: {
        Args: {
          p_end_date?: string
          p_financing_status?: string
          p_limit?: number
          p_offset?: number
          p_operation_type?: string
          p_search?: string
          p_settlement?: string
          p_start_date?: string
          p_status?: string
        }
        Returns: Json
      }
      seller_weekly_liquidation: {
        Args: { p_seller_id?: string; p_week_start?: string }
        Returns: Json
      }
      sync_sale_payment_allocations: {
        Args: { p_allocations: Json; p_sale_id: string }
        Returns: undefined
      }
      update_confirmed_cuba_sale: {
        Args: { p_payload: Json; p_reason: string; p_sale_id: string }
        Returns: Json
      }
      user_role: { Args: never; Returns: string }
      validate_cuba_sale_for_review: {
        Args: { p_sale_id: string }
        Returns: string[]
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
    Enums: {},
  },
} as const
