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
          const p = project(ring[i][0], ring[i][1]); // [lng, lat]
          d += i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`;
        }
        if (ring.length > 0) d += 'Z';
        
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
