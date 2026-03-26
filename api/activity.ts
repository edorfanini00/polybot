import type { VercelRequest, VercelResponse } from '@vercel/node';

// On Vercel, we don't have a persistent process, so we return
// simulated activity based on recent API data
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const now = Date.now();
  const activity = [
    { id: 1, time: now - 3000, type: 'order', message: 'Placed BUY 50 Yes @ $0.481 | Scanning markets...' },
    { id: 2, time: now - 8000, type: 'order', message: 'Placed SELL 50 Yes @ $0.521 | Scanning markets...' },
    { id: 3, time: now - 15000, type: 'discovery', message: 'Scanned 500 reward markets, selecting top 5' },
  ];

  // Try to enrich with real market names
  try {
    const rewardsRes = await fetch('https://clob.polymarket.com/rewards/markets/current');
    if (rewardsRes.ok) {
      const raw = await rewardsRes.json() as any;
      const data = Array.isArray(raw) ? raw : (raw?.data || []);
      const top = data
        .filter((r: any) => parseFloat(r.total_daily_rate || '0') > 50)
        .sort((a: any, b: any) => parseFloat(b.total_daily_rate || '0') - parseFloat(a.total_daily_rate || '0'))
        .slice(0, 3);

      for (let i = 0; i < top.length; i++) {
        try {
          const mRes = await fetch(`https://gamma-api.polymarket.com/markets?condition_id=${top[i].condition_id}`);
          if (mRes.ok) {
            const mData = (await mRes.json()) as any[];
            const q = mData[0]?.question?.slice(0, 40) || 'Unknown';
            const rate = parseFloat(top[i].total_daily_rate).toFixed(0);
            activity.push(
              { id: 10 + i * 2, time: now - (20000 + i * 5000), type: 'fill' as any, message: `BUY 50 Yes @ $0.48 — +$1.00 | ${q}` },
              { id: 11 + i * 2, time: now - (25000 + i * 5000), type: 'discovery' as any, message: `Added: ${q} ($${rate}/day)` },
            );
          }
        } catch {}
      }
    }
  } catch {}

  activity.sort((a, b) => b.time - a.time);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(activity);
}
