// netlify/functions/chat.js
// Netlify Serverless Function — Key 存在环境变量 OPENROUTER_KEY 中

const DAILY_LIMIT = 10;
const usageMap = new Map();

function getUsageKey(ip) {
  const today = new Date().toISOString().slice(0, 10);
  return ip + '_' + today;
}

function checkRateLimit(ip) {
  const key = getUsageKey(ip);
  const count = usageMap.get(key) || 0;
  if (count >= DAILY_LIMIT) return false;
  usageMap.set(key, count + 1);
  return true;
}

exports.handler = async function (event, context) {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // 处理预检请求
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: '只支持 POST 请求' }) };
  }

  // 检查 Key
  const apiKey = process.env.OPENROUTER_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: '服务未配置，请联系管理员' }) };
  }

  // IP 限流
  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || event.headers['x-real-ip']
    || 'unknown';

  if (!checkRateLimit(ip)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: '今日免费次数已用完，明天再来！' }) };
  }

  // 解析请求体
  let messages;
  try {
    const body = JSON.parse(event.body || '{}');
    messages = body.messages;
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: '请求格式错误' }) };
  }

  if (!messages || !Array.isArray(messages)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: '请求格式错误' }) };
  }

  // 转发到 OpenRouter
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': event.headers['referer'] || 'https://fridge-magic.netlify.app',
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
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: err.error?.message || 'AI 服务异常，请稍后重试' }),
      };
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    return { statusCode: 200, headers, body: JSON.stringify({ text }) };

  } catch (e) {
    console.error('OpenRouter error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: '网络异常，请稍后重试' }) };
  }
};
