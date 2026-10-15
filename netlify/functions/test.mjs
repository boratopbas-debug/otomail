// Deneme (mail ATMAZ):
//   /api/test?key=...         → bulunan bildirimler, ekler, kime gideceği (JSON)
//   /api/test?key=...&html=1  → gidecek mailin görünümü
import { run } from "../../lib/job.mjs";

export default async (req) => {
  const q = new URL(req.url).searchParams;
  if (!process.env.ADMIN_KEY || q.get("key") !== process.env.ADMIN_KEY) return new Response("Yetkisiz", { status: 401 });
  const r = await run({ dryRun: true });
  if (q.get("html") === "1") return new Response(r.onizlemeHtml || `<pre>${JSON.stringify(r, null, 2)}</pre>`, { headers: { "content-type": "text/html; charset=utf-8" } });
  delete r.onizlemeHtml;
  return new Response(JSON.stringify(r, null, 2), { headers: { "content-type": "application/json; charset=utf-8" } });
};
