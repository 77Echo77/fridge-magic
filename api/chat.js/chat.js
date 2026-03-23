// api/chat.js — Vercel Serverless Function
// Key 存在 Vercel 环境变量 OPENROUTER_KEY 中，用户永远看不到

const DAILY_LIMIT = 10;

// 简单的内存限流（Vercel 函数无状态，用 IP + 日期做 key）
// 生产环境建议换成 Redis / KV，这里用轻量方案
const usageMap = new Map();

function getUsageKey(ip) {
  const today = new Date().toISOString().slice(0, 10); // "2025-03-23"
  return ip + '_' + today;
}

function checkRateLimit(ip) {
  const key = getUsageKey(ip);
  const count = usageMap.get(key) || 0;
  if (count >= DAILY_LIMIT) return false;
  usageMap.set(key, count + 1);
  return true;
}

function getClientIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

export default async function handler(req, res) {
  // CORS — 只允许同源请求
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只支持 POST 请求' });
  }

  // 检查 Key 是否配置
  const apiKey = process.env.OPENROUTER_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '服务未配置，请联系管理员' });
  }

  // IP 限流
  const ip = getClientIP(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: '今日免费次数已用完，明天再来！' });
  }

  // 解析请求体
  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: '请求格式错误' });
  }

  // 转发到 OpenRouter
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': req.headers['referer'] || 'https://fridge-magic.vercel.app',
        'X-Title': 'Fridge Magic Chef',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 1500,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: err.error?.message || 'AI 服务异常，请稍后重试',
      });
    }

    const data = await response.json();
    let text = data.choices?.[0]?.message?.content || '';
    // 验证 AI 返回的是有效 JSON
    try {
      JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch (e) {
      return res.status(500).json({ error: 'AI 返回格式错误，请重试' });
    }
    return res.status(200).json({ text });

  } catch (e) {
    console.error('OpenRouter error:', e);
    return res.status(500).json({ error: '网络异常，请稍后重试' });
  }
}
