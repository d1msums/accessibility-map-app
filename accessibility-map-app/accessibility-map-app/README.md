# Accessibility Map App

Waze-style accessibility reporting for one small demo area (map + reports + trust scoring + AI photo verification).

## Structure
- `frontend/` — React + Vite + Leaflet client
- `supabase/` — Postgres schema, edge functions (trust decay, photo verification)
- `docs/` — planning docs (prep doc, task breakdown)

## Setup
1. `cd frontend && npm install`
2. Copy `.env.example` to `frontend/.env` and fill in your Supabase project URL/key
3. `npx supabase start` (or link to a hosted Supabase project)
4. `npm run dev` inside `frontend/`
