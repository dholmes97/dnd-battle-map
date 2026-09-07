import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "vite";

/** Local previews have no production R2 objects. Keep this adapter out of builds. */
export async function localCreatureDisplayBytes(root: string, pathname: string): Promise<Buffer | null> {
  const match = pathname.match(/^\/creature-assets\/display\/v1\/(tokens\/(?:catalog|creatures|monsters)\/[a-z0-9_-]+)\.webp$/);
  if (!match) return null;
  const sourceKey = match[1];
  const prepared = join(root, ".working/creature-display-webp-v1/r2/creature-catalog/display", `${sourceKey}.webp`);
  try {
    return await readFile(prepared);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const source = join(root, "public/assets", `${sourceKey}.webp`);
  try {
    return await readFile(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function localCreatureDisplay(): Plugin {
  let root = process.cwd();
  return {
    name: "local-creature-display",
    apply: "serve",
    configResolved(config) { root = config.root; },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== "GET" && request.method !== "HEAD") return next();
        try {
          const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
          const bytes = await localCreatureDisplayBytes(root, pathname);
          if (!bytes) return next();
          response.writeHead(200, {
            "content-type": "image/webp",
            "content-length": bytes.length,
            "cache-control": "no-store",
            "x-creature-asset-source": "local-development-webp",
            "x-content-type-options": "nosniff",
          });
          response.end(request.method === "HEAD" ? undefined : bytes);
        } catch (error) { next(error); }
      });
    },
  };
}
