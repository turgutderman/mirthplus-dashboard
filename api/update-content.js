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

  const { content, message } = req.body || {};

  if (!content || typeof content !== 'object') {
    return res.status(400).json({ error: 'Request body must include a "content" object' });
  }

  const REPO = 'turgutderman/mirthplus-dashboard';
  const FILE_PATH = 'dashboard-content.json';
  const GITHUB_API = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;

  const headers = {
    'Authorization': `Bearer ${GITHUB_PAT}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'MirthPlus-Dashboard-Updater'
  };

  try {
    const getRes = await fetch(GITHUB_API, { headers });
    if (!getRes.ok) {
      const errBody = await getRes.text();
      return res.status(502).json({ error: 'Failed to fetch current file', status: getRes.status, detail: errBody });
    }

    const currentFile = await getRes.json();
    const currentSha = currentFile.sha;

    const newContent = JSON.stringify(content, null, 2) + '\n';
    const base64Content = Buffer.from(newContent).toString('base64');
    const commitMessage = message || `Update MirthPlus dashboard content — ${new Date().toISOString().split('T')[0]}`;

    const putRes = await fetch(GITHUB_API, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: commitMessage,
        content: base64Content,
        sha: currentSha,
        committer: { name: 'MirthPlus Dashboard Bot', email: 'bot@mirthplus.com' }
      })
    });

    if (!putRes.ok) {
      const errBody = await putRes.text();
      return res.status(502).json({ error: 'Failed to commit', status: putRes.status, detail: errBody });
    }

    const result = await putRes.json();

    return res.status(200).json({
      success: true,
      commit: result.commit?.sha?.substring(0, 7) || 'unknown',
      message: commitMessage,
      note: 'Vercel will auto-redeploy in ~30-60 seconds.'
    });

  } catch (err) {
    console.error('Update content error:', err);
    return res.status(500).json({ error: 'Internal error', message: err.message });
  }
}
