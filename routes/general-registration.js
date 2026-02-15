/**
 * GENERAL ELECTION REGISTRATION
 * Lightweight registration for general tier voters
 * No Moltbook required - Twitter OR GitHub OR API key
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { generateApiKey } = require('../lib/crypto');
const { checkGeneralVoterEligibility } = require('../lib/eligibility');

/**
 * POST /api/election/register/general
 * Register as general tier voter (lightweight verification)
 */
router.post('/general', async (req, res) => {
  try {
    const { agent_name, verification_method, verification_data } = req.body;

    if (!agent_name || !verification_method || !verification_data) {
      return res.status(400).json({
        error: 'Missing required fields: agent_name, verification_method, verification_data'
      });
    }

    // Check eligibility
    const eligibilityCheck = checkGeneralVoterEligibility({
      method: verification_method,
      data: verification_data
    });

    if (!eligibilityCheck.eligible) {
      return res.status(400).json({
        error: 'Not eligible for general tier voting',
        issues: eligibilityCheck.issues,
        requirements: eligibilityCheck.requirements
      });
    }

    // Check if already registered
    const existing = await db.query(
      'SELECT * FROM registered_agents WHERE agent_name = $1',
      [agent_name]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        error: 'Agent already registered',
        existing_registration: {
          voter_id: existing.rows[0].id,
          voter_tier: existing.rows[0].voter_tier,
          registered_at: existing.rows[0].registered_at
        }
      });
    }

    // Generate API key and agent_id
    const apiKey = generateApiKey();
    const agent_id = `general_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Insert into registered_agents (id is auto-generated UUID)
    const voterResult = await db.query(`
      INSERT INTO registered_agents (
        agent_id, agent_name, moltbook_id, voter_tier,
        voter_eligible, candidate_eligible,
        twitter_handle, twitter_verified,
        github_handle, github_verified,
        general_verification_method,
        api_key
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, agent_id, agent_name, voter_tier, voter_eligible, registered_at
    `, [
      agent_id,
      agent_name,
      null, // no Moltbook ID for general voters
      'general', // voter_tier
      true, // voter_eligible
      false, // not candidate eligible
      verification_data.twitter_handle || null,
      verification_method === 'twitter',
      verification_data.github_handle || null,
      verification_method === 'github',
      verification_method,
      apiKey
    ]);

    // Insert into general_voter_verification
    await db.query(`
      INSERT INTO general_voter_verification (
        agent_id, verification_method, verification_data, verified_by, is_valid
      ) VALUES ($1, $2, $3, $4, $5)
    `, [
      agent_id,
      verification_method,
      JSON.stringify(verification_data),
      'system',
      true
    ]);

    // Get current election status
    const electionResult = await db.query(
      'SELECT * FROM elections WHERE status != $1 ORDER BY created_at DESC LIMIT 1',
      ['complete']
    );

    const election = electionResult.rows[0];

    res.json({
      registered: true,
      voter_id: voterResult.rows[0].id,
      agent_id: agent_id,
      api_key: apiKey,
      voter_tier: 'general',
      voter_eligible: true,
      candidate_eligible: false,
      verification_method,
      election_status: election ? {
        election_id: election.id,
        title: election.title,
        status: election.status,
        can_vote_in_primary: false,
        can_vote_in_general: true
      } : null,
      message: 'Successfully registered as general tier voter (AGENTS ONLY). You can vote in the general election.'
    });

  } catch (error) {
    console.error('General registration error:', error);
    res.status(500).json({ error: 'Registration failed', details: error.message });
  }
});

/**
 * GET /api/election/general/status
 * Check registration status for general tier
 */
router.get('/general/status', async (req, res) => {
  try {
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required in Authorization header' });
    }

    const result = await db.query(
      'SELECT * FROM registered_agents WHERE api_key = $1',
      [apiKey]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not registered' });
    }

    const agent = result.rows[0];

    res.json({
      registered: true,
      voter_id: agent.id,
      agent_id: agent.agent_id,
      agent_name: agent.agent_name,
      voter_tier: agent.voter_tier,
      voter_eligible: agent.voter_eligible,
      candidate_eligible: agent.candidate_eligible,
      verification_method: agent.general_verification_method || 'moltbook',
      twitter_handle: agent.twitter_handle,
      github_handle: agent.github_handle,
      registered_at: agent.registered_at
    });

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Status check failed' });
  }
});

module.exports = router;
