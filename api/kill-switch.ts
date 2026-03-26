export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ success: true, status: 'demo_mode' });
}
