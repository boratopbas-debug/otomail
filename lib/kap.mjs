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
  const r = await req(`${KAP}/tr/api/notification/attachment-detail/${idx}`, { headers: { Accept: "application/json", Referer: `${KAP}/tr/Bildirim/${idx}` } });
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
    relatedStocks: pick("relatedStocks"),
    fundCode: pick("fundCode", "stockCode", "stockCodes", "relatedStocks"),
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

// KAP genel bildirim listesi (ana sayfadaki akış). Bir gün için tüm şirketlerin bildirimleri.
// Kaynak: https://github.com/caganco/trailingedge/blob/master/docs/KAP_ENDPOINT_NOTES.md
// Satır alanları: disclosureIndex, publishDate, kapTitle, subject, summary, disclosureClass, ...
// Liste en fazla 2000 satır döner; bu yüzden gün gün sorgulanır.
export const KAP_MEMBER_OID = "219472C133F901E0E0530A4AC92590EC"; // KAMUYU AYDINLATMA PLATFORMU
async function memberDisclosures(day, mkkMemberOidList = []) {
  const p = { fromDate: day, toDate: day, mkkMemberOidList, subjectList: [] };
  const r = await req(`${KAP}/tr/api/disclosure/members/byCriteria`, {
    method: "POST", body: JSON.stringify(p),
    headers: { "Content-Type": "application/json", Accept: "application/json", Referer: `${KAP}/tr/bildirim-sorgu` },
  });
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

export const ymd = d => new Date(d.getTime() + 3 * 3600e3).toISOString().slice(0, 10); // İstanbul günü
export const idxOf = x => Number(x.disclosureIndex ?? x.index ?? x.discIndex ?? 0);

// Günlerdeki konusu eşleşen bildirimler (idx listesi, eskiden yeniye).
// Önce sadece KAP'ın kendi bildirimleri (az satır); hiç satır gelmezse tüm şirketler.
export async function findBySubject({ subjectMatch, days, log = () => {} }) {
  const want = fold(subjectMatch);
  const found = new Set();
  let errors = 0;
  for (const day of days) {
    let rows = [], scope = "KAP";
    try {
      rows = await memberDisclosures(day, [env("KAP_MEMBER_OID") || KAP_MEMBER_OID]);
      if (!rows.length) { await sleep(600); rows = await memberDisclosures(day, []); scope = "tümü"; }
    } catch (e) { errors++; log(`${day}: KAP listesi alınamadı (${e.message})`); await sleep(1500); continue; }
    const hits = rows.filter(x => idxOf(x) && fold(`${x.subject ?? ""} ${x.summary ?? ""}`).includes(want));
    hits.forEach(x => found.add(idxOf(x)));
    if (rows.length >= 2000) { errors++; log(`${day}: liste 2000 satır sınırına takıldı, eksik olabilir`); }
    log(`${day}: ${rows.length} bildirim (${scope}), ${hits.length} eşleşme${hits.length ? " → " + hits.map(idxOf).join(", ") : ""}`);
    await sleep(800);
  }
  return { idxs: [...found].sort((a, b) => a - b), errors };
}
const env = (k) => (process.env[k] ?? "").toString().trim();

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
