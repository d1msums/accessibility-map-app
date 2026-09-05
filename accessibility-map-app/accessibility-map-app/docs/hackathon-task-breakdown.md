# Accessibility Mapping App — Task Breakdown & Team Assignments

## Reference: Idea Vetting Summary

| Idea | Verdict | Reasoning |
|---|---|---|
| Waze-style reporting | **KEEP — MVP core** | Directly matches organizer's stated expected outcome: map + report + trust signals. |
| Trust Decay algorithm | **KEEP — use KitaBantu's version** | Tiered decay (12h/48h thresholds, reset-on-confirm, 🟢🟡🟠🔴) is more rigorous than our original and directly answers the "trust that information is still true" line in the problem statement. |
| AI Photo Verification (VLM check) | **KEEP — promote to MVP-adjacent** | No training required — a vision-LLM prompt checking "does this photo show a ramp/steps/blocked path" ships fast and backs the trust score with real evidence. Best feasibility-to-impact ratio on the list. |
| Image Segmentation (Project Sidewalk-based) | **KEEP — stretch only** | Flagged as very resource-heavy, needs good infra. Real risk of eating the whole hackathon. Attempt only after MVP is stable, on one small pre-cached test area — never live inference during demo. |
| Visual Impairment Support | **KEEP — MVP-lite** | Problem statement explicitly names visually impaired users. Minimum version (ARIA labels / screen-reader-friendly markup) is cheap and strengthens Problem Statement & SDG Alignment scoring. |
| Route Planner (A→B) | **CUT from MVP → roadmap slide** | Needs a full routing engine. Highest excitement, lowest feasibility — mention as future vision only. |
| Pre-emptive Accessibility Alert (real, live GPS) | **CUT from MVP → roadmap slide** | Requires live GPS tracking + reroute logic on top of a routing engine that doesn't exist in MVP. A **mocked/scripted** version is still fine as a stretch demo trick (see below). |

---

## MVP Task List

### 1. Map & Demo Area
- [ ] Pick one small demo area (e.g., one LRT station + surrounding block) — do not chase coverage
- [ ] Set up map component (Leaflet/Mapbox/Google Maps) scoped to that area
- [ ] Render accessibility pins on the map
- [ ] Pin click → open report detail view

### 2. Report Flow
- [ ] Build "Report an issue" form: photo upload, location (auto-geolocate + manual drop), description text, type tag (ramp / lift / obstacle)
- [ ] Client-side photo capture/upload handling
- [ ] Submit report to backend, store with timestamp

### 3. Trust / Recency System
- [ ] Define data schema: pins, reports, confirmations, disputes, timestamps
- [ ] Implement KitaBantu's tiered decay formula (fast decay first 12h, faster after 48h)
- [ ] Map decay score → color band (🟢🟡🟠🔴)
- [ ] Confirm/dispute buttons update trust score in real time
- [ ] Reset-on-confirm logic

### 4. AI Photo Verification
- [ ] Integrate a vision-LLM API call: does the photo actually show the claimed ramp/lift/obstacle?
- [ ] Build a verification endpoint (photo + claimed tag → match/mismatch + confidence)
- [ ] Feed verification result into the trust score (verified reports get a trust boost / mismatches get flagged)
- [ ] Graceful fallback if the API is slow or fails — never block submission

### 5. Points System
- [ ] +10 for a report, +5 for a confirm, +15 for a dispute
- [ ] Award atomically alongside the triggering action

### 6. App Accessibility (MVP-lite)
- [ ] Proper ARIA labels across map, report form, and pin details
- [ ] Screen-reader-friendly / TTS read-back on report cards (Web Speech API is enough)

---

## 🟡 Stretch Goals (only if MVP is done with time to spare)

- [ ] **Trip Score** — hardcode 2–3 demo routes, sum trust scores of segments (no real routing engine)
- [ ] **Pre-emptive alert (mock)** — scripted demo trigger: "you're approaching a low-trust segment"
- [ ] **Leaderboard** — one all-time table, no daily/weekly/team variants
- [ ] **Image Segmentation prototype** — only on a small pre-cached test area, never live during the demo

---

## Roadmap / Pitch-Only (do not build — mention as future vision)

- Route Planner (A→B) — needs a full routing engine
- Real Pre-emptive Alert — live GPS tracking + reroute logic

---

## Team Assignments — 5 People, Synchronous Workstreams

Each person can start immediately without waiting on the others. Frontend people stub backend calls with mock data until integration checkpoints.

### 🧑 Person 1 — Map & Core Frontend
- Demo area map setup, pin rendering
- Color-coded pin display (🟢🟡🟠🔴) — stub trust values with mock data initially
- Pin click → report detail modal
- Confirm/dispute buttons (UI only, wired to Person 3's API once ready)
- Stretch: Trip Score display, pre-emptive alert mock UI

### 🧑 Person 2 — Report Flow & Frontend Forms
- Report submission form: photo, location, description, type tag
- Photo capture/upload handling
- ARIA labels + accessible markup across the report flow
- TTS read-back on report cards
- Connects to Person 3's API once schema is agreed

### 🧑 Person 3 — Backend, Data Model & Trust Engine
- Schema: pins, reports, confirmations/disputes, timestamps, points
- API endpoints: create report, fetch pins, confirm, dispute
- KitaBantu tiered decay algorithm implementation
- Points logic (+10/+5/+15), atomic updates
- Defines the API contract early so Persons 1 & 2 can stub against it

### 🧑 Person 4 — AI Verification Integration
- Vision-LLM API integration for photo-vs-tag verification
- Verification endpoint (independent service, can be built/tested in isolation)
- Wire verification confidence into Person 3's trust score formula
- Timeout/failure handling so submission is never blocked
- Stretch (only if time allows): pre-cached image segmentation demo

### 🧑 Person 5 — Gamification, Demo Data & Pitch
- Leaderboard (single all-time table)
- Seed realistic mock data for the demo area (pins across all trust states, sample point totals) so the app looks alive
- Hardcode the 2–3 demo routes + Trip Score sums (stretch, coordinate with Person 1 for display)
- Build the scripted pre-emptive alert demo trigger
- Owns the pitch deck: problem → solution → demo → roadmap slide (Route Planner, real Pre-emptive Alert, Image Segmentation as future investment)
- Ties the "why it makes the cut" reasoning into the pitch narrative

---

## Suggested Integration Checkpoints

- [ ] **Checkpoint 1 (schema agreed):** Person 3 shares API contract → Persons 1, 2, 4 stub against it
- [ ] **Checkpoint 2 (mid-hackathon):** Wire frontend ↔ backend ↔ AI verification together, test end-to-end report flow
- [ ] **Checkpoint 3 (pre-demo):** Freeze features, load Person 5's seeded demo data, run a full dry-run demo
- [ ] **Final:** Confirm backup plan (recorded video/screenshots) in case live demo hits an issue
