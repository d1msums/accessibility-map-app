# KitaBantu character art — drop-in spec

Put PNG files here and the app switches from line-art to your 2D art automatically
(no code change, no restart: the server re-reads this folder every 5 s; the browser needs a refresh).

## Canvas
* **1024 × 1024 px, transparent PNG, sRGB.** Every layer uses the *same* canvas so they stack pixel-perfect.
* Character stands centred, feet at about y = 940, top of head at about y = 120 (leaves room for hats/hair).
* Keep line weight consistent (the UI is monochrome; colour is fine inside the character).

## Folders and file names (`public/assets/character/<layer>/<id>.png`)
Bottom → top stacking order:

| layer         | what                                            | files                                                                                              |
|---------------|-------------------------------------------------|----------------------------------------------------------------------------------------------------|
| `background/` | full-square backdrop behind the character       | `bg_sand.png` `bg_mist.png` `bg_kl.png` `bg_cyber.png`                                              |
| `aid_behind/` | parts of a mobility aid drawn BEHIND the body   | `aid_wheelchair.png` (back wheel/frame) — optional for the others                                   |
| `body/`       | base body (arms, legs, neck) – one per skin tone | `01.png` … `06.png` (light → deep). At least `01.png` is required.                                  |
| `outfit/`     | clothes on top of the body                      | `outfit_tee` `outfit_shirt` `outfit_hoodie` `outfit_baju` `outfit_dress` `outfit_blazer` `outfit_hero` |
| `head/`       | face + ears, one per skin tone                  | `01.png` … `06.png` (same order as body)                                                            |
| `hair/`       | hair / hijab / cap                              | `hair_curly` `hair_short` `hair_bob` `hair_hijab` `hair_bun` `hair_afro` `hair_long` `hair_cap`      |
| `glasses/`    |                                                 | `glasses_round` `glasses_square` `glasses_shades`                                                   |
| `item/`       | held in hand                                    | `item_phone` `item_coffee` `item_bag` `item_book` `item_plant` `item_cane`                          |
| `aid/`        | mobility aid, front part (always free in-app)   | `aid_wheelchair` `aid_cane` `aid_guidedog` `aid_hearing`                                             |
| `pet/`        | companion beside the feet                       | `pet_cat` `pet_kitten` `pet_bird`                                                                    |
| `frame/`      | decorative border on top of everything          | `frame_sparkle` `frame_gold` (`frame_none` needs no file)                                            |

That is **47 PNGs** for the full default catalogue (plus up to 12 base body/head tones).
Missing files are fine — those items simply keep the line-art fallback until the PNG arrives.

## Adding new items
Add an entry to `manifest.json` and drop the file:

```json
{ "items": [
  { "id": "outfit_kebaya", "layer": "outfit", "name": "Kebaya", "nameMs": "Kebaya", "price": 140, "rarity": "rare" },
  { "id": "pet_otter", "layer": "pet", "name": "Otter", "nameMs": "Memerang", "price": 180, "rarity": "epic", "minLevel": 4 }
] }
```
`starter: true` = every new account owns it. `price: 0` = free. `offset: {"x": 2, "y": -1}` nudges a layer by % if needed.

## Illustrations (not layered — single PNG/SVG, also drop-in)
Recommended 1600 × 1000 transparent PNG unless noted. Place in `public/assets/illustrations/`:
`hero.png` (landing), `helper.png` and `oku.png` (role pick + onboarding), `permissions.png`,
`empty_requests.png`, `empty_map.png`, `empty_feed.png`, `reward.png`, `levelup.png`, `welcome.png`,
mascot states 512 × 512: `cat_idle.png`, `cat_listen.png`, `cat_talk.png`, `cat_happy.png`, `cat_sleep.png`.

---

## assetsManifest.json (generated)

`public/assets/assetsManifest.json` is produced by `npm run build:assets`
(`scripts/build-assets-manifest.js`). It scans this folder and `public/assets/illustrations/`
and lists every SVG under two categories:

* **`ui_elements`** – standalone illustrations for landing / hero / auth pages, each with
  `section` (hero · landing · auth · reserve), `role` (hero-primary, login, signup-oku, …), `alt`, `url`.
* **`avatar_parts`** – Open Peeps atoms per layer (body, pose, head, face, facial-hair, accessories)
  with `url`, `viewBox`, `tags` (a11y:wheelchair, culture:malaysia, paintable, …), plus
  `composition` offsets (verified) for stacking them into one SVG.

Re-run the script whenever you add or rename SVG files.

## `<AvatarBuilder />` + KBPeeps (how the manifest is consumed)

| File | What it is |
|---|---|
| `public/js/peeps.js` | **KBPeeps** engine — loads `assetsManifest.json`, gender filter, level/points locks, layered renderer, localStorage + `PATCH /api/me { peep }` persistence. |
| `public/js/avatar-builder.js` | **`<AvatarBuilder value onChange user compact title />`** — Preact component (React-compatible API, 15 KB vendored in `public/vendor/preact/`). `AvatarBuilderMount(host, props)` mounts it from plain JS. |
| `lib/store.js → cleanPeep()` | server-side validation of the saved combination (ids must be `layer/slug`, colours `#rrggbb`). |

**Layer stack** (absolute positioning inside one square canvas, z-order): `body → pose → face → facial-hair → head → accessories`. Offsets come from `avatar_parts.composition` in the manifest (bust / standing / sitting / sittingWide), so any atom lines up without per-item tweaks.

**Gender logic** — `KBPeeps.genderOk(layer, slug, gender)`: male = short/shaved/hat styles **+ the Beard tab**; female = long/medium/bun/hijab styles, no facial hair; body, face, accessories, poses are unisex. `Any` shows everything.

**Gamification** — `KBPeeps.lockFor(id, user)` → tiers `free → bronze (Lv2/100 pts) → silver (Lv3/300) → gold (Lv4/700) → hero (Lv5/1500)`. Tier table `TIER_OF` in peeps.js (beanie/hats, mohawks, colour hair, eyepatch, fur jacket, doc/robot poses, monster faces…). Accessibility items (wheelchair, prosthesis poses, elderly faces, sunglasses) are never locked. `KBPeeps.sanitize(peep, user)` drops anything the user isn't allowed to wear.

**Persistence** — `localStorage["kb.peep"]` (instant, works before signup) + the server copy on `user.peep` (register body / `PATCH /api/me`). `AV()` in app.js draws the peep everywhere: navbar `#meAvatar`, leaderboard, feed/answers, profile hero + RPG character card, wardrobe stage.
