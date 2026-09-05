// Owned by Huzaifa. AI photo verification: does the photo match claimed_type?
//
// Uses Google Gemini as the vision model (per explicit instruction to use
// Gemini here) -- note this diverges from docs/hackathon-prep.md and the
// architecture diagram, which both specify the Claude vision API instead.
// If that was a one-off request rather than a stack decision, flag it back
// to whoever owns those docs so they stay in sync with what's deployed.
//
// Fixed from the previous version:
//   - The contract's own input shape already sends `claimed_type` directly,
//     so the common path needs no DB read at all. `reports` has no
//     claimed_type column (the type lives on `pins`), so the fallback path
//     (used only when a caller omits claimed_type/photo_url) joins to
//     `pins.type` through `reports.pin_id` instead of selecting a column
//     that doesn't exist.
//   - Used a custom `SERVICE_ROLE_KEY` secret that someone would have to
//     manually set (and keep in sync with the real value) instead of the
//     `SUPABASE_SERVICE_ROLE_KEY` Supabase already injects automatically.
//   - Always returned HTTP 200 even on failure, which doesn't match this
//     same contract's own stated convention for Edge Function errors
//     ({ error: { message } } with a real status code). "Never block
//     submission" is about the report already being saved before this
//     runs, not about masking this call's own failures.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
// Flash: fast + cheap, good fit for a per-report classification call that
// needs to land well under the timeout below. Swap to a pro-tier model if
// accuracy testing (see Phase 3 checklist) shows Flash isn't precise enough.
// gemini-2.5-flash was retired for new callers -- Google's own 404 response
// pointed at this replacement.
const MODEL = "gemini-3.6-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const TIMEOUT_MS = 8000;

function cors(extra: Record<string, string> = {}) {
  return { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json", ...extra };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: { message: "Method not allowed" } }), { status: 405, headers: cors() });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: { message: "Invalid JSON" } }), { status: 400, headers: cors() });
  }

  const { report_id } = payload;
  if (!report_id) {
    return new Response(JSON.stringify({ error: { message: "report_id required" } }), { status: 400, headers: cors() });
  }

  let photoUrl: string | null = payload.photo_url || null;
  let claimedType: string | null = payload.claimed_type || null;

  try {
    // Contract input already includes photo_url/claimed_type directly, so
    // the common path needs no DB read at all. Only fall back to fetching
    // the report row if the caller didn't supply them (e.g. invoked from a
    // DB trigger/webhook with just the row id).
    if (!photoUrl || !claimedType) {
      const { data: report, error: reportError } = await supabase
        .from("reports")
        .select("photo_url, pin_id, pins(type)")
        .eq("id", report_id)
        .single();

      if (reportError || !report) {
        throw new Error("Report not found");
      }
      photoUrl = photoUrl || report.photo_url;
      claimedType = claimedType || (report as any).pins?.type;
    }

    if (!photoUrl) throw new Error("No photo_url available for this report");
    if (!claimedType) throw new Error("No claimed_type available for this report");

    const { verified, confidence } = await callGeminiVision(photoUrl, claimedType);

    const { error: updateError } = await supabase
      .from("reports")
      .update({ ai_verified: verified, ai_confidence: confidence })
      .eq("id", report_id);

    if (updateError) throw new Error(`Failed to write result: ${updateError.message}`);

    return new Response(JSON.stringify({ match: verified, confidence }), { headers: cors() });
  } catch (err) {
    console.error("verify-photo error:", err);
    // Leave ai_verified as null (its default) -- the report submission
    // already succeeded before this ran, so a failure here just means the
    // signal doesn't get added yet, not that anything needs rolling back.
    return new Response(
      JSON.stringify({ error: { message: err instanceof Error ? err.message : "Verification failed" } }),
      { status: 502, headers: cors() }
    );
  }
});

async function callGeminiVision(imageUrl: string, claimedType: string): Promise<{ verified: boolean; confidence: number }> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Gemini's generateContent takes inline image bytes, not a bare URL --
    // fetch the photo first and base64-encode it.
    const imageResponse = await fetch(imageUrl, { signal: controller.signal });
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch photo_url: ${imageResponse.status}`);
    }
    const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";
    const imageBytes = new Uint8Array(await imageResponse.arrayBuffer());
    let binary = "";
    for (let i = 0; i < imageBytes.length; i++) binary += String.fromCharCode(imageBytes[i]);
    const base64Image = btoa(binary);

    const prompt = `You are an accessibility feature verifier for a crowdsourced map. You are given a photo and a claimed feature type. Determine whether the photo actually shows that feature.

Claimed feature: ${claimedType}
Possible feature types: "ramp", "lift", "obstacle".

Respond with ONLY a JSON object, no other text:
{"verified": true|false, "confidence": 0.0-1.0, "reason": "short explanation"}`;

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mimeType, data: base64Image } },
            { text: prompt },
          ],
        },
      ],
      generationConfig: { responseMimeType: "application/json" },
    };

    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText.substring(0, 300)}`);
    }

    const data = await response.json();
    const textContent = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text;
    if (!textContent) throw new Error("No text content in Gemini response");

    let parsed: any;
    try {
      parsed = JSON.parse(textContent);
    } catch {
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not parse JSON from Gemini response");
      parsed = JSON.parse(jsonMatch[0]);
    }

    const verified = parsed.verified === true;
    let confidence = parsed.confidence;
    if (typeof confidence !== "number" || confidence < 0 || confidence > 1) confidence = 0.5;

    return { verified, confidence };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("Gemini API call timed out");
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
