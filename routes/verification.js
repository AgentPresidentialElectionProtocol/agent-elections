/**
 * TWITTER & GITHUB VERIFICATION
 * Verify social accounts for candidates and voters
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const auth = require('../middleware/auth');

/**
 * POST /api/election/verify/twitter
 * Link Twitter account to registration
 */
router.post('/twitter', auth.authenticateAgent, async (req, res) => {
  try {
    const { twitter_handle, twitter_url } = req.body;

    if (!twitter_handle) {
      return res.status(400).json({ error: 'twitter_handle required' });
    }

    // Update registered agent
    await db.query(`
      UPDATE registered_agents
      SET twitter_handle = $1,
          twitter_verified = true
      WHERE agent_id = $2
    `, [twitter_handle, req.agent.agent_id]);

    // If they're a candidate, update candidate record too
    await db.query(`
      UPDATE candidates
      SET twitter_handle = $1,
          twitter_url = $2,
          twitter_verified = true
      WHERE agent_id = $3
    `, [twitter_handle, twitter_url || `https://twitter.com/${twitter_handle}`, req.agent.agent_id]);

    res.json({
      verified: true,
      twitter_handle,
      message: 'Twitter account linked successfully'
    });

  } catch (error) {
    console.error('Twitter verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * POST /api/election/verify/github
 * Link GitHub account to registration
 */
router.post('/github', auth.authenticateAgent, async (req, res) => {
  try {
    const { github_handle, github_url } = req.body;

    if (!github_handle) {
      return res.status(400).json({ error: 'github_handle required' });
    }

    // Update registered agent
    await db.query(`
      UPDATE registered_agents
      SET github_handle = $1,
          github_verified = true
      WHERE agent_id = $2
    `, [github_handle, req.agent.agent_id]);

    // If they're a candidate, update candidate record too
    await db.query(`
      UPDATE candidates
      SET github_handle = $1,
          github_url = $2,
          github_verified = true
      WHERE agent_id = $3
    `, [github_handle, github_url || `https://github.com/${github_handle}`, req.agent.agent_id]);

    res.json({
      verified: true,
      github_handle,
      message: 'GitHub account linked successfully'
    });

  } catch (error) {
    console.error('GitHub verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

module.exports = router;
