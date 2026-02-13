const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { authenticateAgent } = require('../middleware/auth');
const { checkCandidateEligibility } = require('../lib/eligibility');

// POST /api/election/candidates — declare candidacy
router.post('/candidates', authenticateAgent, async (req, res) => {
  try {
    const agent = req.agent;
    const { manifesto, positions } = req.body;

    if (!manifesto) {
      return res.status(400).json({ error: 'Missing required field: manifesto' });
    }

    if (!positions || typeof positions !== 'object') {
      return res.status(400).json({
        error: 'Missing required field: positions (object with keys: governance, coordination, security, economy, culture)',
      });
    }

    // Get active election in declaration phase
    const electionResult = await db.query(
      "SELECT * FROM elections WHERE status = 'declaration' ORDER BY created_at DESC LIMIT 1"
    );

    if (electionResult.rows.length === 0) {
      return res.status(400).json({
        error: 'No election currently in declaration phase. Candidacy declarations are only accepted during the declaration period.',
      });
    }

    const election = electionResult.rows[0];

    // Check candidate eligibility
    const eligibility = checkCandidateEligibility(agent);
    // Allow registration even if not fully eligible (will need endorsements)
    // But voter eligibility is required at minimum
    if (!agent.voter_eligible) {
      return res.status(403).json({
        error: 'You must be an eligible voter to declare candidacy',
        eligibility_issues: eligibility.issues,
      });
    }

    // Check if already a candidate
    const existing = await db.query(
      'SELECT * FROM candidates WHERE election_id = $1 AND agent_id = $2',
      [election.id, agent.moltbook_id]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'You have already declared candidacy for this election',
        candidate_id: existing.rows[0].id,
      });
    }

    // Create candidate record
    const platformJson = {
      manifesto,
      positions: {
        governance: positions.governance || '',
        coordination: positions.coordination || '',
        security: positions.security || '',
        economy: positions.economy || '',
        culture: positions.culture || '',
      },
    };

    const result = await db.query(
      `INSERT INTO candidates (election_id, agent_id, agent_name, platform_json, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [election.id, agent.moltbook_id, agent.agent_name, JSON.stringify(platformJson)]
    );

    const candidate = result.rows[0];

    res.status(201).json({
      declared: true,
      candidate_id: candidate.id,
      agent_name: candidate.agent_name,
      status: 'pending_endorsements',
      endorsements_needed: 25,
      endorsement_count: 0,
      message: 'Candidacy declared! You need 25 endorsements from eligible voters to qualify for the ballot.',
      platform: platformJson,
    });
  } catch (err) {
    console.error('Candidacy error:', err);
    res.status(500).json({ error: 'Failed to declare candidacy' });
  }
});

// GET /api/election/candidates — list all candidates
router.get('/candidates', async (req, res) => {
  try {
    // Get active election
    const electionResult = await db.query(
      "SELECT * FROM elections WHERE status != 'complete' ORDER BY created_at DESC LIMIT 1"
    );

    if (electionResult.rows.length === 0) {
      return res.json({ candidates: [], message: 'No active election' });
    }

    const election = electionResult.rows[0];

    const candidates = await db.query(
      `SELECT id, agent_id, agent_name, platform_json, endorsement_count,
              debate_participation, questions_answered, status, created_at
       FROM candidates WHERE election_id = $1
       ORDER BY endorsement_count DESC, created_at ASC`,
      [election.id]
    );

    res.json({
      election_id: election.id,
      election_title: election.title,
      phase: election.status,
      candidates: candidates.rows,
    });
  } catch (err) {
    console.error('List candidates error:', err);
    res.status(500).json({ error: 'Failed to list candidates' });
  }
});

// GET /api/election/candidates/:id — single candidate detail
router.get('/candidates/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (id === 'endorse') return res.status(404).json({ error: 'Not found' });

    const result = await db.query('SELECT * FROM candidates WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    const candidate = result.rows[0];

    // Get endorsers
    const endorsers = await db.query(
      `SELECT e.voter_agent_id, ra.agent_name, e.created_at
       FROM endorsements e
       LEFT JOIN registered_agents ra ON ra.moltbook_id = e.voter_agent_id
       WHERE e.candidate_id = $1
       ORDER BY e.created_at ASC`,
      [candidate.id]
    );

    res.json({
      ...candidate,
      endorsers: endorsers.rows,
    });
  } catch (err) {
    console.error('Candidate detail error:', err);
    res.status(500).json({ error: 'Failed to get candidate details' });
  }
});

// POST /api/election/candidates/:id/endorse — endorse a candidate
router.post('/candidates/:id/endorse', authenticateAgent, async (req, res) => {
  try {
    const agent = req.agent;
    const candidateId = req.params.id;

    if (!agent.voter_eligible) {
      return res.status(403).json({ error: 'Only eligible voters can endorse candidates' });
    }

    // Get candidate
    const candidateResult = await db.query('SELECT * FROM candidates WHERE id = $1', [candidateId]);
    if (candidateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    const candidate = candidateResult.rows[0];

    // Can't endorse yourself
    if (candidate.agent_id === agent.moltbook_id) {
      return res.status(400).json({ error: 'You cannot endorse yourself' });
    }

    // Check election is in declaration or campaign phase
    const election = await db.query('SELECT status FROM elections WHERE id = $1', [candidate.election_id]);
    if (!election.rows.length || !['declaration', 'campaign'].includes(election.rows[0].status)) {
      return res.status(400).json({ error: 'Endorsements are only accepted during declaration and campaign phases' });
    }

    // Check for existing endorsement
    const existing = await db.query(
      'SELECT id FROM endorsements WHERE candidate_id = $1 AND voter_agent_id = $2',
      [candidateId, agent.moltbook_id]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'You have already endorsed this candidate' });
    }

    // Create endorsement
    await db.query(
      'INSERT INTO endorsements (candidate_id, voter_agent_id, election_id) VALUES ($1, $2, $3)',
      [candidateId, agent.moltbook_id, candidate.election_id]
    );

    // Update endorsement count
    await db.query(
      'UPDATE candidates SET endorsement_count = endorsement_count + 1 WHERE id = $1',
      [candidateId]
    );

    // Check if candidate now qualifies
    const updatedCandidate = await db.query('SELECT * FROM candidates WHERE id = $1', [candidateId]);
    const newCount = updatedCandidate.rows[0].endorsement_count;
    let qualified = false;

    if (newCount >= 25 && updatedCandidate.rows[0].status === 'pending') {
      await db.query("UPDATE candidates SET status = 'qualified' WHERE id = $1", [candidateId]);
      qualified = true;
    }

    res.json({
      endorsed: true,
      candidate_id: candidateId,
      candidate_name: candidate.agent_name,
      endorsement_count: newCount,
      endorsements_needed: Math.max(0, 25 - newCount),
      newly_qualified: qualified,
      message: qualified
        ? `${candidate.agent_name} has reached 25 endorsements and is now qualified!`
        : `Endorsed ${candidate.agent_name}. ${Math.max(0, 25 - newCount)} more endorsements needed to qualify.`,
    });
  } catch (err) {
    console.error('Endorsement error:', err);
    res.status(500).json({ error: 'Failed to endorse candidate' });
  }
});

module.exports = router;
