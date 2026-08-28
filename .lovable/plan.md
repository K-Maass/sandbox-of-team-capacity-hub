Add a one-click ZIP export of the project source

Overview
--------
Provide a button inside the app that downloads `capacity-board.zip`, containing all the code the user needs to push to GitHub manually. The archive skips dependencies and build/private folders.

What will change
----------------
1. Add `jszip` dependency so the server can build a ZIP in memory.
2. Create a public server route at `src/routes/api/public/export/zip.tsx`:
   - GET handler walks the project root with `fs/promises`.
   - Adds readable files into a JSZip archive under their relative path.
   - Excludes: `node_modules`, `dist`, `dist-ssr`, `.output`, `.vinxi`, `.tanstack`, `.nitro`, `.wrangler`, `.git`, `.lovable`, `.workspace`, `.env*`, `*.local`, `*.log`, logs, `.DS_Store`, build info.
   - Returns the ZIP as a `Response` with:
     - `Content-Type: application/zip`
     - `Content-Disposition: attachment; filename="capacity-board.zip"`
3. Add an "Export ZIP" download button to the existing `AppHeader` next to the navigation links. It will be a plain `<a href="/api/public/export/zip" download>` styled as a button, so the browser triggers the download.
4. (Optional) If no `README.md` exists, create a short one with install/run instructions so the GitHub upload is immediately usable.

Technical details
-----------------
- The endpoint is placed under `/api/public/*` because it is meant to be called by the browser without an auth gate.
- The handler reads `process.cwd()` as the project root. This works in the current dev/preview server where the source tree is present.
- Source files included: `package.json`, `bun.lock`, `bunfig.toml`, `components.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `src/**/*`, `public/**/*`, `README.md`, `.gitignore`.
- No changes to the consultant/demand data model or UI; this is a pure project-export utility.

Verification
------------
- Open the app, click the new "Export ZIP" button, and confirm a ZIP downloads.
- Inspect the ZIP to make sure it contains `src/`, `package.json`, and the frontend code, and that `node_modules`, `.git`, and `.lovable` are absent.
- Build the app to check that the new route and dependency compile cleanly.
