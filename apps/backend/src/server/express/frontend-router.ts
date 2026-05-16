import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import express from "express";

function getCacheControl(filePath, frontendAssetsRoot) {
  if (filePath.startsWith(frontendAssetsRoot)) {
    return "public, max-age=300";
  }
  return "no-store";
}

export function createFrontendRouter({ config, logger }) {
  const router = express.Router();

  const indexPath = path.join(config.frontendPublicRoot, "index.html");
  let cachedRenderedHtml = "";

  function getRenderedIndexHtml() {
    if (!existsSync(indexPath)) {
      logger.warn("frontend index missing for SPA fallback", { indexPath });
      return null;
    }

    try {
      const rawHtml = readFileSync(indexPath, "utf8");
      cachedRenderedHtml = rawHtml.replaceAll("__UI_SOCKET_PATH__", config.webSocketPath);
    } catch (error) {
      logger.warn("failed to reload frontend index file; using cached copy", {
        path: indexPath,
        error: error?.message
      });
    }

    return cachedRenderedHtml;
  }

  function sendRenderedIndex(res) {
    const html = getRenderedIndexHtml();
    if (!html) {
      res.status(503).json({
        ok: false,
        error: "frontend bundle unavailable"
      });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).type("html").send(html);
  }

  router.get("/", (_req, res) => {
    sendRenderedIndex(res);
  });

  router.get("/index.html", (_req, res) => {
    sendRenderedIndex(res);
  });

  router.use(
    express.static(config.frontendPublicRoot, {
      index: false,
      setHeaders(res, filePath) {
        res.setHeader("Cache-Control", getCacheControl(filePath, config.frontendAssetsRoot));
      }
    })
  );

  router.use((_req, res) => {
    sendRenderedIndex(res);
  });

  return router;
}
