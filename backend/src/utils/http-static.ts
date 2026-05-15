import path from "node:path";

export function isPathInside(parentPath, candidatePath) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);

  if (process.platform === "win32") {
    const normalizedParent = parent.toLowerCase();
    const normalizedCandidate = candidate.toLowerCase();
    return (
      normalizedCandidate === normalizedParent ||
      normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`)
    );
  }

  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

export function getStaticContentType(filePath) {
  const lowerName = path.basename(filePath).toLowerCase();
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".geojson" || lowerName.endsWith(".geo.json")) {
    return "application/geo+json; charset=utf-8";
  }
  if (extension === ".json") {
    return "application/json; charset=utf-8";
  }
  if (extension === ".svg") {
    return "image/svg+xml; charset=utf-8";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension === ".js" || extension === ".mjs") {
    return "text/javascript; charset=utf-8";
  }
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  return "application/octet-stream";
}
