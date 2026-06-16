// Vercel Serverless Function: Asana Task Aggregator
// Fetches SailPin projects + overdue/upcoming tasks from Asana
// Cached at Vercel CDN edge for 1 hour (3600s)

const SAILPIN_PROJECT_GIDS = [
  '1213942217332140', // SailPin: Brand & Strategy
  '1213942217554845', // SailPin: Product Design & PoD
  '1213942743399057', // SailPin: Operations & Fulfillment
  '1213948223663267'  // SailPin: Marketing & Content
];

export default async function handler(req, res) {
  const ASANA_TOKEN = process.env.ASANA_TOKEN;
  const BASE = 'https://app.asana.com/api/1.0';

  if (!ASANA_TOKEN) {
    return res.status(500).json({ error: 'ASANA_TOKEN not configured' });
  }

  const headers = {
    'Authorization': `Bearer ${ASANA_TOKEN}`,
    'Accept': 'application/json'
  };

  const today = new Date().toISOString().split('T')[0];
  const in14Days = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];

  try {
    // Fetch projects individually to get reliable task_counts
    const projectPromises = SAILPIN_PROJECT_GIDS.map(gid =>
      fetch(
        `${BASE}/projects/${gid}?opt_fields=name,task_counts`,
        { headers }
      ).then(r => r.json())
    );
    const projectResults = await Promise.allSettled(projectPromises);
    const sailpinProjects = projectResults
      .filter(r => r.status === 'fulfilled' && r.value?.data)
      .map(r => r.value.data);

    // Fetch incomplete tasks across SailPin projects
    const taskPromises = SAILPIN_PROJECT_GIDS.map(gid =>
      fetch(
        `${BASE}/tasks?project=${gid}&completed_since=now&opt_fields=name,due_on,assignee.name,completed,memberships.project.name&limit=100`,
        { headers }
      ).then(r => r.json())
    );
    const taskResults = await Promise.all(taskPromises);

    // Combine and deduplicate
    const allTasks = taskResults.flatMap(r => r.data || []);
    const uniqueTasks = [...new Map(allTasks.map(t => [t.gid, t])).values()];

    const overdueTasks = uniqueTasks
      .filter(t => !t.completed && t.due_on && t.due_on < today)
      .sort((a, b) => a.due_on.localeCompare(b.due_on))
      .map(t => ({
        gid: t.gid,
        name: t.name,
        due_on: t.due_on,
        assignee: t.assignee?.name || null,
        projects: (t.memberships || []).map(m => m.project?.name || '').filter(Boolean)
      }));

    const upcomingTasks = uniqueTasks
      .filter(t => !t.completed && t.due_on && t.due_on >= today && t.due_on <= in14Days)
      .sort((a, b) => a.due_on.localeCompare(b.due_on))
      .map(t => ({
        gid: t.gid,
        name: t.name,
        due_on: t.due_on,
        assignee: t.assignee?.name || null,
        projects: (t.memberships || []).map(m => m.project?.name || '').filter(Boolean)
      }));

    const noDueTasks = uniqueTasks
      .filter(t => !t.completed && !t.due_on)
      .map(t => ({
        gid: t.gid,
        name: t.name,
        due_on: null,
        assignee: t.assignee?.name || null,
        projects: (t.memberships || []).map(m => m.project?.name || '').filter(Boolean)
      }));

    const result = {
      projects: sailpinProjects.map(p => ({
        gid: p.gid,
        name: p.name,
        total: p.task_counts?.num_tasks || 0,
        completed: p.task_counts?.num_completed_tasks || 0,
        incomplete: p.task_counts?.num_incomplete_tasks || 0
      })),
      overdueTasks,
      upcomingTasks,
      noDueTasks: noDueTasks.slice(0, 30),
      summary: {
        totalIncomplete: sailpinProjects.reduce((s, p) => s + (p.task_counts?.num_incomplete_tasks || 0), 0),
        totalComplete: sailpinProjects.reduce((s, p) => s + (p.task_counts?.num_completed_tasks || 0), 0),
        overdueCount: overdueTasks.length,
        upcomingCount: upcomingTasks.length
      },
      fetchedAt: new Date().toISOString()
    };

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
    return res.status(200).json(result);

  } catch (err) {
    console.error('Asana API error:', err);
    return res.status(500).json({ error: 'Failed to fetch Asana data', message: err.message });
  }
}
