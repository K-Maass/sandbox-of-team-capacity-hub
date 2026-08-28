import { createFileRoute } from "@tanstack/react-router";
import { readdir, readFile, stat } from "fs/promises";
import JSZip from "jszip";
import path from "path";

const EXCLUDED_DIRS = new Set([
  "node_modules",
  "dist",
  "dist-ssr",
  ".output",
  ".vinxi",
  ".tanstack",
  ".nitro",
  ".wrangler",
  ".git",
  ".lovable",
  ".workspace",
  ".agents",
  ".claude",
]);

const EXCLUDED_FILES = new Set([
  ".DS_Store",
  "tsconfig.tsbuildinfo",
  "AGENTS.md",
  ".git",
]);

const EXCLUDED_FILE_PATTERNS = [/^\.env/, /\.log$/, /\.local$/];

function isExcludedFile(name: string): boolean {
  if (EXCLUDED_FILES.has(name)) return true;
  return EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

async function addDirectory(zip: JSZip, root: string, dir: string) {
  const entries = await readdir(dir);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const info = await stat(fullPath);

    if (info.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry)) continue;
      await addDirectory(zip, root, fullPath);
    } else if (info.isFile()) {
      if (isExcludedFile(entry)) continue;
      const relative = path.relative(root, fullPath);
      const content = await readFile(fullPath);
      zip.file(relative, content);
    }
  }
}

export const Route = createFileRoute("/api/public/export/zip")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const root = process.cwd();
          const zip = new JSZip();
          await addDirectory(zip, root, root);

          const buffer = await zip.generateAsync({ type: "arraybuffer" });

          return new Response(buffer, {
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": 'attachment; filename="capacity-board.zip"',
            },
          });
        } catch (error) {
          console.error("ZIP export failed:", error);
          return new Response("Failed to generate project ZIP", {
            status: 500,
          });
        }
      },
    },
  },
});
