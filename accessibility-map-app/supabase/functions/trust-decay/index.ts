// Person 3: tiered decay -- fast decay first 12h, faster after 48h, reset-on-confirm.
//
// Fixed: the previous version was `export default async function trustDecay()`
// with no Deno.serve() call at all. That's not a valid Edge Function entrypoint --
// nothing is listening for the HTTP request, so invoking the deployed function
// would never actually respond (and the "manual trigger" API_CONTRACT.md calls
// for wouldn't work either). This restores a proper Deno.serve() handler; the
// decay formula constants below are placeholders -- API_CONTRACT.md's own open
// questions already flag the exact constants as unresolved, so confirm the real
// tiers/thresholds before demo day rather than trusting these numbers.
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// PLACEHOLDER constants -- confirm real values with Sofea before the demo.
const HOURS_TIER_1 = 12; // decay starts
const HOURS_TIER_2 = 48; // decay accelerates
const DECAY_RATE_TIER_1 = 2;   // points lost per hour, hours 12-48
const DECAY_RATE_TIER_2 = 5;   // points lost per hour, after 48h

function computeDecayedScore(lastConfirmedAt: string, currentScore: number): number {
  const hoursSince = (Date.now() - new Date(lastConfirmedAt).getTime()) / (1000 * 60 * 60);
  if (hoursSince <= HOURS_TIER_1) return currentScore;

  let decayed = currentScore;
  if (hoursSince <= HOURS_TIER_2) {
    decayed -= (hoursSince - HOURS_TIER_1) * DECAY_RATE_TIER_1;
  } else {
    decayed -= (HOURS_TIER_2 - HOURS_TIER_1) * DECAY_RATE_TIER_1;
    decayed -= (hoursSince - HOURS_TIER_2) * DECAY_RATE_TIER_2;
  }
  return Math.max(0, decayed);
}

function colorBandFor(score: number): string {
  if (score >= 80) return '🟢';
  if (score >= 50) return '🟡';
  if (score >= 25) return '🟠';
  return '🔴';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST' },
    });
  }

  try {
    const { data: pins, error: fetchError } = await supabase
      .from('pins')
      .select('id, trust_score, color_band, last_confirmed_at')
      .not('last_confirmed_at', 'is', null);

    if (fetchError) throw new Error(fetchError.message);

    let updated = 0;
    for (const pin of pins || []) {
      const newScore = computeDecayedScore(pin.last_confirmed_at, pin.trust_score);
      const newBand = colorBandFor(newScore);
      if (newScore === pin.trust_score && newBand === pin.color_band) continue;

      const { error: updateError } = await supabase
        .from('pins')
        .update({ trust_score: newScore, color_band: newBand })
        .eq('id', pin.id);

      if (updateError) {
        console.error(`Failed to update pin ${pin.id}:`, updateError.message);
        continue;
      }
      updated++;
    }

    return new Response(
      JSON.stringify({ success: true, checked: pins?.length ?? 0, updated }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  } catch (err) {
    console.error('trust-decay error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Decay tick failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
