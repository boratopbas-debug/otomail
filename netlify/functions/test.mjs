// Deneme (mail ATMAZ). Uzun sürdüğü için arka planda çalışır; bu sayfa sonucu bekleyip gösterir.
//   /api/test?key=...           → denemeyi başlatır, bitince gidecek maili ve kaydı gösterir
//   /api/test?key=...&sonuc=1   → son denemenin kaydı (JSON)
//   /api/test?key=...&html=1    → son denemenin mail görünümü
import { getState, getPreview } from "../../lib/job.mjs";

const page = (body) => new Response(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KAP mail deneme</title>
<style>body{font-family:system-ui,sans-serif;margin:0;background:#EDF0EF;color:#16233A}.bar{padding:14px 20px;background:#fff;border-bottom:1px solid #D5DBDA;font-size:14px}
pre{white-space:pre-wrap;font-size:12px;background:#fff;margin:16px;padding:12px;border-radius:8px;border:1px solid #D5DBDA}iframe{width:100%;height:75vh;border:0}</style></head><body>${body}</body></html>`,
  { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

export default async (req) => {
  const u = new URL(req.url), q = u.searchParams, key = q.get("key");
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) return new Response("Yetkisiz", { status: 401 });

  if (q.get("sonuc") === "1") {
    const st = await getState();
    return new Response(JSON.stringify(st.lastTest || {}, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
  if (q.get("html") === "1") {
    const h = await getPreview();
    return new Response(h || "Henüz önizleme yok. Önce /api/test?key=... ile deneme başlat.", { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }

  // denemeyi arka planda başlat
  const started = new Date().toISOString();
  const base = process.env.URL || u.origin;
  await fetch(`${base}/.netlify/functions/send-background?key=${encodeURIComponent(key)}&dry=1`, { method: "POST" }).catch(() => {});
  const k = encodeURIComponent(key);
  return page(`<div class="bar" id="s">Deneme başladı, KAP taranıyor… (ilk seferde 1–3 dakika sürebilir)</div>
<div id="out"></div>
<script>
const started=${JSON.stringify(started)}, k=${JSON.stringify(k)};
async function tick(){
  try{
    const r=await (await fetch('/api/test?key='+k+'&sonuc=1',{cache:'no-store'})).json();
    if(r.zaman && r.zaman>=started){
      const n=(r.bildirimler||[]).length;
      document.getElementById('s').textContent='Deneme bitti: '+n+' bildirim bulundu. Mail gönderilmedi. Göndermek için /api/send-now?key=… aç.';
      document.getElementById('out').innerHTML='<iframe src="/api/test?key='+k+'&html=1"></iframe><pre></pre>';
      document.querySelector('#out pre').textContent=(r.log||[]).join('\\n')+(r.hata?'\\nHATA: '+r.hata:'');
      return;
    }
  }catch(e){}
  setTimeout(tick,5000);
}
setTimeout(tick,5000);
</script>`);
};
