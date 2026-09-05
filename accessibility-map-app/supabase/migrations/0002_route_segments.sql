create table if not exists route_segments (
  id uuid primary key default gen_random_uuid(),
  lat float8 not null,
  lng float8 not null,
  grid_cell text not null,       -- rounded lat/lng (~5 decimals ≈ 1m) for de-dup
  heading float8 not null default 0,  -- NOT NULL: a unique index treats every NULL as distinct,
                                       -- so a nullable heading would silently let duplicate rows
                                       -- through instead of hitting the unique constraint below
  source text not null check (source in ('osm', 'streetview', 'mapillary')),
  image_ref text,                -- pano_id / Mapillary image_id — never raw bytes
  osm_tags jsonb,
  detected_features text[],
  ai_confidence float8,
  score float8,                  -- null = no signal yet, route to Phase 2 imagery fallback
  last_checked_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Deterministic snap key: same street corner never re-fetched per route request
create unique index if not exists idx_route_segments_unique_cell 
  on route_segments (grid_cell, heading, source);