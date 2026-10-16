// KAP'tan bildirim bulma ve ek dosya indirme.
// fonarama'da kullanılan KAP web API'leriyle aynı uç noktalar (resmi dokümante API değil).

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
export const KAP = "https://www.kap.org.tr";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function req(url, opts = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), opts.timeout || 25000);
      const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { "User-Agent": UA, ...(opts.headers || {}) } });
      clearTimeout(to);
      if (r.ok) return r;
      last = new Error(`HTTP ${r.status} ${url}`);
      if (r.status === 404 || r.status === 400) break;
    } catch (e) { last = e; }
    await sleep(1200 * (i + 1));
  }
  throw last;
}

// Türkçe karakterleri katlayıp büyük harfe çevir (metin eşleştirme için)
export const fold = s => String(s ?? "")
  .replace(/[Ġ]/g, "İ").replace(/[ġ]/g, "ş").replace(/[Ģ]/g, "Ş")
  .toLocaleUpperCase("tr")
  .replace(/[İI]/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C")
  .replace(/\s+/g, " ");

// Bildirim detayı (başlık, şirket, ekler, metin)
export async function getDetail(idx) {
  const r = await req(`${KAP}/tr/api/notification/attachment-detail/${idx}`, { headers: { Accept: "application/json" } });
  const j = await r.json();
  return Array.isArray(j) ? j[0] : j;
}

// Detaydan işimize yarayan alanları çıkar (alan adları değişirse diye esnek)
export function summarize(idx, det) {
  const basic = det?.disclosure?.disclosureBasic || det?.disclosureBasic || {};
  const pick = (...keys) => { for (const k of keys) if (basic[k]) return basic[k]; return ""; };
  const atts = (det?.attachments || []).map(a => ({ objId: a.objId, fileName: a.fileName || `ek.${a.fileExtension || "bin"}`, ext: String(a.fileExtension || a.fileName?.split(".").pop() || "").toLowerCase() }));
  const bodyHtml = (det?.disclosureBody || []).join(" ");
  return {
    idx: Number(idx),
    title: pick("title", "subject", "summary", "disclosureTitle"),
    company: pick("companyTitle", "companyName", "kapTitle"),
    fundCode: pick("fundCode", "stockCode", "stockCodes"),
    fundName: pick("fundTitle", "fundName"),
    publishDate: pick("publishDate", "publishedDate", "disclosureDate"),
    attachments: atts,
    bodyText: htmlToText(bodyHtml).slice(0, 6000),
    raw: basic,
  };
}

export function htmlToText(h) {
  return String(h || "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<\/t[dh]>/gi, "  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

// Bir günün fon bildirimleri (isteğe bağlı konu filtresiyle)
async function fundDisclosures(day, { fundTypeList = [], subjectList = [] } = {}) {
  const p = { fromDate: day, toDate: day, fundTypeList, mkkMemberOidList: [], fundOidList: [], passiveFundOidList: [], disclosureClass: "", isLate: "", subjectList, discIndex: [], fromSrc: false, srcCategory: "" };
  const r = await req(`${KAP}/tr/api/disclosure/funds/byCriteria`, {
    method: "POST", body: JSON.stringify(p),
    headers: { "Content-Type": "application/json", Accept: "application/json", Referer: `${KAP}/tr/bildirim-sorgu` },
  });
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

export const ymd = d => new Date(d.getTime() + 3 * 3600e3).toISOString().slice(0, 10); // İstanbul günü
export const idxOf = x => Number(x.disclosureIndex ?? x.index ?? x.discIndex ?? 0);
const trToIso = s => { const m = String(s || "").match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?/); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(s || "").slice(0, 10); };

// Bir günün tüm fon bildirim satırları (önce tüm tipler, boşsa YF). Hata olursa fırlatır.
async function dayList(day) {
  let last = null;
  for (const t of [[], ["YF"]]) {
    try { const l = await fundDisclosures(day, { fundTypeList: t }); if (l.length) return l; }
    catch (e) { last = e; }
    await sleep(400);
  }
  if (last) throw last;
  return [];
}

// Liste satırında imza için kullanılmayacak (her bildirimde farklı olan) alanlar
const SKIP_KEY = /index|date|time|fund(code|oid|title|name|id)|stock|company|title|^id$|attachment|year|period|ruletype|related|mkk|member/i;
const scalar = v => (typeof v === "string" || typeof v === "number" || typeof v === "boolean") && String(v).length > 0 && String(v).length < 300;

// Bilinen örnek bildirimlerden (refs) bu türün liste satırındaki ortak "imzasını" öğren.
// Her örnek için: detaydan yayın gününü al, o günün listesini bir kez çek, örneğin satırını bul.
// Tüm örneklerde aynı olan ve günün listesinde seçici olan alanlar imza olur.
export async function learnSignature(refs, log = () => {}) {
  const rows = [], lists = [];
  for (const ref of refs) {
    try {
      const s = summarize(ref, await getDetail(ref));
      const day = trToIso(s.publishDate);
      await sleep(400);
      const list = await dayList(day);
      const row = list.find(x => idxOf(x) === Number(ref));
      log(`Örnek ${ref} (${day}): günde ${list.length} satır, örnek satır ${row ? "bulundu" : "BULUNAMADI"}`);
      if (row) { rows.push(row); lists.push(list); log(`Örnek satır: ${JSON.stringify(row).slice(0, 700)}`); }
      await sleep(600);
    } catch (e) { log(`Örnek ${ref}: ${e.message}`); }
  }
  if (!rows.length) return null;
  const sig = {};
  for (const [k, v] of Object.entries(rows[0])) {
    if (SKIP_KEY.test(k) || !scalar(v)) continue;
    if (!rows.every(r => String(r[k]) === String(v))) continue;
    // seçicilik: örnek günlerinde bu değere sahip satırların oranı
    const frac = Math.max(...lists.map(l => l.filter(x => String(x[k]) === String(v)).length / l.length));
    if (frac <= 0.3) sig[k] = String(v);
  }
  if (!Object.keys(sig).length) { log("Seçici ortak alan bulunamadı."); return null; }
  const hits = lists.map(l => l.filter(x => Object.entries(sig).every(([k, v]) => String(x[k]) === v)).length);
  log(`Öğrenilen imza: ${JSON.stringify(sig)} (örnek günlerinde eşleşen satır: ${hits.join(", ")})`);
  return sig;
}

// Günlerdeki bu türdeki bildirimler (idx listesi, eskiden yeniye).
// 1) Günlerin fon bildirim listelerini çeker (gün başına 1 istek).
// 2) İmza yoksa, bilinen örnek bildirimleri (refs) bu listelerde bulup imzayı öğrenir.
// 3) İmzayla (veya satırdaki metinle) eşleşen adayların detayını açıp başlığı doğrular.
export async function findBySubject({ signature, refs = [], subjectMatch, days, checked = {}, log = () => {} }) {
  const want = fold(subjectMatch);
  const MAX_DETAIL = 40;
  const found = new Set();
  let errors = 0;
  const lists = {};
  for (const day of days) {
    try { lists[day] = await dayList(day); }
    catch (e) { errors++; log(`${day}: KAP listesi alınamadı (${e.message})`); }
    await sleep(800);
  }

  // imza öğrenme
  if (!signature && refs.length) {
    const refSet = new Set(refs.map(Number));
    const rows = [], refDays = [];
    for (const [day, l] of Object.entries(lists)) for (const x of l) if (refSet.has(idxOf(x))) { rows.push(x); refDays.push(day); }
    for (const r of refs) {
      const i = rows.findIndex(x => idxOf(x) === Number(r));
      if (i >= 0) log(`Örnek ${r}: ${refDays[i]} fon listesinde bulundu → ${JSON.stringify(rows[i]).slice(0, 700)}`);
      else {
        log(`Örnek ${r}: taranan günlerin FON bildirim listelerinde YOK`);
        try { const s = summarize(r, await getDetail(r)); log(`Örnek ${r} detayı: ${JSON.stringify(s.raw).slice(0, 900)}`); } catch (e) { log(`Örnek ${r} detayı alınamadı: ${e.message}`); }
        await sleep(400);
      }
    }
    if (rows.length) {
      const sig = {};
      const L = Object.values(lists).filter(l => l.length);
      for (const [k, v] of Object.entries(rows[0])) {
        if (SKIP_KEY.test(k) || !scalar(v)) continue;
        if (!rows.every(r => String(r[k]) === String(v))) continue;
        const total = L.reduce((a, l) => a + l.length, 0), same = L.reduce((a, l) => a + l.filter(x => String(x[k]) === String(v)).length, 0);
        if (total && same / total <= 0.3) sig[k] = String(v);
      }
      if (Object.keys(sig).length) { signature = sig; log(`Öğrenilen imza: ${JSON.stringify(sig)}`); }
      else log("Örneklerde seçici ortak alan bulunamadı.");
    }
  }

  const sigOk = x => signature && Object.entries(signature).every(([k, v]) => String(x[k]) === v);
  for (const day of days) {
    const all = lists[day]; if (!all) continue;
    const cands = all.filter(x => idxOf(x) && (sigOk(x) || fold(JSON.stringify(x)).includes(want) || refs.map(Number).includes(idxOf(x))));
    let hit = 0, opened = 0;
    for (const x of cands) {
      const i = idxOf(x);
      if (checked[i] !== undefined) { if (checked[i]) { found.add(i); hit++; } continue; }
      if (fold(JSON.stringify(x)).includes(want)) { checked[i] = true; found.add(i); hit++; continue; }
      if (opened >= MAX_DETAIL) { errors++; log(`${day}: ${cands.length} aday var, ilk ${MAX_DETAIL} tanesi kontrol edildi`); break; }
      try {
        const s = summarize(i, await getDetail(i));
        opened++;
        checked[i] = fold(`${s.title} ${JSON.stringify(s.raw)} ${s.bodyText}`).includes(want);
        if (checked[i]) { found.add(i); hit++; }
      } catch (e) { errors++; log(`${i}: detay alınamadı (${e.message})`); }
      await sleep(300);
    }
    log(`${day}: ${all.length} fon bildirimi, ${cands.length} aday, ${hit} eşleşme (${opened} detay açıldı)`);
  }
  return { idxs: [...found].sort((a, b) => a - b), errors, signature };
}

// KAP dosya indirmesinin başındaki serileştirme başlığını at
export function stripKapHeader(buf, ext) {
  const b = Buffer.from(buf);
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]), ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);
  const sigs = { pdf: [Buffer.from("%PDF")], xlsx: [zip], docx: [zip], pptx: [zip], zip: [zip], xls: [ole], doc: [ole] };
  for (const sig of sigs[ext] || [Buffer.from("%PDF"), zip, ole]) { const i = b.indexOf(sig); if (i > 0 && i < 1000) return b.subarray(i); }
  return b;
}

export async function downloadAttachment(a) {
  const r = await req(`${KAP}/tr/api/file/download/${a.objId}`, { timeout: 60000 });
  return stripKapHeader(Buffer.from(await r.arrayBuffer()), a.ext);
}

export const kapLink = idx => `${KAP}/tr/Bildirim/${idx}`;
