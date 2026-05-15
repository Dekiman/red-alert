import { rmSync } from "node:fs";
import path from "node:path";

const distPath = path.join(process.cwd(), "dist");
rmSync(distPath, { recursive: true, force: true });
