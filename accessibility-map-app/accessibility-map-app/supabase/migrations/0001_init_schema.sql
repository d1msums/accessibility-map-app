-- Person 3: core schema — pins, reports, confirmations/disputes, points.
create table pins (
  id uuid primary key default gen_random_uuid(),
  latitude double precision not null,
  longitude double precision not null,
  type text not null check (type in ('ramp', 'lift', 'obstacle')),
  created_at timestamptz not null default now()
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid references pins(id) on delete cascade,
  user_id uuid,
  photo_url text,
  description text,
  ai_verified boolean,
  ai_confidence numeric,
  created_at timestamptz not null default now()
);

create table confirmations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references reports(id) on delete cascade,
  user_id uuid,
  type text not null check (type in ('confirm', 'dispute')),
  created_at timestamptz not null default now()
);

create table points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amount integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);
