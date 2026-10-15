// Her iş günü 09:30 (İstanbul) tetiklenir. Netlify zamanlamaları UTC: 06:30 UTC = 09:30 TRT.
// Zamanlanmış fonksiyonların süresi kısa olduğu için asıl işi arka plan fonksiyonuna (15 dk) devreder.
// Hafta sonu da göndermek istersen "1-5" yerine "*" yaz.
export default async () => {
  const base = process.env.URL;
  const key = process.env.ADMIN_KEY;
  if (base && key) await fetch(`${base}/.netlify/functions/send-background?key=${encodeURIComponent(key)}&auto=1`, { method: "POST" }).catch(() => {});
  return new Response("ok");
};

export const config = { schedule: "30 6 * * 1-5" };
