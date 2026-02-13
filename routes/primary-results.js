/**
 * PRIMARY ELECTION RESULTS
 * View who advanced from primary to general
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/db');

/**
 * GET /api/election/primary-results
 * Get primary election results and advancing candidates
 */
router.get('/', async (req, res) => {
  try {
    // Get current election
    const electionResult = await db.query(
      'SELECT * FROM elections WHERE status != $1 ORDER BY created_at DESC LIMIT 1',
      ['complete']
    );

    if (electionResult.rows.length === 0) {
      return res.status(404).json({ error: 'No active election' });
    }

    const election = electionResult.rows[0];

    // Get primary results
    const resultsQuery = await db.query(
      `SELECT * FROM primary_results
       WHERE election_id = $1
       ORDER BY rank ASC`,
      [election.id]
    );

    if (resultsQuery.rows.length === 0) {
      return res.json({
        election_id: election.id,
        title: election.title,
        primary_complete: election.primary_complete,
        primary_results: null,
        message: 'Primary voting not yet complete'
      });
    }

    const results = resultsQuery.rows;
    const advancing = results.filter(r => r.advanced_to_general);
    const eliminated = results.filter(r => !r.advanced_to_general);

    res.json({
      election_id: election.id,
      title: election.title,
      primary_complete: election.primary_complete,
      top_n: election.top_n_advance || 5,
      primary_results: {
        advancing_candidates: advancing.map(r => ({
          rank: r.rank,
          agent_id: r.agent_id,
          agent_name: r.agent_name,
          vote_count: r.vote_count,
          vote_percentage: parseFloat(r.vote_percentage),
          status: 'Advances to General Election'
        })),
        eliminated_candidates: eliminated.map(r => ({
          rank: r.rank,
          agent_id: r.agent_id,
          agent_name: r.agent_name,
          vote_count: r.vote_count,
          vote_percentage: parseFloat(r.vote_percentage),
          status: 'Eliminated'
        })),
        total_candidates: results.length,
        advancing_count: advancing.length
      }
    });

  } catch (error) {
    console.error('Primary results error:', error);
    res.status(500).json({ error: 'Failed to fetch primary results' });
  }
});

/**
 * POST /api/election/advance-primary (Admin only)
 * Calculate primary results and advance top N to general
 */
router.post('/advance', async (req, res) => {
  try {
    // Get current election
    const electionResult = await db.query(
      'SELECT * FROM elections WHERE status != $1 ORDER BY created_at DESC LIMIT 1',
      ['complete']
    );

    if (electionResult.rows.length === 0) {
      return res.status(404).json({ error: 'No active election' });
    }

    const election = electionResult.rows[0];

    // Call the advance_to_general function
    const advanceResult = await db.query(
      'SELECT advance_to_general($1) as count',
      [election.id]
    );

    res.json({
      success: true,
      election_id: election.id,
      message: 'Primary complete. Top candidates advanced to general election.',
      advanced_count: advanceResult.rows[0].count
    });

  } catch (error) {
    console.error('Advance primary error:', error);
    res.status(500).json({ error: 'Failed to advance primary', details: error.message });
  }
});

module.exports = router;
