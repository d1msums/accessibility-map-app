-- Person 3: core schema — pins, reports, confirmations/disputes, points.
-- Rewritten to match API_CONTRACT.md exactly (column names, table names, and
-- the confirm_pin / dispute_pin / award_points RPCs the contract already
-- documents as existing). The previous version of this file used different
-- column names (latitude/longitude, no trust_score/color_band, no
-- claimed_type) that didn't match the contract or the Edge Functions that
-- read/write these tables -- every function in this repo was written against
-- the contract's shape, not this file's old shape.

create extension if not exists pgcrypto; -- gen_random_uuid()

create table pins (
  id                uuid primary key default gen_random_uuid(),
  lat               float8 not null,
  lng               float8 not null,
  type              text not null check (type in ('ramp', 'lift', 'obstacle')),
  trust_score       float8 not null default 100,
  color_band        text not null default '🟢' check (color_band in ('🟢', '🟡', '🟠', '🔴')),
  last_confirmed_at timestamptz,
  created_at        timestamptz not null default now()
);

create table reports (
  id            uuid primary key default gen_random_uuid(),
  pin_id        uuid not null references pins(id) on delete cascade,
  photo_url     text,
  description   text,
  claimed_type  text not null check (claimed_type in ('ramp', 'lift', 'obstacle')),
  ai_verified   boolean,          -- null until verify-photo runs
  ai_confidence float8,
  user_id       text,             -- device id, no real auth (see API_CONTRACT open questions)
  created_at    timestamptz not null default now()
);

create table confirmations_disputes (
  id         uuid primary key default gen_random_uuid(),
  pin_id     uuid not null references pins(id) on delete cascade,
  report_id  uuid references reports(id) on delete set null,
  action     text not null check (action in ('confirm', 'dispute')),
  user_id    text not null,
  created_at timestamptz not null default now()
);

create table points (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null,
  action_type     text not null check (action_type in ('report', 'confirm', 'dispute')),
  points_awarded  int not null,
  created_at      timestamptz not null default now()
);

create index idx_reports_pin_id on reports(pin_id);
create index idx_confirmations_disputes_pin_id on confirmations_disputes(pin_id);
create index idx_points_user_id on points(user_id);

-- ---------------------------------------------------------------------------
-- Trust score -> color band. Placeholder thresholds -- confirm with Sofea,
-- this is one of the "open questions" API_CONTRACT.md already flags.
-- ---------------------------------------------------------------------------
create or replace function compute_color_band(p_trust_score float8)
returns text
language sql
immutable
as $$
  select case
    when p_trust_score >= 80 then '🟢'
    when p_trust_score >= 50 then '🟡'
    when p_trust_score >= 25 then '🟠'
    else '🔴'
  end;
$$;

-- ---------------------------------------------------------------------------
-- award_points: used standalone by the frontend after a report insert
-- (API_CONTRACT.md section 3). confirm_pin/dispute_pin award their own
-- points internally, so the frontend never calls this for those actions.
-- Placeholder amounts per the task-breakdown doc: +10 report, +5 confirm, +15 dispute.
-- ---------------------------------------------------------------------------
create or replace function award_points(p_user_id text, p_action_type text)
returns table (points_awarded int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points int;
begin
  v_points := case p_action_type
    when 'report' then 10
    when 'confirm' then 5
    when 'dispute' then 15
    else null
  end;

  if v_points is null then
    raise exception 'Unknown action_type: %', p_action_type;
  end if;

  insert into points (user_id, action_type, points_awarded)
  values (p_user_id, p_action_type, v_points);

  return query select v_points;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_pin: resets trust to full, logs the action, awards points.
-- ---------------------------------------------------------------------------
create or replace function confirm_pin(p_pin_id uuid, p_user_id text)
returns table (pin_id uuid, new_trust_score float8, new_color_band text, points_awarded int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_score float8 := 100;
  v_new_band  text := compute_color_band(v_new_score);
begin
  insert into confirmations_disputes (pin_id, action, user_id)
  values (p_pin_id, 'confirm', p_user_id);

  update pins
  set trust_score = v_new_score,
      color_band = v_new_band,
      last_confirmed_at = now()
  where id = p_pin_id;

  insert into points (user_id, action_type, points_awarded)
  values (p_user_id, 'confirm', 5);

  return query select p_pin_id, v_new_score, v_new_band, 5;
end;
$$;

-- ---------------------------------------------------------------------------
-- dispute_pin: drops trust by a fixed decrement (placeholder magnitude --
-- confirm with Sofea), logs the action, awards points.
-- ---------------------------------------------------------------------------
create or replace function dispute_pin(p_pin_id uuid, p_user_id text)
returns table (pin_id uuid, new_trust_score float8, new_color_band text, points_awarded int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_score float8;
  v_new_score float8;
  v_new_band text;
begin
  select trust_score into v_current_score from pins where id = p_pin_id;
  if v_current_score is null then
    raise exception 'Pin not found: %', p_pin_id;
  end if;

  v_new_score := greatest(0, v_current_score - 35);
  v_new_band := compute_color_band(v_new_score);

  insert into confirmations_disputes (pin_id, action, user_id)
  values (p_pin_id, 'dispute', p_user_id);

  update pins
  set trust_score = v_new_score,
      color_band = v_new_band
  where id = p_pin_id;

  insert into points (user_id, action_type, points_awarded)
  values (p_user_id, 'dispute', 15);

  return query select p_pin_id, v_new_score, v_new_band, 15;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS. API_CONTRACT.md's own open questions flag this as "leave permissive,
-- but a conscious choice, not an oversight" -- this is that conscious choice:
-- public read on everything (the app is a public map), public insert where
-- the app needs it client-side (new pins, reports), but trust_score/
-- color_band/ai_verified/ai_confidence/points can only change through the
-- SECURITY DEFINER functions above or the service role -- never a raw client
-- UPDATE. This matters more than it looks: the anon key is public by design,
-- so without this, anyone holding it could PATCH any pin's trust_score
-- directly over REST.
-- ---------------------------------------------------------------------------
alter table pins enable row level security;
alter table reports enable row level security;
alter table confirmations_disputes enable row level security;
alter table points enable row level security;

create policy "pins are publicly readable" on pins for select using (true);
create policy "anyone can create a pin" on pins for insert with check (true);
-- no update/delete policy for pins: only via confirm_pin/dispute_pin (security definer) or service role

create policy "reports are publicly readable" on reports for select using (true);
create policy "anyone can submit a report" on reports for insert with check (true);
-- no update policy for reports: ai_verified/ai_confidence are only written by verify-photo using the service role key

create policy "confirmations/disputes are publicly readable" on confirmations_disputes for select using (true);
-- no insert policy: only via confirm_pin/dispute_pin (security definer), never a direct client insert

create policy "points are publicly readable" on points for select using (true);
-- no insert policy: only via award_points/confirm_pin/dispute_pin (security definer), never a direct client insert

-- Explicit RPC grants. Postgres's default privileges normally let anon/
-- authenticated call these anyway, but being explicit here means the app
-- doesn't depend on a default that's easy to accidentally tighten later.
grant execute on function compute_color_band(float8) to anon, authenticated;
grant execute on function award_points(text, text) to anon, authenticated;
grant execute on function confirm_pin(uuid, text) to anon, authenticated;
grant execute on function dispute_pin(uuid, text) to anon, authenticated;
