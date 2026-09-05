-- Restores everything API_CONTRACT.md (v4) documents that 20260905194039_remote_schema.sql
-- silently dropped or that was never built: pins.trust_score/color_band/last_confirmed_at,
-- the confirm_pin/dispute_pin RPCs, the submit_report RPC (never existed at all), RLS
-- policies (RLS was left enabled with zero policies, so anon/authenticated were denied
-- everything by default), and the entire Ask/Answer system (profiles/requests/answers +
-- answer_request).

-- ---------------------------------------------------------------------------
-- Trust Engine: restore columns the remote_schema migration dropped from pins.
-- ---------------------------------------------------------------------------
alter table pins add column trust_score float8 not null default 100;
alter table pins add column color_band text not null default '🟢' check (color_band in ('🟢', '🟡', '🟠', '🔴'));
alter table pins add column last_confirmed_at timestamptz;

-- confirmations lost pin_id somewhere along the way -- the contract's own shape
-- requires it (confirm_pin/dispute_pin need to know which pin without a join
-- through report_id, and report_id is nullable/settable-null on delete).
alter table confirmations add column pin_id uuid references pins(id) on delete cascade;
update confirmations c set pin_id = r.pin_id from reports r where c.report_id = r.id;
alter table confirmations alter column pin_id set not null;

alter table confirmations drop constraint confirmations_report_id_fkey;
alter table confirmations add constraint confirmations_report_id_fkey
  foreign key (report_id) references reports(id) on delete set null;

create index if not exists idx_confirmations_pin_id on confirmations(pin_id);
create index if not exists idx_reports_pin_id on reports(pin_id);
create index if not exists idx_points_user_id on points(user_id);

-- ---------------------------------------------------------------------------
-- compute_color_band
-- ---------------------------------------------------------------------------
create or replace function compute_color_band(p_trust_score float8)
returns text
language sql
immutable
as $$
  select case
    when p_trust_score >= 75 then '🟢'
    when p_trust_score >= 50 then '🟡'
    when p_trust_score >= 25 then '🟠'
    else '🔴'
  end;
$$;

-- ---------------------------------------------------------------------------
-- submit_report: atomic report submission. Creates a new pin if p_pin_id is
-- null (using lat/lng/type), inserts the report, logs +10 points.
-- ---------------------------------------------------------------------------
create or replace function submit_report(
  p_pin_id uuid,
  p_user_id uuid,
  p_photo_url text,
  p_description text,
  p_lat float8 default null,
  p_lng float8 default null,
  p_type text default null
)
returns table (report_id uuid, pin_id uuid, points_awarded int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pin_id uuid := p_pin_id;
  v_report_id uuid;
begin
  if v_pin_id is null then
    if p_lat is null or p_lng is null or p_type is null then
      raise exception 'p_lat, p_lng and p_type are required when p_pin_id is null';
    end if;

    insert into pins (latitude, longitude, type)
    values (p_lat, p_lng, p_type)
    returning id into v_pin_id;
  end if;

  insert into reports (pin_id, user_id, photo_url, description)
  values (v_pin_id, p_user_id, p_photo_url, p_description)
  returning id into v_report_id;

  insert into points (user_id, amount, reason)
  values (p_user_id, 10, 'report');

  return query select v_report_id, v_pin_id, 10;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_pin: resets trust to full, logs the action, awards points.
-- ---------------------------------------------------------------------------
create or replace function confirm_pin(p_pin_id uuid, p_user_id uuid, p_report_id uuid default null)
returns table (pin_id uuid, new_trust_score float8, new_color_band text, points_awarded int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_score float8 := 100;
  v_new_band  text := compute_color_band(v_new_score);
begin
  insert into confirmations (pin_id, report_id, user_id, type)
  values (p_pin_id, p_report_id, p_user_id, 'confirm');

  update pins
  set trust_score = v_new_score,
      color_band = v_new_band,
      last_confirmed_at = now()
  where id = p_pin_id;

  insert into points (user_id, amount, reason)
  values (p_user_id, 5, 'confirm');

  return query select p_pin_id, v_new_score, v_new_band, 5;
end;
$$;

-- ---------------------------------------------------------------------------
-- dispute_pin: halves current trust score, logs the action, awards points.
-- ---------------------------------------------------------------------------
create or replace function dispute_pin(p_pin_id uuid, p_user_id uuid, p_report_id uuid default null)
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

  v_new_score := v_current_score / 2;
  v_new_band := compute_color_band(v_new_score);

  insert into confirmations (pin_id, report_id, user_id, type)
  values (p_pin_id, p_report_id, p_user_id, 'dispute');

  update pins
  set trust_score = v_new_score,
      color_band = v_new_band
  where id = p_pin_id;

  insert into points (user_id, amount, reason)
  values (p_user_id, 15, 'dispute');

  return query select p_pin_id, v_new_score, v_new_band, 15;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: pins/reports are publicly readable and directly insertable (kept for
-- flexibility even though submit_report is the documented path -- it's a
-- SECURITY DEFINER function owned by a superuser role so it bypasses RLS
-- regardless). confirmations/points are publicly readable only -- they are
-- never written directly by a client, only through the SECURITY DEFINER RPCs
-- above, so no insert policy for them.
-- ---------------------------------------------------------------------------
create policy "pins are publicly readable" on pins for select using (true);
create policy "anyone can create a pin" on pins for insert with check (true);

create policy "reports are publicly readable" on reports for select using (true);
create policy "anyone can submit a report" on reports for insert with check (true);

create policy "confirmations are publicly readable" on confirmations for select using (true);

create policy "points are publicly readable" on points for select using (true);

grant execute on function compute_color_band(float8) to anon, authenticated;
grant execute on function submit_report(uuid, uuid, text, text, float8, float8, text) to anon, authenticated;
grant execute on function confirm_pin(uuid, uuid, uuid) to anon, authenticated;
grant execute on function dispute_pin(uuid, uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ask/Answer system
-- ---------------------------------------------------------------------------
create table profiles (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null unique,
  role             text not null check (role in ('oku', 'helper')),
  display_name     text,
  points           integer not null default 0,
  day_streak       integer not null default 0,
  last_active_date date,
  created_at       timestamptz not null default now()
);

create table requests (
  id            uuid primary key default gen_random_uuid(),
  oku_user_id   uuid not null references profiles(user_id),
  question      text not null,
  location_name text,
  latitude      float8 not null,
  longitude     float8 not null,
  urgency       text not null check (urgency in ('needed_today', 'this_week', 'whenever')),
  status        text not null default 'open' check (status in ('open', 'answered')),
  created_at    timestamptz not null default now()
);

create table answers (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references requests(id) on delete cascade,
  helper_user_id uuid not null references profiles(user_id),
  answer         text not null check (answer in ('yes', 'no', 'partial')),
  photo_url      text,
  points_awarded integer not null,
  created_at     timestamptz not null default now()
);

create index idx_requests_oku_user_id on requests(oku_user_id);
create index idx_requests_status on requests(status);
create index idx_answers_request_id on answers(request_id);
create index idx_answers_helper_user_id on answers(helper_user_id);

alter table profiles enable row level security;
alter table requests enable row level security;
alter table answers enable row level security;

create policy "profiles are publicly readable" on profiles for select using (true);
create policy "anyone can create their own profile" on profiles for insert with check (true);
-- no update policy: profiles.points is kept in sync only via answer_request (security definer)

create policy "requests are publicly readable" on requests for select using (true);
create policy "anyone can ask a question" on requests for insert with check (true);
-- no update policy: status flips to 'answered' only via answer_request (security definer)

create policy "answers are publicly readable" on answers for select using (true);
-- no insert policy: only via answer_request (security definer), enforces the duplicate-answer guard

-- ---------------------------------------------------------------------------
-- answer_request: atomic answer submission. Inserts the answer, marks the
-- request answered, logs points, and updates the helper's running points
-- total. Blocks duplicate answers on an already-answered request.
-- ---------------------------------------------------------------------------
create or replace function answer_request(
  p_request_id uuid,
  p_helper_user_id uuid,
  p_answer text,
  p_photo_url text default null,
  p_points_awarded int default 35
)
returns table (answer_id uuid, request_id uuid, points_awarded int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_answer_id uuid;
begin
  select status into v_status from requests where id = p_request_id for update;
  if v_status is null then
    raise exception 'Request not found: %', p_request_id;
  end if;
  if v_status = 'answered' then
    raise exception 'Request already answered: %', p_request_id;
  end if;

  insert into answers (request_id, helper_user_id, answer, photo_url, points_awarded)
  values (p_request_id, p_helper_user_id, p_answer, p_photo_url, p_points_awarded)
  returning id into v_answer_id;

  update requests set status = 'answered' where id = p_request_id;

  insert into points (user_id, amount, reason)
  values (p_helper_user_id, p_points_awarded, 'answer');

  update profiles set points = points + p_points_awarded where user_id = p_helper_user_id;

  return query select v_answer_id, p_request_id, p_points_awarded;
end;
$$;

grant execute on function answer_request(uuid, uuid, text, text, int) to anon, authenticated;
