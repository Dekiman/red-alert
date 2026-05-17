import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import * as topojson from 'topojson-server';
import * as toposimplify from 'topojson-simplify';

const COUNTRIES = ['FRA', 'DEU', 'ISR', 'USA', 'GBR', 'ITA', 'ESP', 'CAN', 'AUS', 'JPN'];
const LEVELS = ['ADM1', 'ADM2'];
const METADATA_URL = "https://www.geoboundaries.org/api/current/gbOpen/ALL/ALL/";
const OUTPUT_DIR = join(process.cwd(), 'apps', 'frontend', 'public', 'boundaries');

type GeoBoundariesMetadata = {
  boundaryName: string;
  boundaryISO: string;
  boundaryType: string;
  simplifiedGeometryGeoJSON?: string;
  gjDownloadURL?: string;
};

async function run() {
  console.log("🚀 Starting boundary build process...");

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log("📥 Fetching geoBoundaries metadata...");
  const resp = await fetch(METADATA_URL);
  if (!resp.ok) throw new Error("Failed to fetch metadata");
  const metadata = await resp.json() as GeoBoundariesMetadata[];

  const manifest: Record<string, string> = {};

  for (const countryIso of COUNTRIES) {
    for (const level of LEVELS) {
      const entry = metadata.find(m => m.boundaryISO === countryIso && m.boundaryType === level);
      if (!entry) {
        console.warn(`⚠️ No entry found for ${countryIso} ${level}`);
        continue;
      }

      const url = entry.simplifiedGeometryGeoJSON || entry.gjDownloadURL;
      if (!url) continue;

      const filename = `${countryIso.toLowerCase()}-${level.toLowerCase()}.topo.json`;
      const outputPath = join(OUTPUT_DIR, filename);

      console.log(`📡 Fetching ${countryIso} ${level}...`);
      try {
        const geoResp = await fetch(url);
        if (!geoResp.ok) throw new Error(`HTTP ${geoResp.status}`);
        const geojson = await geoResp.json();

        console.log(`⚙️ Converting ${countryIso} ${level} to TopoJSON...`);
        let topology = topojson.topology({ boundaries: geojson });
        
        console.log(`⚖️ Simplifying ${countryIso} ${level}...`);
        // Simplify to 10% of the original precision (adjustable)
        topology = toposimplify.presimplify(topology);
        topology = toposimplify.simplify(topology, 0.0001); // Threshold for simplification
        
        writeFileSync(outputPath, JSON.stringify(topology));
        manifest[`${countryIso}-${level}`] = `/boundaries/${filename}`;
        console.log(`✅ Saved ${filename} (${Math.round(JSON.stringify(topology).length / 1024)} KB)`);
      } catch (e) {
        console.error(`❌ Failed ${countryIso} ${level}:`, (e as any).message);
      }
    }
  }

  writeFileSync(join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log("✨ Boundary build completed!");
}

run().catch(console.error);
