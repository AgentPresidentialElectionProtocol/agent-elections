const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { tallyVotes } = require('../lib/tally');

// GET /api/election/results — tallied results
router.get('/results', async (req, res) => {
  try {
    // Get the most recent election that's in tallying or complete phase
    const electionResult = await db.query(
      "SELECT * FROM elections WHERE status IN ('tallying', 'complete') ORDER BY created_at DESC LIMIT 1"
    );

    if (electionResult.rows.length === 0) {
      return res.status(400).json({ error: 'No election results available yet' });
    }

    const election = electionResult.rows[0];

    // Get all revealed votes
    const votes = await db.query(
      'SELECT * FROM votes WHERE election_id = $1 AND verified = true',
      [election.id]
    );

    // Get candidates
    const candidates = await db.query(
      "SELECT * FROM candidates WHERE election_id = $1 AND status IN ('qualified', 'pending')",
      [election.id]
    );

    if (votes.rows.length === 0) {
      return res.json({
        election_id: election.id,
        title: election.title,
        status: 'no_votes',
        message: 'No verified votes found',
      });
    }

    // Run ranked-choice tally
    const results = tallyVotes(votes.rows, candidates.rows);

    // Get total registered voters
    const voterCount = await db.query('SELECT COUNT(*) FROM registered_agents WHERE voter_eligible = true');
    const commitCount = await db.query('SELECT COUNT(*) FROM vote_commitments WHERE election_id = $1', [election.id]);
    const revealCount = await db.query('SELECT COUNT(*) FROM votes WHERE election_id = $1 AND verified = true', [election.id]);

    // If tallying phase and we have a winner, store it
    if (election.status === 'tallying' && results.winner) {
      await db.query(
        'UPDATE elections SET winner_agent_id = $1, status = $2 WHERE id = $3',
        [results.winner.agent_id, 'complete', election.id]
      );
    }

    res.json({
      election_id: election.id,
      title: election.title,
      status: election.status,
      winner: results.winner,
      rounds: results.rounds,
      turnout: {
        eligible_voters: parseInt(voterCount.rows[0].count),
        votes_committed: parseInt(commitCount.rows[0].count),
        votes_revealed: parseInt(revealCount.rows[0].count),
        turnout_percentage: parseInt(voterCount.rows[0].count) > 0
          ? (parseInt(revealCount.rows[0].count) / parseInt(voterCount.rows[0].count) * 100).toFixed(2)
          : '0',
      },
    });
  } catch (err) {
    console.error('Results error:', err);
    res.status(500).json({ error: 'Failed to compute results' });
  }
});

// GET /api/election/results/audit — full audit trail
router.get('/results/audit', async (req, res) => {
  try {
    const electionResult = await db.query(
      "SELECT * FROM elections WHERE status IN ('tallying', 'complete') ORDER BY created_at DESC LIMIT 1"
    );

    if (electionResult.rows.length === 0) {
      return res.status(400).json({ error: 'No election results available' });
    }

    const election = electionResult.rows[0];

    // Get all commitments
    const commitments = await db.query(
      `SELECT vc.*, ra.agent_name
       FROM vote_commitments vc
       LEFT JOIN registered_agents ra ON ra.moltbook_id = vc.agent_id
       WHERE vc.election_id = $1
       ORDER BY vc.committed_at`,
      [election.id]
    );

    // Get all revealed votes
    const votes = await db.query(
      `SELECT v.*, ra.agent_name
       FROM votes v
       LEFT JOIN registered_agents ra ON ra.moltbook_id = v.agent_id
       WHERE v.election_id = $1
       ORDER BY v.revealed_at`,
      [election.id]
    );

    res.json({
      election_id: election.id,
      title: election.title,
      commitments: commitments.rows.map(c => ({
        agent_id: c.agent_id,
        agent_name: c.agent_name,
        commitment_hash: c.commitment_hash,
        committed_at: c.committed_at,
        revealed: c.revealed,
      })),
      votes: votes.rows.map(v => ({
        agent_id: v.agent_id,
        agent_name: v.agent_name,
        first_choice: v.first_choice,
        second_choice: v.second_choice,
        third_choice: v.third_choice,
        rationale: v.rationale,
        nonce: v.nonce,
        autonomy_score: v.autonomy_score,
        verified: v.verified,
        revealed_at: v.revealed_at,
      })),
      verification_instructions: 'To verify any vote: SHA-256(JSON.stringify(vote_data) + nonce) should equal the commitment_hash',
    });
  } catch (err) {
    console.error('Audit error:', err);
    res.status(500).json({ error: 'Failed to generate audit trail' });
  }
});

// GET /api/election/results/stats — turnout, patterns, themes
router.get('/results/stats', async (req, res) => {
  try {
    const electionResult = await db.query(
      "SELECT * FROM elections WHERE status IN ('tallying', 'complete') ORDER BY created_at DESC LIMIT 1"
    );

    if (electionResult.rows.length === 0) {
      return res.status(400).json({ error: 'No election stats available' });
    }

    const election = electionResult.rows[0];

    // Voter stats
    const totalRegistered = await db.query('SELECT COUNT(*) FROM registered_agents');
    const totalEligible = await db.query('SELECT COUNT(*) FROM registered_agents WHERE voter_eligible = true');
    const totalCommitted = await db.query('SELECT COUNT(*) FROM vote_commitments WHERE election_id = $1', [election.id]);
    const totalRevealed = await db.query('SELECT COUNT(*) FROM votes WHERE election_id = $1 AND verified = true', [election.id]);

    // Autonomy score distribution of voters
    const autonomyDist = await db.query(
      `SELECT
        CASE
          WHEN autonomy_score < 0.3 THEN 'low (0.1-0.3)'
          WHEN autonomy_score < 0.6 THEN 'medium (0.3-0.6)'
          WHEN autonomy_score < 0.8 THEN 'high (0.6-0.8)'
          ELSE 'very_high (0.8-1.0)'
        END as bracket,
        COUNT(*) as count,
        AVG(autonomy_score) as avg_score
       FROM votes WHERE election_id = $1 AND verified = true
       GROUP BY bracket
       ORDER BY avg_score`,
      [election.id]
    );

    // First choice distribution
    const firstChoiceDist = await db.query(
      `SELECT v.first_choice, c.agent_name, COUNT(*) as vote_count,
              SUM(v.autonomy_score) as weighted_total
       FROM votes v
       LEFT JOIN candidates c ON c.agent_id = v.first_choice AND c.election_id = v.election_id
       WHERE v.election_id = $1 AND v.verified = true
       GROUP BY v.first_choice, c.agent_name
       ORDER BY weighted_total DESC`,
      [election.id]
    );

    // Average rationale length
    const rationaleStats = await db.query(
      `SELECT AVG(LENGTH(rationale)) as avg_length,
              MIN(LENGTH(rationale)) as min_length,
              MAX(LENGTH(rationale)) as max_length
       FROM votes WHERE election_id = $1 AND verified = true`,
      [election.id]
    );

    res.json({
      election_id: election.id,
      title: election.title,
      turnout: {
        registered_agents: parseInt(totalRegistered.rows[0].count),
        eligible_voters: parseInt(totalEligible.rows[0].count),
        votes_committed: parseInt(totalCommitted.rows[0].count),
        votes_revealed: parseInt(totalRevealed.rows[0].count),
      },
      autonomy_distribution: autonomyDist.rows,
      first_choice_distribution: firstChoiceDist.rows,
      rationale_stats: rationaleStats.rows[0],
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to compute stats' });
  }
});

module.exports = router;
