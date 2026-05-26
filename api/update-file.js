export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const GITHUB_PAT = process.env.GITHUB_PAT;
  const PUBLISH_SECRET = process.env.PUBLISH_SECRET;

  if (!GITHUB_PAT) return res.status(500).json({ error: 'GITHUB_PAT not configured' });

  const authHeader = req.headers['x-publish-secret'] || req.body?.secret;
  if (PUBLISH_SECRET && authHeader !== PUBLISH_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing publish secret' });
  }

  const { path, content, message } = req.body || {};

  if (!path || typeof path !== 'string') {
    return res.status(400).json({ error: '"path" string required (e.g. "index.html")' });
  }

  if (content === undefined || content === null) {
    return res.status(400).json({ error: '"content" required (string for text, object for JSON)' });
  }

  const blocked = ['.env', '.git/', 'node_modules/'];
  if (blocked.some(b => path.includes(b))) {
    return res.status(403).json({ error: 'Cannot update protected paths: ' + path });
  }

  const REPO = 'turgutderman/mirthplus-dashboard';
  const GITHUB_API = `https://api.github.com/repos/${REPO}/contents/${path}`;

  const headers = {
    'Authorization': `Bearer ${GITHUB_PAT}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'MirthPlus-File-Updater'
  };

  try {
    let currentSha = null;
    const getRes = await fetch(GITHUB_API, { headers });

    if (getRes.ok) {
      const currentFile = await getRes.json();
      currentSha = currentFile.sha;
    } else if (getRes.status !== 404) {
      const errBody = await getRes.text();
      return res.status(502).json({ error: 'Failed to fetch file', status: getRes.status, detail: errBody });
    }

    const textContent = typeof content === 'object' ? JSON.stringify(content, null, 2) + '\n' : content;
    const base64Content = Buffer.from(textContent).toString('base64');
    const commitMessage = message || `Update ${path} — ${new Date().toISOString().split('T')[0]}`;

    const putBody = {
      message: commitMessage,
      content: base64Content,
      committer: { name: 'MirthPlus Dashboard Bot', email: 'bot@mirthplus.com' }
    };

    if (currentSha) putBody.sha = currentSha;

    const putRes = await fetch(GITHUB_API, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(putBody)
    });

    if (!putRes.ok) {
      const errBody = await putRes.text();
      return res.status(502).json({ error: 'Failed to commit', status: putRes.status, detail: errBody });
    }

    const result = await putRes.json();

    return res.status(200).json({
      success: true, path,
      commit: result.commit?.sha?.substring(0, 7) || 'unknown',
      message: commitMessage,
      created: !currentSha,
      note: 'Vercel will auto-redeploy in ~30-60 seconds.'
    });

  } catch (err) {
    console.error('Update file error:', err);
    return res.status(500).json({ error: 'Internal error', message: err.message });
  }
}
