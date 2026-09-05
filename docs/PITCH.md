# KitaBantu — pitch notes & judge Q&A

## 30-second framing

> Cities change faster than accessibility info does. A ramp is blocked by
> motorcycles today; a lift breaks overnight. OKU users don't need another static
> map of ramps — they need to ask "**is it accessible right now?**" and get an
> honest answer from someone who is actually there. KitaBantu is two apps in one:
> OKU members ask; neighbours check and answer for points, missions and streaks.
> Every answer also feeds a map whose trust scores decay with time, and a router
> that plans around what's actually blocked for *your* need. And a voice guide
> takes the helper there, turn by turn, and lets Gemini score the photo they take
> on arrival — so an answer is one tap, not a form.

## Mapping to the judging rubric

| Criterion | What to point at |
|---|---|
| **Innovation (25)** | Two-sided design: OKU members post *check-requests* with urgency; helpers earn time-boxed bounties (fast bonus ≤30 min), missions and streaks — supply of fresh information is created on demand instead of hoping people report. Plus volatility-aware trust decay and our own need-aware router where a trusted "lift working" report unlocks stairs. |
| **Technical (30)** | Working end-to-end: sign-up/login (scrypt + bearer tokens), role-based dashboards, requests/answers/thanks, per-user SSE notifications, one `award()` pipeline for points → streak → badges → missions → level-up, A* router over OSM graphs (KL + Cyberjaya), real Google Map with an engine adapter that falls back to Leaflet, voice assistant (Web Speech ↔ Gemini with JSON *actions*, hedged across 4 models on the free tier), turn-by-turn with GPS watch / re-route / TTS, in-app camera → Gemini vision assessment stored with the answer, permission flow; 32 unit tests + two Playwright flows with 0 console errors, EN/BM, phone layout. |
| **Problem & SDG (25)** | Directly answers "*is it accessible right now?*" for a specific person, a specific place, today — and shows how recent and trusted every answer/report is. SDG 11.7 (accessible public spaces); 10.2 as outcome. Users: OKU (3 needs modelled), helpers, councils (data export via API). |
| **Presentation (20)** | Live on a phone in Cyberjaya: allow permissions → say *"Bawa saya ke DPulze"* → the map draws the route and the guide speaks BM turns → *I'm here* → camera → Gemini scores the lift → answer sent, confetti. Calm monochrome line-art identity (bento dashboards, black pill actions, outlined choice cards, Manrope) with a subtle tint per role; a line-art **avatar builder** at sign-up and in the profile, avatars everywhere (chips, feed, leaderboard, answers); reward breakdowns with mono confetti, level ring, streak; one-click demo accounts; 3-minute script in README; demo clock + reset. |

## Anticipated questions

**Isn't a points game for helping disabled people a bit cynical?**
Points never buy anything, and they are only paid for information that a
specific person asked for or that the community re-verified. The requester
controls the "thank you" (+5), which is the only social reward. Missions are
capped at three a day and streak bonuses at 25 pts, so grinding is pointless;
the leaderboard resets weekly. Gamification here is a *habit loop for keeping
data fresh* — the thing static wheelmaps fail at.

**Why did you cut the live-help feature, social scraping and e-hailing?**
They were in the original concept. Live help solves a different problem (human
assistance, not information trust) and is effectively a second product.
Scraping is against most platforms' ToS and unbuildable cleanly in 24 h.
E-hailing needs Grab/Maxim partner APIs. We chose to ship the core loop fully
working rather than three half-features. The architecture leaves room for all
three (report `source` field, need model, route segments).

**How do you stop fake reports?**
Photo required for full points; basic image validation always on; Gemini check
when configured (mismatch removes photo bonus and flags the report). Confirmations
from *other* users only (you can't confirm your own); GPS within 75 m earns full
weight, remote confirmations count half; two disputes remove a report and cost the
reporter. Trust decays anyway, so a lie has a short shelf-life.

**Why not store the trust score?**
Because stored scores go stale — the exact problem we're solving. Trust is a pure
function of (evidence, time since last verification, type volatility) evaluated on
every read. It also makes time-travel in the demo trivial and honest.

**Why these decay numbers?**
Product judgment, tunable per type in one table (`lib/catalogue.js`). The shape
matters more than the constants: fast early decay for high-volatility obstacles
pushes re-verification when it's most valuable; low-volatility features stay green
for weeks so the map is never empty.

**What's real vs. seeded?**
Map, routing, geocoding and all logic are real and live. The 23 initial reports
are seeded at real geocoded locations in Brickfields with relative timestamps so
the story is reproducible on stage. Photos for seed reports are illustrative.
Everything a judge adds during the demo goes through the real pipeline.

**Why write your own router instead of using OSRM/Google?**
Generic routers can't take *our* data into account and will route a wheelchair
down stairs. Our A* runs over an OSM graph we build per city (2 MB for central
KL, 5–20 ms per query) where community reports change edge costs. It also makes
the demo independent of any external API.

**How would this scale?**
Swap `lib/store.js` for Firestore/PostGIS (geo-queries by bbox); keep the trust
function in the read path. Build graphs per district from Overpass/Geofabrik
(the script exists); seed OSM `wheelchair=*`, `kerb=*`, `tactile_paving=*` tags as
low-trust baseline reports so new cities aren't empty; add elevation (slope) as
a cost for wheelchair users.

**Accessibility of the app itself?**
Large tap targets, colour bands always paired with a number and a label (never
colour alone), aria-labels on pins and icon buttons, EN/BM. Next: screen-reader
list-first mode and voice reporting.

## Numbers to say out loud

- 23 seed reports · 16 report types · 3 accessibility needs · 4 trust bands
- Demo route: shortest 770 m scores **57** (blocked kerb, trust 89) → recommended 811 m scores **100** (+41 m detour)
- Switch need to *Low vision*: same kerb irrelevant → 770 m route scores **100**
- +3 days: lift report decays 68 → 9, stairs lock → wheelchair route becomes 1 596 m; the app names the report to re-confirm
- +1 day: high-volatility obstacles drop to red/expired; ramps stay green; council "need re-verification" rises
- Router: 24 289 nodes · 30 965 edges · 5–20 ms per query · no external API
- Confirm on-site: trust 89 → 100, +8 points; remote: +5

**Why is the map coloured when everything else is monochrome?**
Because the map is *data*, not decoration: an OKU user needs to recognise the
real building, the real bus stop, the real crossing. The UI stays black-and-white
so the map is the only thing in colour — your attention goes where it should.

**What happens when Gemini is rate-limited on stage?**
The server hedges: it starts the next model (3.6-flash → 3.5-flash → 3.5-flash-lite
→ 3.1-flash-lite) after a few seconds and takes the first good answer; models that
return 429/503 cool down for 30 s. Navigation, places and the map never depend on
Gemini — only the spoken conversation and the photo score do, and both show a
friendly "AI busy" state instead of failing.

**Google Places / Routes / Geocoding are not enabled on the key — does it matter?**
No: the app detects `PERMISSION_DENIED` and falls back to OpenStreetMap (Overpass
places, Nominatim geocoding) and our own need-aware router. Enabling them on the
Cloud project switches the richer Google data on without a code change.


## v5 — the assistant became the agent

The mic button is now a full operator of the app. Gemini function calling (29 tools) with the
signed-in user's authority: it searches the **whole map** (offline OSM snapshot → Google Places →
Nominatim; EN/BM names *and* categories), starts/stops turn-by-turn guidance, opens any screen or
request, **answers** or **asks** check-requests, files and confirms reports, thanks helpers,
reads points/leaderboard/notifications, and flips settings (language, mute, large text,
permissions). Simple commands are resolved locally in milliseconds; when the free-tier model is
rate-limited a rule-based fallback keeps every one of those flows working. Permissions now cover
location, camera, microphone, notifications and motion/compass (plus wake-lock + persistent storage).

## v6 — the agent runs the whole app; coins & a character to spend them on

* **Voice drives everything.** Beyond navigation the agent now: plans A→B routes
  ("route from KL Sentral to MAB", "berapa lama ke Shaftsbury Square dengan kerusi roda")
  and draws them; files a check-request for someone else to verify a place
  ("buat permintaan untuk seseorang semak lif di DPulze"); answers requests; opens every
  screen; buys and equips wardrobe items; reads coins/points/rank. Rule-based fallback
  covers all of these when Gemini is rate-limited, so the demo never stalls.
* **Coins ≠ points.** Points are reputation and rank; coins are spendable. Mobility aids
  are free by design — say it out loud: *we never sell access back to OKU users*.
* **Real 2D art is a drop-in.** Layered PNGs go into `public/assets/character/`, the app
  switches from line-art automatically (server re-scans every 5 s). Same for illustrations.
* One-liners: *"Helping earns coins; coins buy a hoodie for your character — never a ramp."*
