import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const GUESTS_KEY = 'wedding_checkin_guests_v1';

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

function decodeGuests(hash) {
  if (!hash || typeof hash !== 'object') return [];
  return Object.values(hash)
    .map((value) => {
      try {
        return typeof value === 'string' ? JSON.parse(value) : value;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => Number(a.id) - Number(b.id));
}

async function writeAllGuests(guests) {
  await redis.del(GUESTS_KEY);
  if (!guests.length) return;

  const payload = {};
  for (const guest of guests) {
    const normalized = normalizeGuest(guest);
    if (!normalized.id || !normalized.name || !normalized.table) continue;
    payload[String(normalized.id)] = JSON.stringify(normalized);
  }

  if (Object.keys(payload).length) {
    await redis.hset(GUESTS_KEY, payload);
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  try {
    if (req.method === 'GET') {
      const hash = await redis.hgetall(GUESTS_KEY);
      return res.status(200).json({ guests: decodeGuests(hash) });
    }

    if (req.method === 'POST') {
      const action = req.body?.action;

      if (action === 'upsert') {
        const guest = normalizeGuest(req.body?.guest || {});
        if (!guest.id || !guest.name || !guest.table) {
          return res.status(400).json({ error: '賓客資料不完整' });
        }

        await redis.hset(GUESTS_KEY, {
          [String(guest.id)]: JSON.stringify(guest),
        });

        return res.status(200).json({ guest });
      }

      if (action === 'replaceAll') {
        const guests = Array.isArray(req.body?.guests) ? req.body.guests : null;
        if (!guests) {
          return res.status(400).json({ error: '缺少賓客資料' });
        }

        await writeAllGuests(guests);
        return res.status(200).json({ guests: guests.map(normalizeGuest) });
      }

      if (action === 'init') {
        const guests = Array.isArray(req.body?.guests) ? req.body.guests : [];
        const count = await redis.hlen(GUESTS_KEY);

        if (count === 0 && guests.length) {
          await writeAllGuests(guests);
        }

        const hash = await redis.hgetall(GUESTS_KEY);
        return res.status(200).json({ guests: decodeGuests(hash) });
      }

      return res.status(400).json({ error: '未知的操作' });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    console.error('Wedding check-in API error:', error);
    return res.status(500).json({ error: '雲端同步失敗' });
  }
}
