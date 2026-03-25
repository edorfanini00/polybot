import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  let markets: any[] = [];

  try {
    // Fetch reward markets
    const rewardsRes = await fetch('https://clob.polymarket.com/rewards/markets/current');
    if (!rewardsRes.ok) throw new Error('Rewards API failed');

    const raw = await rewardsRes.json() as any;
    const data = Array.isArray(raw) ? raw : (raw?.data || []);

    const top5 = data
      .map((r: any) => ({
        conditionId: r.condition_id,
        daily: parseFloat(r.total_daily_rate || '0'),
      }))
      .filter((r: any) => r.daily > 30)
      .sort((a: any, b: any) => b.daily - a.daily)
      .slice(0, 5);

    // Enrich with Gamma API
    for (const r of top5) {
      try {
        const mRes = await fetch(`https://gamma-api.polymarket.com/markets?condition_id=${r.conditionId}`);
        if (!mRes.ok) continue;
        const mData = (await mRes.json()) as any[];
        const m = mData[0];
        if (!m) continue;

        // Fetch midpoint
        let midpoint = 0.5;
        try {
          const tokenId = m.clobTokenIds?.[0] || '';
          if (tokenId) {
            const bookRes = await fetch(`https://clob.polymarket.com/midpoint?token_id=${tokenId}`);
            if (bookRes.ok) {
              const bookData = await bookRes.json() as any;
              midpoint = parseFloat(bookData?.mid || '0.5') || 0.5;
            }
          }
        } catch {}

        markets.push({
          id: r.conditionId,
          question: m.question || 'Unknown Market',
          rewardPool: r.daily,
          capital: 500,
          midpoint,
          spread: 0.02,
          paused: false,
          inventorySkew: Math.random() * 0.3,
          netInventory: Math.floor(Math.random() * 10 - 5),
          liveOrders: [
            { side: 'BUY', outcome: 'Yes', price: +(midpoint - 0.02).toFixed(3), size: 50 },
            { side: 'SELL', outcome: 'Yes', price: +(midpoint + 0.02).toFixed(3), size: 50 },
          ],
          fills: [],
        });
      } catch {}
    }
  } catch {}

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(markets);
}
