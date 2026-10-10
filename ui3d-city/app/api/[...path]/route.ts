import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/* The same /api routes as builders-hub, served from snapshots in fixtures/ so the City runs offline and never polls
   their server. A snapshot is taken once: with SNAPSHOT_RECORD=1 a route that has no file yet is fetched from the
   public site a single time and saved (scripts/snapshot.mjs does the same from the recorded list). */
const UPSTREAM = "https://build.avax.network";
const DIR = join(process.cwd(), "fixtures");
export const dynamic = "force-dynamic";

type Snap = { url: string; method: string; status: number; contentType: string; takenAt: string; body: string };

function keyOf(method: string, path: string, search: string, body: string) {
  const q = new URLSearchParams(search);
  q.sort();
  const raw = `${method} ${path}?${q.toString()}${body ? ` ${body}` : ""}`;
  const slug = `${method}_${path}`.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 80);
  return { file: `${slug}_${createHash("sha1").update(raw).digest("hex").slice(0, 10)}.json`, raw };
}

async function serve(req: Request, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const url = new URL(req.url);
  const apiPath = `/api/${path.join("/")}`;
  const body = req.method === "GET" ? "" : await req.text();
  const { file } = keyOf(req.method, apiPath, url.search, body);
  try {
    const snap = JSON.parse(await readFile(join(DIR, file), "utf8")) as Snap;
    return new Response(snap.body, { status: snap.status, headers: { "content-type": snap.contentType, "x-snapshot": snap.takenAt } });
  } catch {
    if (process.env.SNAPSHOT_RECORD !== "1") {
      return Response.json({ error: "no snapshot for this route", route: `${req.method} ${apiPath}${url.search}` }, { status: 404, headers: { "x-snapshot": "missing" } });
    }
  }
  const target = `${UPSTREAM}${apiPath}${url.search}`;
  const res = await fetch(target, { method: req.method, body: body || undefined, headers: body ? { "content-type": req.headers.get("content-type") ?? "application/json" } : undefined });
  const text = await res.text();
  const snap: Snap = { url: target, method: req.method, status: res.status, contentType: res.headers.get("content-type") ?? "application/json", takenAt: new Date().toISOString(), body: text };
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, file), JSON.stringify(snap));
  // the list scripts/snapshot.mjs replays
  const listFile = join(DIR, "_routes.json");
  const list: { method: string; path: string; search: string; body: string; file: string }[] = await readFile(listFile, "utf8").then((t) => JSON.parse(t)).catch(() => []);
  if (!list.some((l) => l.file === file)) list.push({ method: req.method, path: apiPath, search: url.search, body, file });
  await writeFile(listFile, JSON.stringify(list, null, 2));
  console.log(`[snapshot] ${res.status} ${req.method} ${apiPath}${url.search} -> fixtures/${file}`);
  return new Response(text, { status: res.status, headers: { "content-type": snap.contentType, "x-snapshot": snap.takenAt } });
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return serve(req, ctx.params);
}
export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return serve(req, ctx.params);
}
