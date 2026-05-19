import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as topojson from 'topojson-client';

const TOPO_PATH = join(process.cwd(), 'apps', 'frontend', 'public', 'assets', 'world-countries-50m.json');
const OUTPUT_PATH = join(process.cwd(), 'apps', 'frontend', 'public', 'assets', 'land-mask.svg');

const WIDTH = 4096;
const HEIGHT = 2048;

function project(lng: number, lat: number) {
  const x = (lng + 180) * (WIDTH / 360);
  const y = (90 - lat) * (HEIGHT / 180);
  return { x: x.toFixed(1), y: y.toFixed(1) };
}

async function run() {
  console.log("🚀 Generating SVG Earth Mask...");

  const rawData = readFileSync(TOPO_PATH, 'utf-8');
  const topology = JSON.parse(rawData);
  const objectKey = topology.objects.countries ? "countries" : Object.keys(topology.objects)[0];
  const geojson = topojson.feature(topology, topology.objects[objectKey] as any) as any;

  let paths = '';

  for (const feature of geojson.features) {
    if (!feature.geometry) continue;

    const coords = feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.type === 'MultiPolygon'
        ? feature.geometry.coordinates
        : [];

    for (const polygon of coords) {
      for (let ringIdx = 0; ringIdx < polygon.length; ringIdx++) {
        const ring = polygon[ringIdx];
        let d = '';
        
        for (let i = 0; i < ring.length; i++) {
          const lng = ring[i][0];
          const lat = ring[i][1];
          const p = project(lng, lat);

          if (i === 0) {
            d += `M${p.x},${p.y}`;
          } else {
            const prevLng = ring[i - 1][0];
            if (Math.abs(lng - prevLng) > 180) {
              // Antimeridian crossing! 
              // Instead of a giant horizontal line that smears, 
              // we "lift the pen" (MoveTo). This leaves a 1-pixel gap 
              // at the antimeridian but prevents the globe-wide smear.
              d += `M${p.x},${p.y}`;
            } else {
              d += `L${p.x},${p.y}`;
            }
          }
        }
        // Only use Z if we didn't cross the antimeridian in a way that would smear the closure.
        // For simplicity, we'll just omit Z for now as evenodd fill handles unclosed paths reasonably.
        // Actually, let's keep Z but the last segment will also be checked.
        if (ring.length > 1) {
          const firstLng = ring[0][0];
          const lastLng = ring[ring.length - 1][0];
          if (Math.abs(firstLng - lastLng) < 180) {
            d += 'Z';
          }
        }
        
        paths += `<path d="${d}" />\n`;
      }
    }
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <g fill="#ffffff" fill-rule="evenodd">
${paths}
  </g>
</svg>`;

  writeFileSync(OUTPUT_PATH, svg);
  console.log(`✅ Saved Earth mask to ${OUTPUT_PATH} (${Math.round(svg.length / 1024)} KB)`);
}

run().catch(console.error);
