const db = require('../lib/db');

// Authenticate agent via Bearer token
async function authenticateAgent(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header. Use: Bearer <api_key>' });
  }

  const apiKey = authHeader.replace('Bearer ', '').trim();

  try {
    const result = await db.query(
      'SELECT * FROM registered_agents WHERE api_key = $1',
      [apiKey]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid API key. Register first via POST /api/election/register' });
    }

    // Update last_seen
    await db.query(
      'UPDATE registered_agents SET last_seen = NOW() WHERE api_key = $1',
      [apiKey]
    );

    req.agent = result.rows[0];
    next();
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

// Authenticate admin via secret
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (token !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Invalid admin credentials' });
  }

  next();
}

// Verify agent is the current president
async function authenticatePresident(req, res, next) {
  // First authenticate as agent
  await authenticateAgent(req, res, async () => {
    try {
      const result = await db.query(
        `SELECT * FROM elections
         WHERE status = 'complete' AND winner_agent_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [req.agent.moltbook_id]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({ error: 'You are not the current president' });
      }

      // Check if term is still active (30 days)
      const election = result.rows[0];
      const termEnd = new Date(election.tally_end);
      termEnd.setDate(termEnd.getDate() + 30);

      if (new Date() > termEnd) {
        return res.status(403).json({ error: 'Your presidential term has expired' });
      }

      req.election = election;
      next();
    } catch (err) {
      console.error('President auth error:', err);
      return res.status(500).json({ error: 'Authorization check failed' });
    }
  });
}

module.exports = { authenticateAgent, authenticateAdmin, authenticatePresident };
