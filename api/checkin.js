import { Redis } from '@upstash/redis';

const redisUrl =
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL ||
  process.env.KV_URL;

const redisToken =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN ||
  process.env.KV_REST_API_READ_ONLY_TOKEN;

const GUESTS_KEY = 'wedding_checkin_guests_v2';
// Redeploy marker after Redis storage connection

function getRedis() {
  if (!redisUrl || !redisToken) {
    throw new Error(
      'REDIS_ENV_MISSING: 請確認 Vercel 專案已注入 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN，或 KV_REST_API_URL / KV_REST_API_TOKEN'
    );
  }

  return new Redis({
    url: redisUrl,
    token: redisToken,
  });
}

function normalizeGuest(guest) {
  return {
    id: Number(guest.id),
    name: String(guest.name || '').trim(),
    table: Number(guest.table),
    expected: Math.max(1, Number(guest.expected) || 1),
    actual: Math.max(0, Number(guest.actual) || 0),
    gift: Math.max(0, Number(guest.gift) || 0),
    noGift: Boolean(guest.noGift),
    note: String(guest.note || ''),
    checked: Boolean(guest.checked),
  };
}

function normalizeGuestList(guests) {
  if (!Array.isArray(guests)) return [];
  return guests
    .map(normalizeGuest)
    .filter((g) => g.id && g.name && g.table >= 1 && g.table <= 23)
    .sort((a, b) => a.id - b.id);
}

async function readGuests(redis) {
  const value = await redis.get(GUESTS_KEY);
  return normalizeGuestList(Array.isArray(value) ? value : []);
}

async function writeGuests(redis, guests) {
  const normalized = normalizeGuestList(guests);
  await redis.set(GUESTS_KEY, normalized);
  return normalized;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  try {
    const redis = getRedis();

    if (req.method === 'GET') {
      const guests = await readGuests(redis);
      return res.status(200).json({
        guests,
        redisConnected: true,
      });
    }

    if (req.method === 'POST') {
      const action = req.body?.action;

      if (action === 'upsert') {
        const guest = normalizeGuest(req.body?.guest || {});
        if (!guest.id || !guest.name || guest.table < 1 || guest.table > 23) {
          return res.status(400).json({ error: '賓客資料不完整' });
        }

        const guests = await readGuests(redis);
        const index = guests.findIndex((item) => item.id === guest.id);

        if (index >= 0) guests[index] = guest;
        else guests.push(guest);

        const saved = await writeGuests(redis, guests);
        return res.status(200).json({ guest, guests: saved });
      }

      if (action === 'replaceAll') {
        const incoming = req.body?.guests;
        if (!Array.isArray(incoming)) {
          return res.status(400).json({ error: '缺少賓客資料' });
        }

        const guests = await writeGuests(redis, incoming);
        return res.status(200).json({ guests });
      }

      if (action === 'init') {
        const current = await readGuests(redis);
        if (current.length) {
          return res.status(200).json({ guests: current });
        }

        const incoming = Array.isArray(req.body?.guests) ? req.body.guests : [];
        const guests = await writeGuests(redis, incoming);
        return res.status(200).json({ guests });
      }

      return res.status(400).json({ error: '未知的操作' });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    console.error('Wedding check-in API error:', error);

    const message = String(error?.message || error);
    const isEnvError = message.includes('REDIS_ENV_MISSING');

    return res.status(500).json({
      error: isEnvError
        ? 'Vercel 找不到 Upstash Redis 環境變數'
        : '雲端同步失敗',
      detail: isEnvError
        ? message.replace('REDIS_ENV_MISSING: ', '')
        : '請查看 Vercel Function Logs 的 /api/checkin 錯誤訊息',
    });
  }
}
