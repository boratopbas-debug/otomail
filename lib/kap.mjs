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

// Referans bildirimden konunun KAP kimliğini (subject OID) öğren:
// detaydaki 32 haneli kimlikleri tek tek konu filtresi olarak dener; referansı geri döndüren doğrudur.
export async function learnSubjectOid(refIdx, log = () => {}) {
  const det = await getDetail(refIdx);
  const s = summarize(refIdx, det);
  const day = trToIso(s.publishDate);
  const cands = [...new Set((JSON.stringify(det).match(/\b[0-9a-f]{32}\b/gi) || []).map(x => x.toLowerCase()))];
  log(`Referans ${refIdx} (${day}): ${cands.length} aday kimlik`);
  for (const t of [[], ["YF"]]) {
    for (const oid of cands) {
      try {
        const list = await fundDisclosures(day, { fundTypeList: t, subjectList: [oid] });
        if (list.some(x => idxOf(x) === Number(refIdx))) { log(`Konu kimliği bulundu: ${oid}`); return oid; }
      } catch {}
      await sleep(120);
    }
  }
  log("Konu kimliği bulunamadı; başlık metniyle aranacak.");
  return null;
}

// Günlerdeki konusu eşleşen tüm bildirimler (idx listesi, eskiden yeniye).
// 1) Konu kimliği varsa onunla filtreler.
// 2) Sonuç yoksa günün TÜM fon bildirimlerinin detayına bakıp başlıkla eşleştirir
//    (KAP'ın liste satırında başlık olmayabiliyor). Başlıklar titleCache'te saklanır.
export async function findBySubject({ subjectOid, subjectMatch, days, titleCache = {}, deadline = Infinity, log = () => {} }) {
  const want = fold(subjectMatch);
  const found = new Set();
  let errors = 0;
  for (const day of days) {
    let viaOid = [];
    if (subjectOid) {
      for (const t of [[], ["YF"]]) {
        try { viaOid = await fundDisclosures(day, { fundTypeList: t, subjectList: [subjectOid] }); if (viaOid.length) break; } catch (e) { errors++; log(`${day} konu sorgusu: ${e.message}`); }
      }
      viaOid.forEach(x => idxOf(x) && found.add(idxOf(x)));
    }

    // tüm fon bildirimleri
    let all = [];
    for (const t of [[], ["YF"]]) {
      try { all = await fundDisclosures(day, { fundTypeList: t }); if (all.length) break; } catch (e) { errors++; log(`${day} liste: ${e.message}`); }
    }
    if (all.length && day === days[days.length - 1]) log(`Liste satırı alanları: ${Object.keys(all[0]).join(", ")}`);
    let hit = 0, checked = 0;
    const todo = [];
    for (const x of all) {
      const i = idxOf(x); if (!i) continue;
      if (fold(JSON.stringify(x)).includes(want)) { found.add(i); hit++; continue; }
      if (titleCache[i] !== undefined) { if (fold(titleCache[i]).includes(want)) { found.add(i); hit++; } continue; }
      todo.push(i);
    }
    // detaylara 4'er paralel bak
    for (let k = 0; k < todo.length; k += 4) {
      if (Date.now() > deadline) { log(`${day}: süre doldu, ${todo.length - k} bildirim kontrol edilemedi`); errors++; break; }
      await Promise.all(todo.slice(k, k + 4).map(async i => {
        try {
          const s = summarize(i, await getDetail(i));
          titleCache[i] = `${s.title} ${JSON.stringify(s.raw)}`.slice(0, 600);
          checked++;
          if (fold(titleCache[i]).includes(want)) { found.add(i); hit++; }
        } catch (e) { errors++; }
      }));
      await sleep(100);
    }
    log(`${day}: ${all.length} fon bildirimi, konu sorgusu ${viaOid.length}, başlık eşleşmesi ${hit} (${checked} detay kontrol edildi)`);
  }
  return { idxs: [...found].sort((a, b) => a - b), errors };
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
