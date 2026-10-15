// Son çalışmanın kaydı: /api/status?key=...
import { getState } from "../../lib/job.mjs";

export default async (req) => {
  const key = new URL(req.url).searchParams.get("key");
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) return new Response("Yetkisiz", { status: 401 });
  return new Response(JSON.stringify(await getState(), null, 2), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
};
