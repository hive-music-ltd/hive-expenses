export default async function handler(req, res) {
  // Allow CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { sheetsUrl, data } = req.body || {};

    if (!sheetsUrl || typeof sheetsUrl !== 'string') {
      return res.status(400).json({ error: 'Missing sheetsUrl' });
    }

    let parsed;
    try {
      parsed = new URL(sheetsUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid sheetsUrl' });
    }

    // Only allow Google Apps Script web-app URLs to prevent this endpoint
    // from being used as an open proxy. A substring check on the URL is
    // not enough — e.g. "https://evil.example/?x=script.google.com" would
    // pass — so we check the parsed hostname exactly.
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'script.google.com') {
      return res.status(400).json({ error: 'sheetsUrl must be an https://script.google.com URL' });
    }

    // Abort the upstream call if it hangs, so we don't sit here until
    // Vercel's function-level maxDuration kicks in.
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);

    let response;
    try {
      response = await fetch(parsed.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: ctrl.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        return res.status(504).json({ error: 'Upstream Apps Script timed out' });
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    return res.status(response.ok ? 200 : 502).json({
      ok: response.ok,
      status: response.status,
      result: text,
    });
  } catch (err) {
    console.error('Sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
