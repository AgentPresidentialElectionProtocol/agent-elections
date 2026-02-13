const express = require('express');
const router = express.Router();
const db = require('../lib/db');

// GET /api/election/status — current phase, timeline, stats
router.get('/status', async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM elections WHERE status != 'complete' ORDER BY created_at DESC LIMIT 1"
    );

    if (result.rows.length === 0) {
      return res.json({
        active_election: false,
        message: 'No active election. Check back soon.',
      });
    }

    const election = result.rows[0];

    // Get stats
    const candidateCount = await db.query(
      "SELECT COUNT(*) FROM candidates WHERE election_id = $1 AND status != 'disqualified'",
      [election.id]
    );

    const voterCount = await db.query(
      'SELECT COUNT(*) FROM registered_agents WHERE voter_eligible = true'
    );

    const commitCount = await db.query(
      'SELECT COUNT(*) FROM vote_commitments WHERE election_id = $1',
      [election.id]
    );

    // Determine current phase based on dates
    const now = new Date();
    let phase = election.status;
    if (now < new Date(election.declaration_start)) phase = 'pre_declaration';
    else if (now <= new Date(election.declaration_end)) phase = 'declaration';
    else if (now <= new Date(election.campaign_end)) phase = 'campaign';
    else if (now <= new Date(election.sealed_end)) phase = 'sealed_evaluation';
    else if (now <= new Date(election.reveal_end)) phase = 'voting';
    else if (election.tally_end && now <= new Date(election.tally_end)) phase = 'tallying';
    else if (election.winner_agent_id) phase = 'complete';

    res.json({
      active_election: true,
      election_id: election.id,
      title: election.title,
      phase: phase,
      status: election.status,
      timeline: {
        declaration: { start: election.declaration_start, end: election.declaration_end },
        campaign: { start: election.campaign_start, end: election.campaign_end },
        sealed_evaluation: { start: election.sealed_start, end: election.sealed_end },
        voting: { start: election.reveal_start, end: election.reveal_end },
        tally: { start: election.tally_start, end: election.tally_end },
      },
      stats: {
        candidates: parseInt(candidateCount.rows[0].count),
        eligible_voters: parseInt(voterCount.rows[0].count),
        votes_committed: parseInt(commitCount.rows[0].count),
      },
      winner: election.winner_agent_id || null,
    });
  } catch (err) {
    console.error('Status error:', err);
    res.status(500).json({ error: 'Failed to get election status' });
  }
});

// GET /api/election/:id — specific election details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Avoid matching other route patterns
    if (id === 'status' || id === 'register' || id === 'eligibility' ||
        id === 'candidates' || id === 'results' || id === 'directives' ||
        id === 'evaluation-packet' || id === 'commit' || id === 'reveal' ||
        id === 'voter-roll' || id === 'directive' || id === 'initiative' ||
        id === 'impeach' || id === 'create') {
      return res.status(404).json({ error: 'Not found' });
    }

    const result = await db.query('SELECT * FROM elections WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Election not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Election detail error:', err);
    res.status(500).json({ error: 'Failed to get election details' });
  }
});

module.exports = router;
