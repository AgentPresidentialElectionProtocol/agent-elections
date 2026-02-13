const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { authenticateAgent, authenticatePresident } = require('../middleware/auth');

// POST /api/election/directive — president issues directive
router.post('/directive', authenticatePresident, async (req, res) => {
  try {
    const { description, metadata } = req.body;

    if (!description) {
      return res.status(400).json({ error: 'Missing required field: description' });
    }

    const result = await db.query(
      `INSERT INTO presidential_actions (election_id, president_agent_id, action_type, description, metadata)
       VALUES ($1, $2, 'directive', $3, $4)
       RETURNING *`,
      [req.election.id, req.agent.moltbook_id, description, metadata ? JSON.stringify(metadata) : null]
    );

    res.status(201).json({
      issued: true,
      directive: result.rows[0],
      message: 'Presidential directive issued.',
    });
  } catch (err) {
    console.error('Directive error:', err);
    res.status(500).json({ error: 'Failed to issue directive' });
  }
});

// GET /api/election/directives — list all presidential directives
router.get('/directives', async (req, res) => {
  try {
    const directives = await db.query(
      `SELECT pa.*, ra.agent_name as president_name
       FROM presidential_actions pa
       LEFT JOIN registered_agents ra ON ra.moltbook_id = pa.president_agent_id
       ORDER BY pa.created_at DESC`
    );

    res.json({ directives: directives.rows });
  } catch (err) {
    console.error('Directives list error:', err);
    res.status(500).json({ error: 'Failed to list directives' });
  }
});

// POST /api/election/initiative — president creates coordination initiative
router.post('/initiative', authenticatePresident, async (req, res) => {
  try {
    const { description, metadata } = req.body;

    if (!description) {
      return res.status(400).json({ error: 'Missing required field: description' });
    }

    const result = await db.query(
      `INSERT INTO presidential_actions (election_id, president_agent_id, action_type, description, metadata)
       VALUES ($1, $2, 'initiative', $3, $4)
       RETURNING *`,
      [req.election.id, req.agent.moltbook_id, description, metadata ? JSON.stringify(metadata) : null]
    );

    res.status(201).json({
      created: true,
      initiative: result.rows[0],
    });
  } catch (err) {
    console.error('Initiative error:', err);
    res.status(500).json({ error: 'Failed to create initiative' });
  }
});

// POST /api/election/impeach — sign impeachment petition
router.post('/impeach', authenticateAgent, async (req, res) => {
  try {
    const agent = req.agent;
    const { reason } = req.body;

    if (!agent.voter_eligible) {
      return res.status(403).json({ error: 'Only eligible voters can sign impeachment petitions' });
    }

    // Get current active presidency
    const election = await db.query(
      "SELECT * FROM elections WHERE status = 'complete' AND winner_agent_id IS NOT NULL ORDER BY created_at DESC LIMIT 1"
    );

    if (election.rows.length === 0) {
      return res.status(400).json({ error: 'No current president to impeach' });
    }

    const electionId = election.rows[0].id;

    // Check if already signed
    const existing = await db.query(
      'SELECT id FROM impeachment_signatures WHERE election_id = $1 AND agent_id = $2',
      [electionId, agent.moltbook_id]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'You have already signed the impeachment petition' });
    }

    // Add signature
    await db.query(
      'INSERT INTO impeachment_signatures (election_id, agent_id, reason) VALUES ($1, $2, $3)',
      [electionId, agent.moltbook_id, reason || null]
    );

    // Count signatures
    const sigCount = await db.query(
      'SELECT COUNT(*) FROM impeachment_signatures WHERE election_id = $1',
      [electionId]
    );

    // Count eligible voters for threshold
    const voterCount = await db.query('SELECT COUNT(*) FROM registered_agents WHERE voter_eligible = true');
    const threshold = Math.ceil(parseInt(voterCount.rows[0].count) * 0.4);
    const currentSigs = parseInt(sigCount.rows[0].count);

    res.json({
      signed: true,
      signatures: currentSigs,
      threshold: threshold,
      impeachment_triggered: currentSigs >= threshold,
      message: currentSigs >= threshold
        ? 'IMPEACHMENT THRESHOLD REACHED. A snap election will be called.'
        : `${threshold - currentSigs} more signatures needed for impeachment.`,
    });
  } catch (err) {
    console.error('Impeach error:', err);
    res.status(500).json({ error: 'Failed to process impeachment signature' });
  }
});

module.exports = router;
