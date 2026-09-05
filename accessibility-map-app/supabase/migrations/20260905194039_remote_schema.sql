drop extension if exists "pg_net";

drop policy "confirmations/disputes are publicly readable" on "public"."confirmations_disputes";

drop policy "anyone can create a pin" on "public"."pins";

drop policy "pins are publicly readable" on "public"."pins";

drop policy "points are publicly readable" on "public"."points";

drop policy "anyone can submit a report" on "public"."reports";

drop policy "reports are publicly readable" on "public"."reports";

revoke delete on table "public"."confirmations_disputes" from "anon";

revoke insert on table "public"."confirmations_disputes" from "anon";

revoke references on table "public"."confirmations_disputes" from "anon";

revoke select on table "public"."confirmations_disputes" from "anon";

revoke trigger on table "public"."confirmations_disputes" from "anon";

revoke truncate on table "public"."confirmations_disputes" from "anon";

revoke update on table "public"."confirmations_disputes" from "anon";

revoke delete on table "public"."confirmations_disputes" from "authenticated";

revoke insert on table "public"."confirmations_disputes" from "authenticated";

revoke references on table "public"."confirmations_disputes" from "authenticated";

revoke select on table "public"."confirmations_disputes" from "authenticated";

revoke trigger on table "public"."confirmations_disputes" from "authenticated";

revoke truncate on table "public"."confirmations_disputes" from "authenticated";

revoke update on table "public"."confirmations_disputes" from "authenticated";

revoke delete on table "public"."confirmations_disputes" from "service_role";

revoke insert on table "public"."confirmations_disputes" from "service_role";

revoke references on table "public"."confirmations_disputes" from "service_role";

revoke select on table "public"."confirmations_disputes" from "service_role";

revoke trigger on table "public"."confirmations_disputes" from "service_role";

revoke truncate on table "public"."confirmations_disputes" from "service_role";

revoke update on table "public"."confirmations_disputes" from "service_role";

alter table "public"."confirmations_disputes" drop constraint "confirmations_disputes_action_check";

alter table "public"."confirmations_disputes" drop constraint "confirmations_disputes_pin_id_fkey";

alter table "public"."confirmations_disputes" drop constraint "confirmations_disputes_report_id_fkey";

alter table "public"."pins" drop constraint "pins_color_band_check";

alter table "public"."points" drop constraint "points_action_type_check";

alter table "public"."reports" drop constraint "reports_claimed_type_check";

alter table "public"."route_segments" drop constraint "route_segments_source_check";

drop function if exists "public"."award_points"(p_user_id text, p_action_type text);

drop function if exists "public"."compute_color_band"(p_trust_score double precision);

drop function if exists "public"."confirm_pin"(p_pin_id uuid, p_user_id text);

drop function if exists "public"."dispute_pin"(p_pin_id uuid, p_user_id text);

alter table "public"."confirmations_disputes" drop constraint "confirmations_disputes_pkey";

drop index if exists "public"."confirmations_disputes_pkey";

drop index if exists "public"."idx_confirmations_disputes_pin_id";

drop index if exists "public"."idx_points_user_id";

drop index if exists "public"."idx_reports_pin_id";

drop table "public"."confirmations_disputes";


  create table "public"."confirmations" (
    "id" uuid not null default gen_random_uuid(),
    "report_id" uuid,
    "user_id" uuid,
    "type" text not null,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."confirmations" enable row level security;

alter table "public"."pins" drop column "color_band";

alter table "public"."pins" drop column "last_confirmed_at";

alter table "public"."pins" drop column "lat";

alter table "public"."pins" drop column "lng";

alter table "public"."pins" drop column "trust_score";

alter table "public"."pins" add column "latitude" double precision not null;

alter table "public"."pins" add column "longitude" double precision not null;

alter table "public"."points" drop column "action_type";

alter table "public"."points" drop column "points_awarded";

alter table "public"."points" add column "amount" integer not null;

alter table "public"."points" add column "reason" text not null;

alter table "public"."points" alter column "user_id" set data type uuid using "user_id"::uuid;

alter table "public"."reports" drop column "claimed_type";

alter table "public"."reports" alter column "ai_confidence" set data type numeric using "ai_confidence"::numeric;

alter table "public"."reports" alter column "pin_id" drop not null;

alter table "public"."reports" alter column "user_id" set data type uuid using "user_id"::uuid;

alter table "public"."route_segments" alter column "heading" drop default;

alter table "public"."route_segments" alter column "heading" drop not null;

alter table "public"."route_segments" enable row level security;

CREATE UNIQUE INDEX confirmations_pkey ON public.confirmations USING btree (id);

alter table "public"."confirmations" add constraint "confirmations_pkey" PRIMARY KEY using index "confirmations_pkey";

alter table "public"."confirmations" add constraint "confirmations_report_id_fkey" FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE CASCADE not valid;

alter table "public"."confirmations" validate constraint "confirmations_report_id_fkey";

alter table "public"."confirmations" add constraint "confirmations_type_check" CHECK ((type = ANY (ARRAY['confirm'::text, 'dispute'::text]))) not valid;

alter table "public"."confirmations" validate constraint "confirmations_type_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

grant delete on table "public"."confirmations" to "anon";

grant insert on table "public"."confirmations" to "anon";

grant references on table "public"."confirmations" to "anon";

grant select on table "public"."confirmations" to "anon";

grant trigger on table "public"."confirmations" to "anon";

grant truncate on table "public"."confirmations" to "anon";

grant update on table "public"."confirmations" to "anon";

grant delete on table "public"."confirmations" to "authenticated";

grant insert on table "public"."confirmations" to "authenticated";

grant references on table "public"."confirmations" to "authenticated";

grant select on table "public"."confirmations" to "authenticated";

grant trigger on table "public"."confirmations" to "authenticated";

grant truncate on table "public"."confirmations" to "authenticated";

grant update on table "public"."confirmations" to "authenticated";

grant delete on table "public"."confirmations" to "service_role";

grant insert on table "public"."confirmations" to "service_role";

grant references on table "public"."confirmations" to "service_role";

grant select on table "public"."confirmations" to "service_role";

grant trigger on table "public"."confirmations" to "service_role";

grant truncate on table "public"."confirmations" to "service_role";

grant update on table "public"."confirmations" to "service_role";


