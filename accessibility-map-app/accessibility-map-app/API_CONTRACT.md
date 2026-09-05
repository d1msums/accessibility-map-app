# CTRL+WIN API Contract (v2, Supabase)

Owner: Sofea (Backend / Data / Trust Engine)
Stack: Supabase (Postgres + auto REST + Edge Functions)

> Anything not defined here → ask Sofea before assuming. Update this doc first, then tell the team, don't just change code silently.

---

## Conventions

- All timestamps: ISO 8601 UTC (e.g. `"2026-09-05T10:00:00Z"`).
- Frontend talks to Supabase via `@supabase/supabase-js`, using `lib/supabaseClient.js`.
- Three ways data gets accessed, depending on complexity:
  1. **Direct table read** (auto-generated REST) — simple fetches, no logic
  2. **RPC (Postgres function)** — anything that must update multiple things atomically (confirm/dispute + trust score + points)
  3. **Edge Function** — anything needing custom compute or external calls (decay calculation, AI verification)
- Error shape (RPC/Edge Functions): standard Supabase error object — `{ error: { message: "..." } }`. Frontend should always check `error` before using `data`.

---

## Schema (`supabase/migrations/0001_init_schema.sql`)

**pins**
```
id            uuid, pk
lat           float8
lng           float8
type          text        -- 'ramp' | 'lift' | 'obstacle'
trust_score   float8      -- cached, recalculated on confirm/dispute
color_band    text        -- '🟢' | '🟡' | '🟠' | '🔴', derived from trust_score
last_confirmed_at  timestamptz
created_at    timestamptz default now()
```

**reports**
```
id              uuid, pk
pin_id          uuid, fk -> pins.id
photo_url       text
description     text
claimed_type    text
ai_verified     boolean nullable   -- null until verify-photo runs
ai_confidence   float8 nullable
created_at      timestamptz default now()
```

**confirmations_disputes**
```
id           uuid, pk
pin_id       uuid, fk -> pins.id
report_id    uuid, fk -> reports.id, nullable
action       text        -- 'confirm' | 'dispute'
user_id      text        -- device id, no real auth
created_at   timestamptz default now()
```

**points**
```
id              uuid, pk
user_id         text
action_type     text     -- 'report' | 'confirm' | 'dispute'
points_awarded  int
created_at      timestamptz default now()
```

---

## 1. Fetch all pins (Direct table read)

Frontend (`usePins.js`):
```js
const { data, error } = await supabase
  .from('pins')
  .select('id, lat, lng, type, trust_score, color_band, last_confirmed_at');
```
No custom endpoint needed — Supabase auto-generates this. `trust_score`/`color_band` are read as cached columns (kept up to date by the decay function + RPCs below), not computed live.

---

## 2. Fetch one pin + history (Direct table read, joined)

Frontend (`usePins.js`):
```js
const { data, error } = await supabase
  .from('pins')
  .select(`
    id, lat, lng, type, trust_score, color_band, last_confirmed_at,
    reports (id, description, photo_url, ai_verified, ai_confidence, created_at),
    confirmations_disputes (action, created_at)
  `)
  .eq('id', pinId)
  .single();
```

---

## 3. Submit a report (Direct insert)

Frontend (`useReports.js`), after uploading the photo to Supabase Storage and getting a public URL:
```js
const { data, error } = await supabase
  .from('reports')
  .insert({ pin_id, photo_url, description, claimed_type })
  .select()
  .single();

// then separately, award points:
await supabase.rpc('award_points', { p_user_id, p_action_type: 'report' });
```
**Note:** if no `pin_id` exists yet (new location), frontend creates the pin row first (`trust_score: 100`, `color_band: '🟢'`), then the report referencing it.

---

## 4. Confirm a pin : RPC `confirm_pin`

Why RPC and not a direct update: confirm must atomically (a) reset `last_confirmed_at`, (b) recalculate `trust_score`/`color_band`, (c) log the action, (d) award points — all in one transaction.

```js
const { data, error } = await supabase.rpc('confirm_pin', {
  p_pin_id: pinId,
  p_user_id: userId
});
```

**Returns**
```json
{ "pin_id": "...", "new_trust_score": 100, "new_color_band": "🟢", "points_awarded": 5 }
```

**Postgres function does:**
1. Insert into `confirmations_disputes` (action='confirm')
2. Update `pins.last_confirmed_at = now()`, recalculate `trust_score`/`color_band`
3. Insert into `points` (+5)
4. Return the new values

---

## 5. Dispute a pin : RPC `dispute_pin`

Same shape as confirm, but drops trust score instead of resetting it, and awards +15.
```js
const { data, error } = await supabase.rpc('dispute_pin', {
  p_pin_id: pinId,
  p_user_id: userId
});
```
**Returns**
```json
{ "pin_id": "...", "new_trust_score": 45, "new_color_band": "🟠", "points_awarded": 15 }
```

---

## 6. Trust decay : Edge Function `trust-decay`

Not called directly by the frontend. Runs on a schedule (Supabase cron / pg_cron) to recalculate every pin's `trust_score`/`color_band` based on time elapsed since `last_confirmed_at`, using the tiered decay formula (fast decay after 12h, faster after 48h). Updates the `pins` table in place.

For demo purposes: expose a manual trigger too (`POST` to the function URL) so you can force a decay tick on stage instead of waiting on the real clock.

---

## 7. AI photo verification : Edge Function `verify-photo`

Owned by Huzaifa, shape agreed here.

**Input**
```json
{ "report_id": "...", "photo_url": "...", "claimed_type": "ramp" }
```

**Behavior:** calls a vision-LLM, checks if the photo matches `claimed_type`, then writes the result back into that report's `ai_verified` / `ai_confidence` columns directly (via Supabase client inside the Edge Function, using the service role key).

**Returns**
```json
{ "match": true, "confidence": 0.87 }
```

**Failure/timeout handling:** if this fails or times out, leave `ai_verified` as `null` — never block the original report submission on this. Frontend already saved the report in step 3 before this runs.

---

## Open questions / TBD
- [ ] Exact decay constants + how often `trust-decay` runs (needs to be fast enough for judges to see live — consider a "demo speed" env flag)
- [ ] `user_id` scheme — random UUID stored in browser localStorage on first visit, no real auth
- [ ] Leaderboard query (Person 5) — likely just a direct `SELECT user_id, SUM(points_awarded)` grouped query, add here once finalized
- [ ] RLS (Row Level Security) policies — for a hackathon, can likely leave permissive, but note this so it's a conscious choice, not an oversight
