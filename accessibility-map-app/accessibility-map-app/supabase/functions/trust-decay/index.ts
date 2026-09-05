// Person 3: tiered decay — fast decay first 12h, faster after 48h, reset-on-confirm.
// Can run as an Edge Function on a schedule, or compute on read.
export default async function trustDecay() {
  // TODO: implement decay formula, map score -> color band
}
