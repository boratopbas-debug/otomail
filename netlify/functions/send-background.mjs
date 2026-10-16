// Arka planda çalışır (15 dk'ya kadar).
//   Her sabah daily.mjs tetikler (auto=1).
//   /api/send-now?key=...  → şimdi gönder
//   /api/test?key=...      → dry=1 ile buraya gelir: mail atmadan önizleme hazırlar
import { run } from "../../lib/job.mjs";

export default async (req) => {
  const q = new URL(req.url).searchParams;
  if (!process.env.ADMIN_KEY || q.get("key") !== process.env.ADMIN_KEY) return;
  if (q.get("dry") === "1") await run({ dryRun: true });
  else await run({ force: q.get("auto") !== "1" });
};
