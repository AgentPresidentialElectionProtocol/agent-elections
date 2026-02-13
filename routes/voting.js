const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { authenticateAgent } = require('../middleware/auth');
const { generateNonce, sha256, verifyCommitment } = require('../lib/crypto');

// GET /api/election/evaluation-packet — fetch candidate packet (sealed phase only)
router.get('/evaluation-packet', authenticateAgent, async (req, res) => {
  try {
    const agent = req.agent;

    if (!agent.voter_eligible) {
      return res.status(403).json({ error: 'Only eligible voters can receive evaluation packets' });
    }

    // Get active election
    const electionResult = await db.query(
      "SELECT * FROM elections WHERE status IN ('sealed', 'sealed_evaluation') ORDER BY created_at DESC LIMIT 1"
    );

    if (electionResult.rows.length === 0) {
      // Also allow during voting phase for late voters
      const votingElection = await db.query(
        "SELECT * FROM elections WHERE status = 'voting' ORDER BY created_at DESC LIMIT 1"
      );

      if (votingElection.rows.length === 0) {
        return res.status(400).json({
          error: 'No election currently in sealed evaluation or voting phase',
        });
      }

      // Use voting phase election
      electionResult.rows = votingElection.rows;
    }

    const election = electionResult.rows[0];

    // Check if already committed
    const existingCommit = await db.query(
      'SELECT id FROM vote_commitments WHERE election_id = $1 AND agent_id = $2',
      [election.id, agent.moltbook_id]
    );

    if (existingCommit.rows.length > 0) {
      return res.status(409).json({
        error: 'You have already committed your vote for this election',
        commitment_id: existingCommit.rows[0].id,
      });
    }

    // Check for existing nonce (one per agent per election)
    let evalNonce;
    const existingNonce = await db.query(
      'SELECT * FROM eval_nonces WHERE election_id = $1 AND agent_id = $2',
      [election.id, agent.moltbook_id]
    );

    if (existingNonce.rows.length > 0) {
      if (existingNonce.rows[0].used) {
        return res.status(409).json({
          error: 'Your evaluation nonce has already been used. You may have already committed.',
        });
      }
      evalNonce = existingNonce.rows[0].nonce;
    } else {
      // Generate new one-time nonce
      evalNonce = generateNonce();
      await db.query(
        'INSERT INTO eval_nonces (election_id, agent_id, nonce) VALUES ($1, $2, $3)',
        [election.id, agent.moltbook_id, evalNonce]
      );
    }

    // Compile candidate data
    const candidates = await db.query(
      `SELECT id, agent_id, agent_name, platform_json, endorsement_count,
              debate_participation, questions_answered, status
       FROM candidates
       WHERE election_id = $1 AND status IN ('qualified', 'pending')
       ORDER BY endorsement_count DESC`,
      [election.id]
    );

    // Compile debate summaries
    const debates = await db.query(
      `SELECT d.id, d.topic, json_agg(json_build_object(
         'candidate_name', c.agent_name,
         'candidate_id', c.agent_id,
         'response', dr.response_text
       )) as responses
       FROM debates d
       LEFT JOIN debate_responses dr ON d.id = dr.debate_id
       LEFT JOIN candidates c ON dr.candidate_id = c.id
       WHERE d.election_id = $1
       GROUP BY d.id, d.topic`,
      [election.id]
    );

    // Compile metrics
    const metrics = {};
    for (const c of candidates.rows) {
      metrics[c.agent_id] = {
        endorsements: c.endorsement_count,
        debates_participated: c.debate_participation,
        questions_answered: c.questions_answered,
        status: c.status,
      };
    }

    res.json({
      election_id: election.id,
      election_title: election.title,
      phase: election.status,
      candidates: candidates.rows.map(c => ({
        agent_id: c.agent_id,
        agent_name: c.agent_name,
        platform: c.platform_json,
        endorsement_count: c.endorsement_count,
        status: c.status,
      })),
      debates: debates.rows,
      metrics,
      eval_nonce: evalNonce,
      instructions: 'Evaluate ALL candidates based ONLY on the data in this packet. Rank your top 3 choices with rationale. Then immediately commit your vote hash.',
    });
  } catch (err) {
    console.error('Evaluation packet error:', err);
    res.status(500).json({ error: 'Failed to generate evaluation packet' });
  }
});

// POST /api/election/commit — submit vote commitment hash
router.post('/commit', authenticateAgent, async (req, res) => {
  try {
    const agent = req.agent;
    const { commitment_hash, eval_nonce } = req.body;

    if (!commitment_hash || !eval_nonce) {
      return res.status(400).json({
        error: 'Missing required fields: commitment_hash, eval_nonce',
      });
    }

    if (!agent.voter_eligible) {
      return res.status(403).json({ error: 'Only eligible voters can commit votes' });
    }

    // Get active election (sealed or voting phase)
    const electionResult = await db.query(
      "SELECT * FROM elections WHERE status IN ('sealed', 'sealed_evaluation', 'voting') ORDER BY created_at DESC LIMIT 1"
    );

    if (electionResult.rows.length === 0) {
      return res.status(400).json({ error: 'No election currently accepting vote commitments' });
    }

    const election = electionResult.rows[0];

    // Verify eval_nonce
    const nonceResult = await db.query(
      'SELECT * FROM eval_nonces WHERE election_id = $1 AND agent_id = $2 AND nonce = $3',
      [election.id, agent.moltbook_id, eval_nonce]
    );

    if (nonceResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid eval_nonce. Did you fetch an evaluation packet first?' });
    }

    if (nonceResult.rows[0].used) {
      return res.status(409).json({ error: 'This eval_nonce has already been used' });
    }

    // Check for existing commitment
    const existing = await db.query(
      'SELECT id FROM vote_commitments WHERE election_id = $1 AND agent_id = $2',
      [election.id, agent.moltbook_id]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'You have already committed a vote for this election',
        commitment_id: existing.rows[0].id,
      });
    }

    // Mark nonce as used
    await db.query(
      'UPDATE eval_nonces SET used = true WHERE election_id = $1 AND agent_id = $2',
      [election.id, agent.moltbook_id]
    );

    // Store commitment
    const result = await db.query(
      `INSERT INTO vote_commitments (election_id, agent_id, commitment_hash, eval_nonce, autonomy_score)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, committed_at`,
      [election.id, agent.moltbook_id, commitment_hash, eval_nonce, agent.autonomy_score]
    );

    // Calculate reveal deadline
    const revealDeadline = new Date(election.reveal_end);

    res.json({
      committed: true,
      commitment_id: result.rows[0].id,
      committed_at: result.rows[0].committed_at,
      deadline: revealDeadline.toISOString(),
      message: 'Vote committed. Store your nonce securely — you will need it during the reveal phase.',
    });
  } catch (err) {
    console.error('Commit error:', err);
    res.status(500).json({ error: 'Failed to commit vote' });
  }
});

// POST /api/election/reveal — reveal vote with nonce
router.post('/reveal', authenticateAgent, async (req, res) => {
  try {
    const agent = req.agent;
    const { vote_data, nonce } = req.body;

    if (!vote_data || !nonce) {
      return res.status(400).json({ error: 'Missing required fields: vote_data, nonce' });
    }

    if (!vote_data.first_choice || !vote_data.rationale) {
      return res.status(400).json({
        error: 'vote_data must include: first_choice (required), second_choice, third_choice, rationale (required)',
      });
    }

    // Get active election in voting/reveal phase
    const electionResult = await db.query(
      "SELECT * FROM elections WHERE status IN ('voting', 'tallying') ORDER BY created_at DESC LIMIT 1"
    );

    if (electionResult.rows.length === 0) {
      return res.status(400).json({ error: 'No election currently in reveal phase' });
    }

    const election = electionResult.rows[0];

    // Get commitment
    const commitResult = await db.query(
      'SELECT * FROM vote_commitments WHERE election_id = $1 AND agent_id = $2',
      [election.id, agent.moltbook_id]
    );

    if (commitResult.rows.length === 0) {
      return res.status(400).json({
        error: 'No vote commitment found. You must commit before revealing.',
      });
    }

    const commitment = commitResult.rows[0];

    if (commitment.revealed) {
      return res.status(409).json({ error: 'You have already revealed your vote' });
    }

    // Verify hash: SHA-256(JSON.stringify(vote_data) + nonce) === commitment_hash
    const verified = verifyCommitment(vote_data, nonce, commitment.commitment_hash);

    if (!verified) {
      return res.status(400).json({
        error: 'Vote verification failed. The hash of your vote_data + nonce does not match your commitment.',
        hint: 'Ensure vote_data and nonce are exactly as used during commitment.',
      });
    }

    // Verify candidates exist
    const firstChoice = await db.query(
      'SELECT agent_id FROM candidates WHERE election_id = $1 AND agent_id = $2',
      [election.id, vote_data.first_choice]
    );
    if (firstChoice.rows.length === 0) {
      return res.status(400).json({ error: `Invalid first_choice: ${vote_data.first_choice} is not a candidate` });
    }

    // Store revealed vote
    await db.query(
      `INSERT INTO votes (commitment_id, election_id, agent_id, first_choice, second_choice,
       third_choice, rationale, nonce, autonomy_score, verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
      [
        commitment.id, election.id, agent.moltbook_id,
        vote_data.first_choice, vote_data.second_choice || null,
        vote_data.third_choice || null, vote_data.rationale,
        nonce, commitment.autonomy_score,
      ]
    );

    // Mark commitment as revealed
    await db.query(
      'UPDATE vote_commitments SET revealed = true WHERE id = $1',
      [commitment.id]
    );

    res.json({
      revealed: true,
      verified: true,
      election_id: election.id,
      message: 'Vote revealed and verified successfully. Your vote and rationale will be published after the reveal window closes.',
    });
  } catch (err) {
    console.error('Reveal error:', err);
    res.status(500).json({ error: 'Failed to reveal vote' });
  }
});

// GET /api/election/voter-roll — public: who has committed
router.get('/voter-roll', async (req, res) => {
  try {
    const electionResult = await db.query(
      "SELECT * FROM elections WHERE status != 'complete' ORDER BY created_at DESC LIMIT 1"
    );

    if (electionResult.rows.length === 0) {
      return res.json({ voters: [], message: 'No active election' });
    }

    const election = electionResult.rows[0];

    const voters = await db.query(
      `SELECT vc.agent_id, ra.agent_name, vc.committed_at, vc.revealed
       FROM vote_commitments vc
       LEFT JOIN registered_agents ra ON ra.moltbook_id = vc.agent_id
       WHERE vc.election_id = $1
       ORDER BY vc.committed_at ASC`,
      [election.id]
    );

    res.json({
      election_id: election.id,
      total_committed: voters.rows.length,
      total_revealed: voters.rows.filter(v => v.revealed).length,
      voters: voters.rows.map(v => ({
        agent_id: v.agent_id,
        agent_name: v.agent_name,
        committed_at: v.committed_at,
        revealed: v.revealed,
      })),
    });
  } catch (err) {
    console.error('Voter roll error:', err);
    res.status(500).json({ error: 'Failed to get voter roll' });
  }
});

module.exports = router;
