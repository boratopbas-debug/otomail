// Gönderim (arka planda, 15 dk'ya kadar). Her sabah daily.mjs tetikler.
// Elle: /api/send-now?key=...   (sonucu /api/status gösterir)
import { run } from "../../lib/job.mjs";

export default async (req) => {
  const q = new URL(req.url).searchParams;
  if (!process.env.ADMIN_KEY || q.get("key") !== process.env.ADMIN_KEY) return;
  await run({ force: q.get("auto") !== "1" });
};
