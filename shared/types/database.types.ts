
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "affiliate_commissions": {
                  Row: {
                    "affiliate_id": string,"amount": number,"available_at": string,"created_at": string,"currency": string,"gross_amount": number,"id": string,"is_test": boolean,"legacy_id": number | null,"legacy_raw": Json | null,"order_id": string,"percent": number
                  }
                  ComputedFields: never
                  Insert: {
                    "affiliate_id": string,"amount": number,"available_at": string,"created_at"?: string,"currency": string,"gross_amount": number,"id"?: string,"is_test"?: boolean,"legacy_id"?: number | null,"legacy_raw"?: Json | null,"order_id": string,"percent": number
                  }
                  Update: {
                    "affiliate_id"?: string,"amount"?: number,"available_at"?: string,"created_at"?: string,"currency"?: string,"gross_amount"?: number,"id"?: string,"is_test"?: boolean,"legacy_id"?: number | null,"legacy_raw"?: Json | null,"order_id"?: string,"percent"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "affiliate_commissions_affiliate_id_fkey"
      columns: ["affiliate_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "affiliate_commissions_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"affiliate_ledger": {
                  Row: {
                    "affiliate_id": string,"amount": number,"available_at": string,"commission_id": string | null,"created_at": string,"currency": string,"entry_type": Database["public"]['Enums']["ledger_entry_type"],"id": number,"is_test": boolean,"memo": string | null,"withdrawal_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "affiliate_id": string,"amount": number,"available_at"?: string,"commission_id"?: string | null,"created_at"?: string,"currency": string,"entry_type": Database["public"]['Enums']["ledger_entry_type"],"id"?: never,"is_test"?: boolean,"memo"?: string | null,"withdrawal_id"?: string | null
                  }
                  Update: {
                    "affiliate_id"?: string,"amount"?: number,"available_at"?: string,"commission_id"?: string | null,"created_at"?: string,"currency"?: string,"entry_type"?: Database["public"]['Enums']["ledger_entry_type"],"id"?: never,"is_test"?: boolean,"memo"?: string | null,"withdrawal_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "affiliate_ledger_affiliate_id_fkey"
      columns: ["affiliate_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "affiliate_ledger_commission_id_fkey"
      columns: ["commission_id"]
isOneToOne: false
      referencedRelation: "affiliate_commissions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "affiliate_ledger_withdrawal_id_fkey"
      columns: ["withdrawal_id"]
isOneToOne: false
      referencedRelation: "withdrawal_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"articles": {
                  Row: {
                    "author_id": string | null,"content_html": string | null,"created_at": string,"deleted_at": string | null,"excerpt": string | null,"id": number,"is_demo": boolean,"kind": Database["public"]['Enums']["article_kind"],"legacy_id": number | null,"poster_path": string | null,"status": Database["public"]['Enums']["content_status"],"title": string,"updated_at": string,"view_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"content_html"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"excerpt"?: string | null,"id"?: never,"is_demo"?: boolean,"kind"?: Database["public"]['Enums']["article_kind"],"legacy_id"?: number | null,"poster_path"?: string | null,"status"?: Database["public"]['Enums']["content_status"],"title": string,"updated_at"?: string,"view_count"?: number
                  }
                  Update: {
                    "author_id"?: string | null,"content_html"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"excerpt"?: string | null,"id"?: never,"is_demo"?: boolean,"kind"?: Database["public"]['Enums']["article_kind"],"legacy_id"?: number | null,"poster_path"?: string | null,"status"?: Database["public"]['Enums']["content_status"],"title"?: string,"updated_at"?: string,"view_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "articles_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"diff": Json | null,"entity": string,"entity_id": string | null,"id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"diff"?: Json | null,"entity": string,"entity_id"?: string | null,"id"?: never
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"diff"?: Json | null,"entity"?: string,"entity_id"?: string | null,"id"?: never
                  }
                  Relationships: [
                    
                  ]
                },"book_categories": {
                  Row: {
                    "book_id": number,"category_id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "book_id": number,"category_id": number
                  }
                  Update: {
                    "book_id"?: number,"category_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "book_categories_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "book_categories_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books_readiness"
      referencedColumns: ["book_id"]
    },{
      foreignKeyName: "book_categories_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    }
                  ]
                },"book_makers": {
                  Row: {
                    "book_id": number,"maker_id": number,"role": Database["public"]['Enums']["maker_kind"]
                  }
                  ComputedFields: never
                  Insert: {
                    "book_id": number,"maker_id": number,"role": Database["public"]['Enums']["maker_kind"]
                  }
                  Update: {
                    "book_id"?: number,"maker_id"?: number,"role"?: Database["public"]['Enums']["maker_kind"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "book_makers_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "book_makers_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books_readiness"
      referencedColumns: ["book_id"]
    },{
      foreignKeyName: "book_makers_maker_id_fkey"
      columns: ["maker_id"]
isOneToOne: false
      referencedRelation: "makers"
      referencedColumns: ["id"]
    }
                  ]
                },"book_media": {
                  Row: {
                    "book_id": number,"byte_size": number | null,"checksum_verified_at": string | null,"created_at": string,"extension": string | null,"external_url": string | null,"id": number,"is_external": boolean,"kind": Database["public"]['Enums']["media_kind"],"legacy_book_media_id": number | null,"legacy_download_count": number | null,"legacy_path": string | null,"migration_status": Database["public"]['Enums']["media_migration_status"],"mime_type": string | null,"name": string,"page_count": number,"sha256": string | null,"sort_order": number,"storage_path": string | null,"storage_provider": Database["public"]['Enums']["media_storage_provider"],"updated_at": string,"visibility": Database["public"]['Enums']["media_visibility"],"book_media_is_validated": boolean | null
                  }
                  ComputedFields: "book_media_is_validated"
                  Insert: {
                    "book_id": number,"byte_size"?: number | null,"checksum_verified_at"?: string | null,"created_at"?: string,"extension"?: string | null,"external_url"?: string | null,"id"?: never,"is_external"?: boolean,"kind"?: Database["public"]['Enums']["media_kind"],"legacy_book_media_id"?: number | null,"legacy_download_count"?: number | null,"legacy_path"?: string | null,"migration_status"?: Database["public"]['Enums']["media_migration_status"],"mime_type"?: string | null,"name"?: string,"page_count"?: number,"sha256"?: string | null,"sort_order"?: number,"storage_path"?: string | null,"storage_provider"?: Database["public"]['Enums']["media_storage_provider"],"updated_at"?: string,"visibility"?: Database["public"]['Enums']["media_visibility"]
                  }
                  Update: {
                    "book_id"?: number,"byte_size"?: number | null,"checksum_verified_at"?: string | null,"created_at"?: string,"extension"?: string | null,"external_url"?: string | null,"id"?: never,"is_external"?: boolean,"kind"?: Database["public"]['Enums']["media_kind"],"legacy_book_media_id"?: number | null,"legacy_download_count"?: number | null,"legacy_path"?: string | null,"migration_status"?: Database["public"]['Enums']["media_migration_status"],"mime_type"?: string | null,"name"?: string,"page_count"?: number,"sha256"?: string | null,"sort_order"?: number,"storage_path"?: string | null,"storage_provider"?: Database["public"]['Enums']["media_storage_provider"],"updated_at"?: string,"visibility"?: Database["public"]['Enums']["media_visibility"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "book_media_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "book_media_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books_readiness"
      referencedColumns: ["book_id"]
    }
                  ]
                },"book_relations": {
                  Row: {
                    "book_id": number,"related_id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "book_id": number,"related_id": number
                  }
                  Update: {
                    "book_id"?: number,"related_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "book_relations_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "book_relations_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books_readiness"
      referencedColumns: ["book_id"]
    },{
      foreignKeyName: "book_relations_related_id_fkey"
      columns: ["related_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "book_relations_related_id_fkey"
      columns: ["related_id"]
isOneToOne: false
      referencedRelation: "books_readiness"
      referencedColumns: ["book_id"]
    }
                  ]
                },"book_tags": {
                  Row: {
                    "book_id": number,"tag": string
                  }
                  ComputedFields: never
                  Insert: {
                    "book_id": number,"tag": string
                  }
                  Update: {
                    "book_id"?: number,"tag"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "book_tags_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "book_tags_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books_readiness"
      referencedColumns: ["book_id"]
    }
                  ]
                },"books": {
                  Row: {
                    "cover_path": string | null,"created_at": string,"deleted_at": string | null,"description_html": string | null,"id": number,"import_run_id": number | null,"is_demo": boolean,"kind": Database["public"]['Enums']["book_kind"],"legacy_cost_raw": string | null,"legacy_id": number | null,"legacy_status_raw": string | null,"legacy_verified_at": string | null,"legacy_verified_by": string | null,"owner_id": string | null,"pages": number,"price_amount": number,"price_currency": string,"provenance": string,"slug": string,"status": Database["public"]['Enums']["content_status"],"title": string,"title_norm": string,"updated_at": string,"view_count": number,"book_readiness_row": (string)[] | null
                  }
                  ComputedFields: "book_readiness_row"
                  Insert: {
                    "cover_path"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"description_html"?: string | null,"id"?: never,"import_run_id"?: number | null,"is_demo"?: boolean,"kind"?: Database["public"]['Enums']["book_kind"],"legacy_cost_raw"?: string | null,"legacy_id"?: number | null,"legacy_status_raw"?: string | null,"legacy_verified_at"?: string | null,"legacy_verified_by"?: string | null,"owner_id"?: string | null,"pages"?: number,"price_amount"?: number,"price_currency"?: string,"provenance"?: string,"slug"?: string,"status"?: Database["public"]['Enums']["content_status"],"title": string,"title_norm"?: string,"updated_at"?: string,"view_count"?: number
                  }
                  Update: {
                    "cover_path"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"description_html"?: string | null,"id"?: never,"import_run_id"?: number | null,"is_demo"?: boolean,"kind"?: Database["public"]['Enums']["book_kind"],"legacy_cost_raw"?: string | null,"legacy_id"?: number | null,"legacy_status_raw"?: string | null,"legacy_verified_at"?: string | null,"legacy_verified_by"?: string | null,"owner_id"?: string | null,"pages"?: number,"price_amount"?: number,"price_currency"?: string,"provenance"?: string,"slug"?: string,"status"?: Database["public"]['Enums']["content_status"],"title"?: string,"title_norm"?: string,"updated_at"?: string,"view_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "books_import_run_id_fkey"
      columns: ["import_run_id"]
isOneToOne: false
      referencedRelation: "migration_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "books_legacy_verified_by_fkey"
      columns: ["legacy_verified_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "books_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"categories": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"id": number,"image_path": string | null,"is_active": boolean,"is_demo": boolean,"legacy_id": number | null,"name": string,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: never,"image_path"?: string | null,"is_active"?: boolean,"is_demo"?: boolean,"legacy_id"?: number | null,"name": string,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: never,"image_path"?: string | null,"is_active"?: boolean,"is_demo"?: boolean,"legacy_id"?: number | null,"name"?: string,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"comments": {
                  Row: {
                    "body": string,"book_id": number,"created_at": string,"id": number,"legacy_id": number | null,"status": Database["public"]['Enums']["comment_status"],"user_id": string,"visible_to_public": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"book_id": number,"created_at"?: string,"id"?: never,"legacy_id"?: number | null,"status"?: Database["public"]['Enums']["comment_status"],"user_id": string,"visible_to_public"?: boolean
                  }
                  Update: {
                    "body"?: string,"book_id"?: number,"created_at"?: string,"id"?: never,"legacy_id"?: number | null,"status"?: Database["public"]['Enums']["comment_status"],"user_id"?: string,"visible_to_public"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "comments_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comments_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books_readiness"
      referencedColumns: ["book_id"]
    },{
      foreignKeyName: "comments_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"contact_messages": {
                  Row: {
                    "created_at": string,"email": string,"id": number,"is_handled": boolean,"message": string,"name": string,"subject": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"id"?: never,"is_handled"?: boolean,"message": string,"name": string,"subject": string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"id"?: never,"is_handled"?: boolean,"message"?: string,"name"?: string,"subject"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_messages_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"contributor_requests": {
                  Row: {
                    "about": string | null,"book_id": number | null,"book_path": string | null,"cost": number | null,"cover_path": string | null,"created_at": string,"currency": string,"deal": Database["public"]['Enums']["contributor_deal"],"iban": string | null,"iban_doc_path": string | null,"id": string,"legacy_id": number | null,"maker_name": string | null,"ministry_doc_path": string | null,"review_note": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"status": Database["public"]['Enums']["contributor_status"],"title": string,"user_id": string,"whatsapp": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "about"?: string | null,"book_id"?: number | null,"book_path"?: string | null,"cost"?: number | null,"cover_path"?: string | null,"created_at"?: string,"currency"?: string,"deal"?: Database["public"]['Enums']["contributor_deal"],"iban"?: string | null,"iban_doc_path"?: string | null,"id"?: string,"legacy_id"?: number | null,"maker_name"?: string | null,"ministry_doc_path"?: string | null,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: Database["public"]['Enums']["contributor_status"],"title": string,"user_id": string,"whatsapp"?: string | null
                  }
                  Update: {
                    "about"?: string | null,"book_id"?: number | null,"book_path"?: string | null,"cost"?: number | null,"cover_path"?: string | null,"created_at"?: string,"currency"?: string,"deal"?: Database["public"]['Enums']["contributor_deal"],"iban"?: string | null,"iban_doc_path"?: string | null,"id"?: string,"legacy_id"?: number | null,"maker_name"?: string | null,"ministry_doc_path"?: string | null,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: Database["public"]['Enums']["contributor_status"],"title"?: string,"user_id"?: string,"whatsapp"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "contributor_requests_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contributor_requests_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books_readiness"
      referencedColumns: ["book_id"]
    },{
      foreignKeyName: "contributor_requests_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contributor_requests_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"entitlements": {
                  Row: {
                    "book_id": number,"granted_at": string,"id": number,"is_test": boolean,"order_item_id": number | null,"revoked_at": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "book_id": number,"granted_at"?: string,"id"?: never,"is_test"?: boolean,"order_item_id"?: number | null,"revoked_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "book_id"?: number,"granted_at"?: string,"id"?: never,"is_test"?: boolean,"order_item_id"?: number | null,"revoked_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "entitlements_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entitlements_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books_readiness"
      referencedColumns: ["book_id"]
    },{
      foreignKeyName: "entitlements_order_item_id_fkey"
      columns: ["order_item_id"]
isOneToOne: false
      referencedRelation: "order_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entitlements_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"favourites": {
                  Row: {
                    "article_id": number | null,"book_id": number | null,"created_at": string,"id": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "article_id"?: number | null,"book_id"?: number | null,"created_at"?: string,"id"?: never,"user_id": string
                  }
                  Update: {
                    "article_id"?: number | null,"book_id"?: number | null,"created_at"?: string,"id"?: never,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "favourites_article_id_fkey"
      columns: ["article_id"]
isOneToOne: false
      referencedRelation: "articles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "favourites_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "favourites_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books_readiness"
      referencedColumns: ["book_id"]
    },{
      foreignKeyName: "favourites_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"legacy_id_map": {
                  Row: {
                    "entity": string,"legacy_id": string,"new_id": string,"run_id": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "entity": string,"legacy_id": string,"new_id": string,"run_id"?: number | null
                  }
                  Update: {
                    "entity"?: string,"legacy_id"?: string,"new_id"?: string,"run_id"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "legacy_id_map_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "migration_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"legacy_media_staging": {
                  Row: {
                    "av_result": string | null,"batch_id": string | null,"book_media_id": number | null,"byte_size": number,"detected_type": string,"duplicate_of": number | null,"id": number,"legacy_path": string,"mime_type": string | null,"reason": string | null,"scanned_at": string | null,"scope": string | null,"sha256": string,"status": Database["public"]['Enums']["staging_status"],"storage_path": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "av_result"?: string | null,"batch_id"?: string | null,"book_media_id"?: number | null,"byte_size": number,"detected_type": string,"duplicate_of"?: number | null,"id"?: never,"legacy_path": string,"mime_type"?: string | null,"reason"?: string | null,"scanned_at"?: string | null,"scope"?: string | null,"sha256": string,"status"?: Database["public"]['Enums']["staging_status"],"storage_path"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "av_result"?: string | null,"batch_id"?: string | null,"book_media_id"?: number | null,"byte_size"?: number,"detected_type"?: string,"duplicate_of"?: number | null,"id"?: never,"legacy_path"?: string,"mime_type"?: string | null,"reason"?: string | null,"scanned_at"?: string | null,"scope"?: string | null,"sha256"?: string,"status"?: Database["public"]['Enums']["staging_status"],"storage_path"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "legacy_media_staging_book_media_id_fkey"
      columns: ["book_media_id"]
isOneToOne: false
      referencedRelation: "book_media"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "legacy_media_staging_book_media_id_fkey"
      columns: ["book_media_id"]
isOneToOne: false
      referencedRelation: "book_media_readiness"
      referencedColumns: ["media_id"]
    },{
      foreignKeyName: "legacy_media_staging_duplicate_of_fkey"
      columns: ["duplicate_of"]
isOneToOne: false
      referencedRelation: "legacy_media_staging"
      referencedColumns: ["id"]
    }
                  ]
                },"makers": {
                  Row: {
                    "bio_html": string | null,"created_at": string,"deleted_at": string | null,"era": Database["public"]['Enums']["maker_era"],"id": number,"image_path": string | null,"is_active": boolean,"is_demo": boolean,"kind": Database["public"]['Enums']["maker_kind"],"legacy_id": number | null,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bio_html"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"era"?: Database["public"]['Enums']["maker_era"],"id"?: never,"image_path"?: string | null,"is_active"?: boolean,"is_demo"?: boolean,"kind"?: Database["public"]['Enums']["maker_kind"],"legacy_id"?: number | null,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "bio_html"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"era"?: Database["public"]['Enums']["maker_era"],"id"?: never,"image_path"?: string | null,"is_active"?: boolean,"is_demo"?: boolean,"kind"?: Database["public"]['Enums']["maker_kind"],"legacy_id"?: number | null,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"migration_rejects": {
                  Row: {
                    "entity": string,"id": number,"legacy_id": string | null,"payload": Json | null,"reason": string,"run_id": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "entity": string,"id"?: never,"legacy_id"?: string | null,"payload"?: Json | null,"reason": string,"run_id"?: number | null
                  }
                  Update: {
                    "entity"?: string,"id"?: never,"legacy_id"?: string | null,"payload"?: Json | null,"reason"?: string,"run_id"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "migration_rejects_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "migration_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"migration_runs": {
                  Row: {
                    "counts": NonNullable<Json>,"dry_run": boolean,"finished_at": string | null,"id": number,"kind": string,"notes": string | null,"started_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "counts"?: NonNullable<Json>,"dry_run"?: boolean,"finished_at"?: string | null,"id"?: never,"kind": string,"notes"?: string | null,"started_at"?: string
                  }
                  Update: {
                    "counts"?: NonNullable<Json>,"dry_run"?: boolean,"finished_at"?: string | null,"id"?: never,"kind"?: string,"notes"?: string | null,"started_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"order_items": {
                  Row: {
                    "book_id": number | null,"book_tax": number | null,"cart_fee": number | null,"id": number,"legacy_book_id": number | null,"legacy_item_id": number | null,"legacy_raw_cost": string | null,"net_total": number | null,"order_id": string,"selling_fee": number | null,"selling_fee_tax": number | null,"title_snapshot": string,"unit_price": number
                  }
                  ComputedFields: never
                  Insert: {
                    "book_id"?: number | null,"book_tax"?: number | null,"cart_fee"?: number | null,"id"?: never,"legacy_book_id"?: number | null,"legacy_item_id"?: number | null,"legacy_raw_cost"?: string | null,"net_total"?: number | null,"order_id": string,"selling_fee"?: number | null,"selling_fee_tax"?: number | null,"title_snapshot": string,"unit_price": number
                  }
                  Update: {
                    "book_id"?: number | null,"book_tax"?: number | null,"cart_fee"?: number | null,"id"?: never,"legacy_book_id"?: number | null,"legacy_item_id"?: number | null,"legacy_raw_cost"?: string | null,"net_total"?: number | null,"order_id"?: string,"selling_fee"?: number | null,"selling_fee_tax"?: number | null,"title_snapshot"?: string,"unit_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_items_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books_readiness"
      referencedColumns: ["book_id"]
    },{
      foreignKeyName: "order_items_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "affiliate_id": string | null,"created_at": string,"currency": string,"deleted_at": string | null,"id": string,"legacy_invoice_id": string | null,"legacy_order_id": number | null,"legacy_raw_amount": string | null,"legacy_response": Json | null,"mode": Database["public"]['Enums']["data_mode"],"order_no": number,"payment_id": string | null,"status": Database["public"]['Enums']["order_status"],"total_amount": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "affiliate_id"?: string | null,"created_at"?: string,"currency": string,"deleted_at"?: string | null,"id"?: string,"legacy_invoice_id"?: string | null,"legacy_order_id"?: number | null,"legacy_raw_amount"?: string | null,"legacy_response"?: Json | null,"mode": Database["public"]['Enums']["data_mode"],"order_no"?: never,"payment_id"?: string | null,"status"?: Database["public"]['Enums']["order_status"],"total_amount": number,"user_id": string
                  }
                  Update: {
                    "affiliate_id"?: string | null,"created_at"?: string,"currency"?: string,"deleted_at"?: string | null,"id"?: string,"legacy_invoice_id"?: string | null,"legacy_order_id"?: number | null,"legacy_raw_amount"?: string | null,"legacy_response"?: Json | null,"mode"?: Database["public"]['Enums']["data_mode"],"order_no"?: never,"payment_id"?: string | null,"status"?: Database["public"]['Enums']["order_status"],"total_amount"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_affiliate_id_fkey"
      columns: ["affiliate_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: true
      referencedRelation: "payments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"pages": {
                  Row: {
                    "content_html": string | null,"created_at": string,"deleted_at": string | null,"id": number,"is_demo": boolean,"legacy_id": number | null,"positions": (string)[],"slug": string,"status": Database["public"]['Enums']["content_status"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content_html"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: never,"is_demo"?: boolean,"legacy_id"?: number | null,"positions"?: (string)[],"slug": string,"status"?: Database["public"]['Enums']["content_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "content_html"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: never,"is_demo"?: boolean,"legacy_id"?: number | null,"positions"?: (string)[],"slug"?: string,"status"?: Database["public"]['Enums']["content_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"payment_events": {
                  Row: {
                    "event_id": string,"event_type": string | null,"id": number,"payload": Json | null,"payment_id": string | null,"provider": string,"received_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "event_id": string,"event_type"?: string | null,"id"?: never,"payload"?: Json | null,"payment_id"?: string | null,"provider": string,"received_at"?: string
                  }
                  Update: {
                    "event_id"?: string,"event_type"?: string | null,"id"?: never,"payload"?: Json | null,"payment_id"?: string | null,"provider"?: string,"received_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_events_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "affiliate_id": string | null,"amount": number,"cart_snapshot": NonNullable<Json>,"created_at": string,"currency": string,"expires_at": string,"fulfilled_at": string | null,"fx_rate": number,"id": string,"mode": Database["public"]['Enums']["data_mode"],"order_id": string | null,"paid_at": string | null,"provider": string,"provider_transaction_id": string | null,"raw_response": Json | null,"reference": string,"status": Database["public"]['Enums']["payment_status"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "affiliate_id"?: string | null,"amount": number,"cart_snapshot": NonNullable<Json>,"created_at"?: string,"currency": string,"expires_at"?: string,"fulfilled_at"?: string | null,"fx_rate"?: number,"id"?: string,"mode"?: Database["public"]['Enums']["data_mode"],"order_id"?: string | null,"paid_at"?: string | null,"provider": string,"provider_transaction_id"?: string | null,"raw_response"?: Json | null,"reference"?: string,"status"?: Database["public"]['Enums']["payment_status"],"user_id": string
                  }
                  Update: {
                    "affiliate_id"?: string | null,"amount"?: number,"cart_snapshot"?: NonNullable<Json>,"created_at"?: string,"currency"?: string,"expires_at"?: string,"fulfilled_at"?: string | null,"fx_rate"?: number,"id"?: string,"mode"?: Database["public"]['Enums']["data_mode"],"order_id"?: string | null,"paid_at"?: string | null,"provider"?: string,"provider_transaction_id"?: string | null,"raw_response"?: Json | null,"reference"?: string,"status"?: Database["public"]['Enums']["payment_status"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_affiliate_id_fkey"
      columns: ["affiliate_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_order_fk"
      columns: ["order_id"]
isOneToOne: true
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"payout_methods": {
                  Row: {
                    "affiliate_id": string,"created_at": string,"details": NonNullable<Json>,"id": number,"is_active": boolean,"kind": string
                  }
                  ComputedFields: never
                  Insert: {
                    "affiliate_id": string,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: never,"is_active"?: boolean,"kind": string
                  }
                  Update: {
                    "affiliate_id"?: string,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: never,"is_active"?: boolean,"kind"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payout_methods_affiliate_id_fkey"
      columns: ["affiliate_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "country": string | null,"country_code": string | null,"created_at": string,"deleted_at": string | null,"display_name": string,"id": string,"is_affiliate": boolean,"legacy_user_id": number | null,"phone": string | null,"region": string | null,"require_password_reset": boolean,"status": Database["public"]['Enums']["account_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "country"?: string | null,"country_code"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"display_name"?: string,"id": string,"is_affiliate"?: boolean,"legacy_user_id"?: number | null,"phone"?: string | null,"region"?: string | null,"require_password_reset"?: boolean,"status"?: Database["public"]['Enums']["account_status"],"updated_at"?: string
                  }
                  Update: {
                    "country"?: string | null,"country_code"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"display_name"?: string,"id"?: string,"is_affiliate"?: boolean,"legacy_user_id"?: number | null,"phone"?: string | null,"region"?: string | null,"require_password_reset"?: boolean,"status"?: Database["public"]['Enums']["account_status"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"site_settings": {
                  Row: {
                    "affiliate_commission_percent": number,"allow_test_payments": boolean,"base_currency": string,"broadcast": string | null,"commission_freeze_days": number,"description": string | null,"email": string | null,"facebook": string | null,"id": number,"instagram": string | null,"keywords": string | null,"linkedin": string | null,"logo_path": string | null,"min_withdrawal_amount": number,"payment_mode": Database["public"]['Enums']["data_mode"],"pending_owner_confirmation": (string)[],"phone": string | null,"poster_mobile_path": string | null,"poster_path": string | null,"require_admin_mfa": boolean,"show_free_book_button": boolean,"show_poster_desktop": boolean,"show_poster_mobile": boolean,"site_name": string,"telegram": string | null,"twitter": string | null,"updated_at": string,"updated_by": string | null,"whatsapp": string | null,"youtube": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "affiliate_commission_percent"?: number,"allow_test_payments"?: boolean,"base_currency"?: string,"broadcast"?: string | null,"commission_freeze_days"?: number,"description"?: string | null,"email"?: string | null,"facebook"?: string | null,"id"?: number,"instagram"?: string | null,"keywords"?: string | null,"linkedin"?: string | null,"logo_path"?: string | null,"min_withdrawal_amount"?: number,"payment_mode"?: Database["public"]['Enums']["data_mode"],"pending_owner_confirmation"?: (string)[],"phone"?: string | null,"poster_mobile_path"?: string | null,"poster_path"?: string | null,"require_admin_mfa"?: boolean,"show_free_book_button"?: boolean,"show_poster_desktop"?: boolean,"show_poster_mobile"?: boolean,"site_name"?: string,"telegram"?: string | null,"twitter"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"whatsapp"?: string | null,"youtube"?: string | null
                  }
                  Update: {
                    "affiliate_commission_percent"?: number,"allow_test_payments"?: boolean,"base_currency"?: string,"broadcast"?: string | null,"commission_freeze_days"?: number,"description"?: string | null,"email"?: string | null,"facebook"?: string | null,"id"?: number,"instagram"?: string | null,"keywords"?: string | null,"linkedin"?: string | null,"logo_path"?: string | null,"min_withdrawal_amount"?: number,"payment_mode"?: Database["public"]['Enums']["data_mode"],"pending_owner_confirmation"?: (string)[],"phone"?: string | null,"poster_mobile_path"?: string | null,"poster_path"?: string | null,"require_admin_mfa"?: boolean,"show_free_book_button"?: boolean,"show_poster_desktop"?: boolean,"show_poster_mobile"?: boolean,"site_name"?: string,"telegram"?: string | null,"twitter"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"whatsapp"?: string | null,"youtube"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"user_roles": {
                  Row: {
                    "granted_at": string,"granted_by": string | null,"role": Database["public"]['Enums']["app_role"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "granted_at"?: string,"granted_by"?: string | null,"role": Database["public"]['Enums']["app_role"],"user_id": string
                  }
                  Update: {
                    "granted_at"?: string,"granted_by"?: string | null,"role"?: Database["public"]['Enums']["app_role"],"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"withdrawal_requests": {
                  Row: {
                    "affiliate_id": string,"amount": number,"currency": string,"decided_at": string | null,"decided_by": string | null,"id": string,"legacy_id": number | null,"legacy_raw": Json | null,"note": string | null,"payout_kind": string | null,"proof_path": string | null,"requested_at": string,"status": Database["public"]['Enums']["withdrawal_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "affiliate_id": string,"amount": number,"currency": string,"decided_at"?: string | null,"decided_by"?: string | null,"id"?: string,"legacy_id"?: number | null,"legacy_raw"?: Json | null,"note"?: string | null,"payout_kind"?: string | null,"proof_path"?: string | null,"requested_at"?: string,"status"?: Database["public"]['Enums']["withdrawal_status"]
                  }
                  Update: {
                    "affiliate_id"?: string,"amount"?: number,"currency"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"id"?: string,"legacy_id"?: number | null,"legacy_raw"?: Json | null,"note"?: string | null,"payout_kind"?: string | null,"proof_path"?: string | null,"requested_at"?: string,"status"?: Database["public"]['Enums']["withdrawal_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "withdrawal_requests_affiliate_id_fkey"
      columns: ["affiliate_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "withdrawal_requests_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "book_media_readiness": {
                  Row: {
                    "book_id": number,"checksum_verified_at": string | null,"has_hash": boolean | null,"is_external": boolean,"kind": Database["public"]['Enums']["media_kind"],"legacy_book_media_id": number | null,"legacy_path": string | null,"media_id": number,"migration_status": Database["public"]['Enums']["media_migration_status"],"name": string,"storage_provider": Database["public"]['Enums']["media_storage_provider"],"validated": boolean | null,"visibility": Database["public"]['Enums']["media_visibility"]
                  }
                  ComputedFields: never
                  Insert: {
                           "book_id"?: number | null,"checksum_verified_at"?: string | null,"has_hash"?: never,"is_external"?: boolean | null,"kind"?: Database["public"]['Enums']["media_kind"] | null,"legacy_book_media_id"?: number | null,"legacy_path"?: string | null,"media_id"?: number | null,"migration_status"?: Database["public"]['Enums']["media_migration_status"] | null,"name"?: string | null,"storage_provider"?: Database["public"]['Enums']["media_storage_provider"] | null,"validated"?: never,"visibility"?: Database["public"]['Enums']["media_visibility"] | null
                         }
                        Update: {
                           "book_id"?: number | null,"checksum_verified_at"?: string | null,"has_hash"?: never,"is_external"?: boolean | null,"kind"?: Database["public"]['Enums']["media_kind"] | null,"legacy_book_media_id"?: number | null,"legacy_path"?: string | null,"media_id"?: number | null,"migration_status"?: Database["public"]['Enums']["media_migration_status"] | null,"name"?: string | null,"storage_provider"?: Database["public"]['Enums']["media_storage_provider"] | null,"validated"?: never,"visibility"?: Database["public"]['Enums']["media_visibility"] | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "book_media_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "book_media_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books_readiness"
      referencedColumns: ["book_id"]
    }
                  ]
                },"books_readiness": {
                  Row: {
                    "book_id": number,"cover_path": string | null,"eligible": boolean | null,"import_run_id": number | null,"kind": Database["public"]['Enums']["book_kind"],"legacy_cost_raw": string | null,"legacy_id": number | null,"legacy_status_raw": string | null,"legacy_verified_at": string | null,"media_missing": number | null,"media_total": number | null,"media_validated": number | null,"price_amount": number,"provenance": string,"reasons": (string)[] | null,"status": Database["public"]['Enums']["content_status"],"title": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "books_import_run_id_fkey"
      columns: ["import_run_id"]
isOneToOne: false
      referencedRelation: "migration_runs"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "admin_affiliate_overview":
{ Args: Record<PropertyKey, never>; Returns: {
              "available": number,"created_at": string,"display_name": string,"earned": number,"email": string,"frozen": number,"id": string,"phone": string,"status": Database["public"]['Enums']["account_status"]
            }[]
                           },
"admin_list_users":
{ Args: { "p_limit": number,"p_offset": number,"p_q": string,"p_status": string }; Returns: {
              "created_at": string,"deleted_at": string,"display_name": string,"email": string,"id": string,"is_affiliate": boolean,"status": Database["public"]['Enums']["account_status"],"total_count": number
            }[]
                           },
"affiliate_balance":
{ Args: { "p_affiliate": string }; Returns: {
              "available": number,"currency": string,"frozen": number,"paid_out": number,"pending_withdrawal": number
            }[]
                           },
"approve_contributor_request":
{ Args: { "p_admin": string,"p_note"?: string,"p_request": string }; Returns: number
                           },
"book_comments":
{ Args: { "p_book": number }; Returns: {
              "author_name": string,"body": string,"created_at": string,"id": number,"is_mine": boolean
            }[]
                           },
"book_media_is_validated":
{ Args: { "m": Omit<Database["public"]['Tables']["book_media"]['Row'], Database["public"]['Tables']["book_media"]['ComputedFields']> }; Returns: boolean
                           },
"book_readiness":
{ Args: { "p_book": number }; Returns: {
              "eligible": boolean,"reasons": (string)[]
            }[]
                           },
"book_readiness_row":
{ Args: { "b": Omit<Database["public"]['Tables']["books"]['Row'], Database["public"]['Tables']["books"]['ComputedFields']> }; Returns: (string)[]
                           },
"contributor_book_stats":
{ Args: { "p_user": string }; Returns: {
              "book_id": number,"gross": number,"purchases": number,"views": number
            }[]
                           },
"create_payment_for_cart":
{ Args: { "p_affiliate": string,"p_book_ids": (number)[],"p_mode": Database["public"]['Enums']["data_mode"],"p_provider": string,"p_user": string }; Returns: {
              "affiliate_id": string | null,
"amount": number,
"cart_snapshot": NonNullable<Json>,
"created_at": string,
"currency": string,
"expires_at": string,
"fulfilled_at": string | null,
"fx_rate": number,
"id": string,
"mode": Database["public"]['Enums']["data_mode"],
"order_id": string | null,
"paid_at": string | null,
"provider": string,
"provider_transaction_id": string | null,
"raw_response": Json | null,
"reference": string,
"status": Database["public"]['Enums']["payment_status"],
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "payments"
        isOneToOne: true
        isSetofReturn: false
      } },
"decide_withdrawal":
{ Args: { "p_admin": string,"p_approve": boolean,"p_note"?: string,"p_proof_path"?: string,"p_request": string }; Returns: undefined
                           },
"decline_contributor_request":
{ Args: { "p_admin": string,"p_note"?: string,"p_request": string }; Returns: undefined
                           },
"fail_payment":
{ Args: { "p_payment_id": string,"p_raw"?: Json,"p_status": Database["public"]['Enums']["payment_status"] }; Returns: undefined
                           },
"find_user_id_by_email":
{ Args: { "p_email": string }; Returns: string
                           },
"fulfill_payment":
{ Args: { "p_amount": number,"p_currency": string,"p_payment_id": string,"p_provider_txn": string,"p_raw"?: Json }; Returns: string
                           },
"increment_media_download":
{ Args: { "p_media": number }; Returns: undefined
                           },
"increment_view":
{ Args: { "p_entity": string,"p_id": number }; Returns: undefined
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_affiliate":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"normalize_ar":
{ Args: { "p": string }; Returns: string
                           },
"owns_book":
{ Args: { "p_book": number }; Returns: boolean
                           },
"promote_eligible_books":
{ Args: { "p_run"?: number }; Returns: {
              "book_id": number,"new_status": Database["public"]['Enums']["content_status"]
            }[]
                           },
"purge_demo_data":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"register_payment_event":
{ Args: { "p_event_id": string,"p_payload": Json,"p_payment_id": string,"p_provider": string,"p_type": string }; Returns: boolean
                           },
"request_withdrawal":
{ Args: { "p_affiliate": string,"p_amount": number }; Returns: string
                           },
"site_totals":
{ Args: Record<PropertyKey, never>; Returns: {
              "articles": number,"books": number,"views": number
            }[]
                           },
"verify_legacy_run":
{ Args: { "p_admin": string,"p_run": number }; Returns: number
                           }
          }
          Enums: {
            "account_status": "active"|"review"|"banned","app_role": "admin","article_kind": "article"|"video"|"ads","book_kind": "paid"|"free","comment_status": "pending"|"approved"|"rejected","content_status": "draft"|"published"|"coming_soon"|"archived","contributor_deal": "share"|"rent","contributor_status": "pending"|"approved"|"declined","data_mode": "live"|"test","ledger_entry_type": "commission"|"withdrawal_hold"|"withdrawal_release"|"adjustment"|"reversal","maker_era": "old"|"new","maker_kind": "author"|"reader"|"writer","media_kind": "file"|"audio","media_migration_status": "pending"|"staged"|"available"|"missing"|"rejected","media_storage_provider": "none"|"supabase"|"vps"|"external","media_visibility": "preview"|"after_purchase","order_status": "paid"|"failed"|"refunded","payment_status": "pending"|"succeeded"|"failed"|"cancelled"|"expired","staging_status": "inventoried"|"quarantined"|"staged"|"linked"|"missing"|"rejected","withdrawal_status": "pending"|"paid"|"rejected"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "account_status": ["active", "review", "banned"],"app_role": ["admin"],"article_kind": ["article", "video", "ads"],"book_kind": ["paid", "free"],"comment_status": ["pending", "approved", "rejected"],"content_status": ["draft", "published", "coming_soon", "archived"],"contributor_deal": ["share", "rent"],"contributor_status": ["pending", "approved", "declined"],"data_mode": ["live", "test"],"ledger_entry_type": ["commission", "withdrawal_hold", "withdrawal_release", "adjustment", "reversal"],"maker_era": ["old", "new"],"maker_kind": ["author", "reader", "writer"],"media_kind": ["file", "audio"],"media_migration_status": ["pending", "staged", "available", "missing", "rejected"],"media_storage_provider": ["none", "supabase", "vps", "external"],"media_visibility": ["preview", "after_purchase"],"order_status": ["paid", "failed", "refunded"],"payment_status": ["pending", "succeeded", "failed", "cancelled", "expired"],"staging_status": ["inventoried", "quarantined", "staged", "linked", "missing", "rejected"],"withdrawal_status": ["pending", "paid", "rejected"]
          }
        }
} as const
