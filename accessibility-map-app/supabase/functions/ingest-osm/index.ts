// Loads a previously-saved Overpass JSON snapshot and ingests it into
// route_segments -- a demo-safety fallback if the live overpass-api.de
// instance is flaky/rate-limited on demo day. For normal use, prefer
// `phase1-osm-baseline`, which queries Overpass live.
//
// Fixed from the previous version:
//   - The old version had ~2600 lines of Overpass JSON pasted directly into
//     this source file. That's now loaded from Supabase Storage (or an
//     inline POST body) instead -- editing the snapshot no longer means
//     editing and redeploying code.
//   - The old version only read `geometry[0]` for `way` elements, collapsing
//     an entire sidewalk segment (which can be a whole city block) down to
//     a single point and discarding every other vertex. It now reuses the
//     same `discretizeWay` helper phase1-osm-baseline uses, which samples
//     the full geometry at regular intervals.
//   - The old version reimplemented (and diverged from) the scoring logic
//     that lives in _shared/osm_scoring.ts. It now imports that module
//     directly, so both ingestion paths score identically.
import { createClient } from "npm:@supabase/supabase-js@2";
import { makeGridCell, discretizeWay, nodeToSegment } from "../_shared/osm_scoring.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!  // auto-injected default secret, not a custom one
);

interface OverpassElement {
  type: 'node' | 'way';
  id: number;
  lat?: number;
  lon?: number;
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
  timestamp?: string;
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
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const body = await req.json();

    // Two ways to supply the snapshot: inline in the request body (small
    // snapshots, quick testing), or a path in a Supabase Storage bucket
    // (recommended for a real corridor-sized snapshot).
    let elements: OverpassElement[];
    if (body.elements) {
      elements = body.elements;
    } else if (body.storage_path) {
      const bucket = body.storage_bucket || "osm-snapshots";
      const { data, error } = await supabase.storage.from(bucket).download(body.storage_path);
      if (error || !data) {
        throw new Error(`Could not download snapshot: ${error?.message || "not found"}`);
      }
      const text = await data.text();
      const parsed = JSON.parse(text);
      elements = parsed.elements || [];
    } else {
      return new Response(
        JSON.stringify({ error: "Provide either `elements` (inline Overpass JSON) or `storage_path`" }),
        { status: 400 }
      );
    }

    const rows: any[] = [];
    for (const el of elements) {
      if (el.type === "way") {
        for (const seg of discretizeWay(el, body.sampleInterval || 20)) {
          rows.push(toRow(seg));
        }
      } else if (el.type === "node") {
        const seg = nodeToSegment(el);
        if (seg) rows.push(toRow(seg));
      }
    }

    if (rows.length === 0) {
      return new Response(JSON.stringify({ success: true, inserted: 0, note: "No node/way elements in snapshot" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Single batched upsert instead of one await per element -- the old
    // version awaited a DB round-trip per element in a loop, which for a
    // few thousand elements risked hitting the function's execution timeout.
    const { error } = await supabase
      .from("route_segments")
      .upsert(rows, { onConflict: "grid_cell,heading,source" });

    if (error) throw new Error(`DB error: ${error.message}`);

    return new Response(
      JSON.stringify({ success: true, inserted: rows.length }),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err) {
    console.error("ingest-osm error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Ingestion failed" }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
});

function toRow(seg: any) {
  return {
    lat: seg.lat,
    lng: seg.lng,
    grid_cell: makeGridCell(seg.lat, seg.lng),
    heading: seg.heading ?? 0,
    source: "osm",
    image_ref: null,
    osm_tags: seg.osm_tags || {},
    detected_features: seg.detected_features || [],
    ai_confidence: seg.ai_confidence ?? 0,
    score: seg.score,  // left null when there's no signal -- do not coerce to 0
    last_checked_at: new Date().toISOString(),
  };
}
