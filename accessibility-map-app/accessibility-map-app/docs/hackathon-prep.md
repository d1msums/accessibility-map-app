# 🚀 Hackathon Prep Doc

Fill this out **before** anyone opens an IDE. The goal is to leave the planning phase with a locked idea, a locked scope, and zero ambiguity about who's doing what.

---

## 1. Event Info

- **Hackathon name:**
- **Dates / times:**
- **Theme / track (if any):**
- **Team name:**
- **Team members & roles:**
- **Submission deadline:**
- **Judging criteria (copy from the rules page):**
- **Allowed tech / banned tech (if any restrictions):**

---

## 2. Problem Space / Topic Exploration

- What problem area(s) are we drawn to?
- Who actually has this problem? (be specific — not "everyone")
- Why does this problem matter *right now*?
- What existing solutions/products already address this? Quick competitor scan:
  - 
  - 
- What's our unique angle or wedge?

---

## 3. Ideas, Features & Scope

### Idea shortlist

| Idea | One-line pitch | Feasibility (1–5) | Excitement (1–5) | Notes |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |

### Chosen idea

- **Idea name:**
- **Problem it solves:**
- **Target user:**
- **One-sentence pitch:**
- **Why this one over the others:**

### Features

**Must-have (MVP — demo is broken without these):**
- [ ]
- [ ]
- [ ]

**Nice-to-have (only if MVP is done early):**
- [ ]
- [ ]

**Explicitly out of scope (say no now, not at hour 20):**
-
-

### Scope guardrails

- **Feature freeze time:**
- **What "done" looks like for demo day:**
- **First thing we cut if we're behind schedule:**
- **Second thing we cut:**

---

## 4. LLM Idea-Vetting Checklist

Before writing a single line of code, run the idea past an LLM (Claude, ChatGPT, etc.) and check these off:

- [ ] Asked an LLM to stress-test the idea / poke holes in the concept
- [ ] Asked an LLM whether similar products or past hackathon projects already exist, and how we differ
- [ ] Asked an LLM to estimate technical complexity against our actual timeframe
- [ ] Asked an LLM to flag legal, ethical, privacy, or data-usage concerns
- [ ] Asked an LLM to propose a realistic MVP cut given the hours available
- [ ] Asked an LLM to identify the riskiest/hardest technical component, so we can prototype it first
- [ ] Asked an LLM whether the idea actually fits the hackathon's theme/rules (if applicable)
- [ ] Got a second opinion from a human teammate too — an LLM's approval isn't the only check
- [ ] LLM vetting notes / link to the conversation saved here:

---

## 5. Tech Stack & Architecture

- **Frontend:** React + Vite, `react-leaflet` for the map, Tailwind for styling
- **Backend:** Supabase (Postgres + Auth + Storage + Realtime) — replaces a custom server, so Person 3 spends the hackathon on the trust-decay logic instead of CRUD boilerplate
- **Database:** Supabase's built-in Postgres — tables for pins, reports, confirmations/disputes, points
- **APIs / third-party services:** OpenStreetMap tiles (free, no key needed); Claude API (vision) for photo verification
- **Hosting / deployment plan:** Frontend on Vercel (git push → live URL); Supabase is already hosted, so there's no backend deploy step
- **Auth (if needed):** Supabase Auth — magic-link or anonymous session is enough to attach points/reports to a stable user id
- **High-level architecture sketch/diagram (link or embed):** Client (React + Leaflet, on Vercel) ↔ Supabase (DB, auth, storage, realtime) ↔ Claude vision API for photo verification, with map tiles pulled directly from OpenStreetMap into the client. See diagram shared in chat.

---

## 6. Team Logistics

- **Roles & responsibilities:**
- **Communication channel (Slack/Discord):**
- **Repo link:**
- **Branching strategy / PR rules:**
- **Design files (Figma, etc.):**
- **Time zones (if remote):**

---

## 7. Timeline / Milestones

| Time block | Goal | Owner |
|---|---|---|
| Hour 0–2 | Finalize idea, set up repo/environment | |
| Hour 2–? | Build riskiest/core piece first | |
| Mid-point checkpoint | Re-assess scope, cut if needed | |
| Final hours | Polish, write pitch, prep demo | |
| Last hour | Submit + backup plan ready | |

---

## 8. Pre-Coding Checklist

- [ ] Idea finalized **and** LLM-vetted (see Section 4)
- [ ] Scope locked: MVP defined, nice-to-haves listed, out-of-scope listed
- [ ] Tech stack agreed on by the whole team
- [ ] Repo created & everyone has access
- [ ] Dev environment set up and tested on every teammate's machine
- [ ] API keys / credentials obtained and shared securely (not hardcoded/committed)
- [ ] Rough wireframes or sketches exist for key screens/flows
- [ ] Roles assigned for build phase
- [ ] Submission requirements re-read (format, deadline, what to include)
- [ ] Demo/pitch story outline drafted

---

## 9. Demo & Submission Prep

- **What's the "wow" moment in our demo?**
- **Backup plan if the live demo fails (recorded video/screenshots):**
- **Submission checklist (per the rules):**
  - [ ]
  - [ ]
- **Pitch structure:** problem → solution → live demo → impact → ask

---

## 10. Risks & Open Questions

*Prompts to get you started — answer the ones that apply, delete the rest:*

- What's the single point of failure in our plan (an API, a teammate's availability, unfamiliar tech)?
- Do we have a fallback if a key API/service goes down, rate-limits us, or costs more than expected mid-event?
- Is there a dependency on data, hardware, or access we don't actually have yet?
- Is there a "bus factor" risk — a skill only one teammate has?
- What assumption are we making that, if wrong, breaks the whole idea?
- Will we need reliable wifi/internet at the venue, and is that guaranteed?
- Is there a legal/licensing/privacy question we haven't fully resolved (data usage, API terms of service)?
- What's still ambiguous in the judging criteria or submission rules?
- Have we double-checked the idea isn't disqualified by the hackathon's rules/theme?
- If our riskiest technical piece doesn't work, what's our fallback idea or feature?

-
-
-
