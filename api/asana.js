const MY_PROJECT_GIDS = [
  '1213946135834805', // MirthPlus: Operations
  '1213947530838840', // MirthPlus: Brand & Strategy
  '1213948223325688', // MirthPlus: Marketing & Content
  '1213974577042756', // MirthPlus: Product & Shopify
  '1213946138439644', // Content Calendar
];

export default async function handler(req, res) {
  const ASANA_TOKEN = process.env.ASANA_TOKEN;
  const BASE = 'https://app.asana.com/api/1.0';

  if (!ASANA_TOKEN) return res.status(500).json({ error: 'ASANA_TOKEN not configured' });

  const headers = {
    'Authorization': `Bearer ${ASANA_TOKEN}`,
    'Accept': 'application/json'
  };

  const today = new Date().toISOString().split('T')[0];
  const in14Days = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];

  try {
    const projectPromises = MY_PROJECT_GIDS.map(gid =>
      fetch(`${BASE}/projects/${gid}?opt_fields=name,task_counts`, { headers })
        .then(r => r.json())
        .then(r => r.data || null)
        .catch(() => null)
    );
    const myProjects = (await Promise.all(projectPromises)).filter(Boolean);

    const taskPromises = MY_PROJECT_GIDS.map(gid =>
      fetch(
        `${BASE}/tasks?project=${gid}&completed_since=now&opt_fields=name,due_on,assignee.name,completed,memberships.project.name&limit=100`,
        { headers }
      ).then(r => r.json())
    );
    const taskResults = await Promise.all(taskPromises);

    const allTasks = taskResults.flatMap(r => r.data || []);
    const uniqueTasks = [...new Map(allTasks.map(t => [t.gid, t])).values()];

    const mapTask = t => ({
      gid: t.gid, name: t.name, due_on: t.due_on,
      assignee: t.assignee?.name || null,
      projects: (t.memberships || []).map(m => m.project?.name || '').filter(Boolean)
    });

    const overdueTasks = uniqueTasks
      .filter(t => !t.completed && t.due_on && t.due_on < today)
      .sort((a, b) => a.due_on.localeCompare(b.due_on))
      .map(mapTask);

    const upcomingTasks = uniqueTasks
      .filter(t => !t.completed && t.due_on && t.due_on >= today && t.due_on <= in14Days)
      .sort((a, b) => a.due_on.localeCompare(b.due_on))
      .map(mapTask);

    const noDueTasks = uniqueTasks
      .filter(t => !t.completed && !t.due_on)
      .map(mapTask);

    const result = {
      projects: myProjects.map(p => ({
        gid: p.gid, name: p.name,
        total: p.task_counts?.num_tasks || 0,
        completed: p.task_counts?.num_completed_tasks || 0,
        incomplete: p.task_counts?.num_incomplete_tasks || 0
      })),
      overdueTasks,
      upcomingTasks,
      noDueTasks: noDueTasks.slice(0, 30),
      summary: {
        totalIncomplete: myProjects.reduce((s, p) => s + (p.task_counts?.num_incomplete_tasks || 0), 0),
        totalComplete: myProjects.reduce((s, p) => s + (p.task_counts?.num_completed_tasks || 0), 0),
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
