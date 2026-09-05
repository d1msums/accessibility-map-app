// Deno.serve() is the current standard for Supabase Edge Functions --
// the old `serve()` import from deno.land/std/http is a deprecated pattern
// (that std module itself points to Deno.serve now).
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  makeGridCell,
  buildOverpassQuery,
  discretizeWay,
  nodeToSegment
} from '../_shared/osm_scoring.ts';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      headers: { 
        'Access-Control-Allow-Origin': '*', 
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' 
      } 
    });
  }

  try {
    const body = await req.json();
    const { minLat, minLng, maxLat, maxLng, sampleInterval = 20 } = body;

    if ([minLat, minLng, maxLat, maxLng].some(v => v == null)) {
      return new Response(
        JSON.stringify({ error: 'Missing bbox coordinates' }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!  // auto-injected
    );

    // Build query
    const query = buildOverpassQuery(minLat, minLng, maxLat, maxLng);
    const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`;
    console.log('Querying Overpass:', url);

    // Fetch with Accept header
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('Overpass error:', resp.status, text);
      throw new Error(`Overpass API error: ${resp.status} - ${text.substring(0, 200)}`);
    }

    const data = await resp.json();
    const elements: any[] = data.elements || [];

    const ways = elements.filter((e: any) => e.type === 'way');
    const nodes = elements.filter((e: any) => e.type === 'node');

    const segments: any[] = [];
    for (const way of ways) {
      segments.push(...discretizeWay(way, sampleInterval));
    }
    for (const node of nodes) {
      const seg = nodeToSegment(node);
      if (seg) segments.push(seg);
    }

    const rows = segments.map(seg => ({
      lat: seg.lat,
      lng: seg.lng,
      grid_cell: makeGridCell(seg.lat, seg.lng),
      heading: seg.heading ?? 0,
      source: 'osm',
      image_ref: null,
      osm_tags: seg.osm_tags,
      detected_features: seg.detected_features || [],
      ai_confidence: seg.ai_confidence ?? 0,
      score: seg.score,  // may legitimately be null -- means "no OSM signal, needs imagery", not 0
      last_checked_at: new Date().toISOString()
    }));

    const { error } = await supabase
      .from('route_segments')
      .upsert(rows, { onConflict: 'grid_cell,heading,source' });

    if (error) throw new Error(`DB error: ${error.message}`);

    return new Response(
      JSON.stringify({
        success: true,
        inserted: rows.length,
        ways: ways.length,
        nodes: nodes.length,
        bbox: { minLat, minLng, maxLat, maxLng },
      }),
      {
        headers: { 
          'Content-Type': 'application/json', 
          'Access-Control-Allow-Origin': '*' 
        },
      }
    );

  } catch (error) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});