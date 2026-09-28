import { createClient } from 'redis';

const GUESTS_KEY = 'wedding_checkin_guests_v2';

let clientPromise;

async function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_ENV_MISSING: Vercel 尚未提供 REDIS_URL');
  }

  if (!clientPromise) {
    const client = createClient({ url });
    client.on('error', (err) => {
      console.error('Redis client error:', err);
    });
    clientPromise = client.connect().then(() => client);
  }

  return clientPromise;
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
  const raw = await redis.get(GUESTS_KEY);
  if (!raw) return [];
  try {
    return normalizeGuestList(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function writeGuests(redis, guests) {
  const normalized = normalizeGuestList(guests);
  await redis.set(GUESTS_KEY, JSON.stringify(normalized));
  return normalized;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  try {
    const redis = await getRedis();

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
      error: isEnvError ? 'Vercel 找不到 REDIS_URL' : '雲端同步失敗',
      detail: isEnvError
        ? '請確認 Vercel Storage 已連到 wedding 專案，並且 REDIS_URL 套用到 Production'
        : message,
    });
  }
}
