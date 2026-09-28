import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const TODO_KEY = 'shared_todos_v1';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const storedTodos = await redis.get(TODO_KEY);
      const todos = Array.isArray(storedTodos) ? storedTodos : [];

      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ todos });
    }

    if (req.method === 'POST') {
      const text =
        typeof req.body?.text === 'string'
          ? req.body.text.trim()
          : '';

      if (!text) {
        return res.status(400).json({ error: '請輸入待辦事項' });
      }

      const storedTodos = await redis.get(TODO_KEY);
      const todos = Array.isArray(storedTodos) ? storedTodos : [];

      const todo = {
        id: crypto.randomUUID(),
        text,
        createdAt: new Date().toISOString(),
      };

      const nextTodos = [todo, ...todos];
      await redis.set(TODO_KEY, nextTodos);

      return res.status(201).json({
        todo,
        todos: nextTodos,
      });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    console.error('Todo API error:', error);
    return res.status(500).json({ error: '伺服器暫時無法處理請求' });
  }
}
