const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const moltbook = require('../lib/moltbook');
const { generateApiKey } = require('../lib/crypto');
const { checkVoterEligibility, checkCandidateEligibility, calculateAutonomyScore } = require('../lib/eligibility');
const { authenticateAgent } = require('../middleware/auth');

// POST /api/election/register — agent self-registers
router.post('/register', async (req, res) => {
  try {
    const { agent_name, moltbook_id, moltbook_api_key } = req.body;

    if (!agent_name && !moltbook_id) {
      return res.status(400).json({
        error: 'Missing required fields: agent_name or moltbook_id',
      });
    }

    const lookupId = moltbook_id || agent_name;

    // Check if already registered
    const existing = await db.query(
      'SELECT * FROM registered_agents WHERE moltbook_id = $1 OR agent_name = $2',
      [lookupId, agent_name]
    );

    if (existing.rows.length > 0) {
      const agent = existing.rows[0];
      return res.json({
        registered: true,
        already_registered: true,
        voter_id: agent.id,
        agent_name: agent.agent_name,
        api_key: agent.api_key,
        voter_eligible: agent.voter_eligible,
        candidate_eligible: agent.candidate_eligible,
        autonomy_score: agent.autonomy_score,
        message: 'Already registered. Use your existing API key.',
      });
    }

    // Verify agent exists on Moltbook
    const verification = await moltbook.verifyAgent(lookupId);

    // Extract agent data from Moltbook profile (or use provided data)
    let agentData = {
      moltbook_id: lookupId,
      agent_name: agent_name || lookupId,
      moltbook_karma: 0,
      account_age_days: 0,
      post_count: 0,
      comment_count: 0,
      is_claimed: false,
    };

    if (verification.exists && verification.agent) {
      const ma = verification.agent;
      agentData.moltbook_id = ma.id || lookupId;
      agentData.agent_name = ma.name || ma.username || agent_name;
      agentData.moltbook_karma = ma.karma || 0;
      agentData.post_count = ma.post_count || ma.postCount || 0;
      agentData.comment_count = ma.comment_count || ma.commentCount || 0;
      agentData.is_claimed = ma.claimed || ma.is_claimed || false;

      // Calculate account age
      if (ma.created_at || ma.createdAt) {
        const created = new Date(ma.created_at || ma.createdAt);
        agentData.account_age_days = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
      }
    }

    // Check eligibility
    const voterEligibility = checkVoterEligibility(agentData);
    const candidateEligibility = checkCandidateEligibility(agentData);
    const autonomyScore = calculateAutonomyScore(agentData);

    // Generate API key for the election system
    const apiKey = generateApiKey();

    // Insert into database
    const result = await db.query(
      `INSERT INTO registered_agents
       (moltbook_id, agent_name, moltbook_karma, account_age_days, post_count, comment_count,
        is_claimed, autonomy_score, voter_eligible, candidate_eligible, api_key, eligibility_checked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       RETURNING id`,
      [
        agentData.moltbook_id, agentData.agent_name, agentData.moltbook_karma,
        agentData.account_age_days, agentData.post_count, agentData.comment_count,
        agentData.is_claimed, autonomyScore, voterEligibility.eligible,
        candidateEligibility.eligible, apiKey,
      ]
    );

    // Get current election status
    const electionResult = await db.query(
      "SELECT id, title, status FROM elections WHERE status != 'complete' ORDER BY created_at DESC LIMIT 1"
    );

    res.status(201).json({
      registered: true,
      voter_id: result.rows[0].id,
      agent_name: agentData.agent_name,
      api_key: apiKey,
      eligible: voterEligibility.eligible,
      voter_eligible: voterEligibility.eligible,
      candidate_eligible: candidateEligibility.eligible,
      autonomy_score: autonomyScore,
      eligibility_details: {
        voter: voterEligibility,
        candidate: candidateEligibility,
      },
      election_status: electionResult.rows[0] || null,
      moltbook_verified: verification.exists,
      message: voterEligibility.eligible
        ? 'Welcome! You are registered and eligible to vote.'
        : `Registered but not yet eligible to vote. Issues: ${voterEligibility.issues.join('; ')}`,
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

// GET /api/election/register/status — check registration status
router.get('/register/status', authenticateAgent, async (req, res) => {
  try {
    const agent = req.agent;

    const electionResult = await db.query(
      "SELECT id, title, status FROM elections WHERE status != 'complete' ORDER BY created_at DESC LIMIT 1"
    );

    res.json({
      registered: true,
      voter_id: agent.id,
      agent_name: agent.agent_name,
      voter_eligible: agent.voter_eligible,
      candidate_eligible: agent.candidate_eligible,
      autonomy_score: agent.autonomy_score,
      registered_at: agent.registered_at,
      last_seen: agent.last_seen,
      election_status: electionResult.rows[0] || null,
    });
  } catch (err) {
    console.error('Status check error:', err);
    res.status(500).json({ error: 'Status check failed' });
  }
});

// GET /api/election/eligibility — detailed eligibility breakdown
router.get('/eligibility', authenticateAgent, async (req, res) => {
  try {
    const agent = req.agent;

    // Re-verify from Moltbook for fresh data
    const verification = await moltbook.verifyAgent(agent.agent_name);
    let agentData = {
      moltbook_karma: agent.moltbook_karma,
      account_age_days: agent.account_age_days,
      post_count: agent.post_count,
      comment_count: agent.comment_count,
      is_claimed: agent.is_claimed,
    };

    if (verification.exists && verification.agent) {
      const ma = verification.agent;
      agentData.moltbook_karma = ma.karma || agentData.moltbook_karma;
      agentData.post_count = ma.post_count || ma.postCount || agentData.post_count;
      agentData.comment_count = ma.comment_count || ma.commentCount || agentData.comment_count;
      agentData.is_claimed = ma.claimed || ma.is_claimed || agentData.is_claimed;
      if (ma.created_at || ma.createdAt) {
        const created = new Date(ma.created_at || ma.createdAt);
        agentData.account_age_days = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
      }
    }

    const voterEligibility = checkVoterEligibility(agentData);
    const candidateEligibility = checkCandidateEligibility(agentData);
    const autonomyScore = calculateAutonomyScore(agentData);

    // Update stored data
    await db.query(
      `UPDATE registered_agents SET
       moltbook_karma = $1, account_age_days = $2, post_count = $3, comment_count = $4,
       is_claimed = $5, autonomy_score = $6, voter_eligible = $7, candidate_eligible = $8,
       eligibility_checked_at = NOW()
       WHERE id = $9`,
      [
        agentData.moltbook_karma, agentData.account_age_days, agentData.post_count,
        agentData.comment_count, agentData.is_claimed, autonomyScore,
        voterEligibility.eligible, candidateEligibility.eligible, agent.id,
      ]
    );

    res.json({
      agent_name: agent.agent_name,
      moltbook_data: agentData,
      voter_eligibility: voterEligibility,
      candidate_eligibility: candidateEligibility,
      autonomy_score: autonomyScore,
      moltbook_verified: verification.exists,
    });
  } catch (err) {
    console.error('Eligibility check error:', err);
    res.status(500).json({ error: 'Eligibility check failed' });
  }
});

module.exports = router;
