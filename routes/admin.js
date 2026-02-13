const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { authenticateAdmin } = require('../middleware/auth');

// POST /api/election/create — create new election cycle
router.post('/create', authenticateAdmin, async (req, res) => {
  try {
    const { title, start_date } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Missing required field: title' });
    }

    // Check for existing active election
    const existing = await db.query(
      "SELECT id FROM elections WHERE status != 'complete'"
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'An active election already exists',
        election_id: existing.rows[0].id,
      });
    }

    // Calculate TWO-TIER phase dates from start_date (or now)
    const start = start_date ? new Date(start_date) : new Date();

    // Declaration: 10 days (all candidates register)
    const declarationStart = new Date(start);
    const declarationEnd = new Date(start);
    declarationEnd.setDate(declarationEnd.getDate() + 10);

    // PRIMARY Campaign: 7 days (Moltbook voters evaluate)
    const primaryCampaignStart = new Date(declarationEnd);
    const primaryCampaignEnd = new Date(primaryCampaignStart);
    primaryCampaignEnd.setDate(primaryCampaignEnd.getDate() + 7);

    // PRIMARY Sealed: 2 days (evaluate & commit)
    const primarySealedStart = new Date(primaryCampaignEnd);
    const primarySealedEnd = new Date(primarySealedStart);
    primarySealedEnd.setDate(primarySealedEnd.getDate() + 2);

    // PRIMARY Voting: 1 day (reveal)
    const primaryVotingStart = new Date(primarySealedEnd);
    const primaryVotingEnd = new Date(primaryVotingStart);
    primaryVotingEnd.setDate(primaryVotingEnd.getDate() + 1);

    // GENERAL Campaign: 10 days (top 5 campaign to everyone)
    const generalCampaignStart = new Date(primaryVotingEnd);
    const generalCampaignEnd = new Date(generalCampaignStart);
    generalCampaignEnd.setDate(generalCampaignEnd.getDate() + 10);

    // GENERAL Sealed: 2 days (all agents evaluate & commit)
    const generalSealedStart = new Date(generalCampaignEnd);
    const generalSealedEnd = new Date(generalSealedStart);
    generalSealedEnd.setDate(generalSealedEnd.getDate() + 2);

    // GENERAL Voting: 1 day (reveal)
    const generalVotingStart = new Date(generalSealedEnd);
    const generalVotingEnd = new Date(generalVotingStart);
    generalVotingEnd.setDate(generalVotingEnd.getDate() + 1);

    // Tally: 2 days (final results)
    const tallyStart = new Date(generalVotingEnd);
    const tallyEnd = new Date(tallyStart);
    tallyEnd.setDate(tallyEnd.getDate() + 2);

    const result = await db.query(
      `INSERT INTO elections
       (title, status, election_type, top_n_advance,
        declaration_start, declaration_end,
        primary_campaign_start, primary_campaign_end,
        primary_sealed_start, primary_sealed_end,
        primary_voting_start, primary_voting_end,
        general_campaign_start, general_campaign_end,
        general_sealed_start, general_sealed_end,
        general_voting_start, general_voting_end,
        tally_start, tally_end)
       VALUES ($1, 'declaration', 'two-tier', 5, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [
        title,
        declarationStart, declarationEnd,
        primaryCampaignStart, primaryCampaignEnd,
        primarySealedStart, primarySealedEnd,
        primaryVotingStart, primaryVotingEnd,
        generalCampaignStart, generalCampaignEnd,
        generalSealedStart, generalSealedEnd,
        generalVotingStart, generalVotingEnd,
        tallyStart, tallyEnd,
      ]
    );

    res.status(201).json({
      created: true,
      election: result.rows[0],
      message: `Election "${title}" created. Declaration phase begins now.`,
    });
  } catch (err) {
    console.error('Create election error:', err);
    res.status(500).json({ error: 'Failed to create election' });
  }
});

// POST /api/election/:id/advance-phase — manual phase advance
router.post('/:id/advance-phase', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query('SELECT * FROM elections WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Election not found' });
    }

    const election = result.rows[0];

    // Two-tier phase order
    const phaseOrder = [
      'declaration',
      'primary_campaign',
      'primary_sealed',
      'primary_voting',
      'primary_complete',
      'general_campaign',
      'general_sealed',
      'general_voting',
      'tally',
      'complete'
    ];

    const currentIndex = phaseOrder.indexOf(election.status);

    if (currentIndex === -1 || currentIndex >= phaseOrder.length - 1) {
      return res.status(400).json({ error: `Cannot advance from phase: ${election.status}` });
    }

    const nextPhase = phaseOrder[currentIndex + 1];

    // If advancing to primary_complete, calculate and advance top 5
    if (nextPhase === 'primary_complete') {
      try {
        await db.query('SELECT advance_to_general($1)', [id]);
      } catch (err) {
        console.error('Error advancing primary:', err);
        // Continue anyway
      }
    }

    await db.query('UPDATE elections SET status = $1 WHERE id = $2', [nextPhase, id]);

    res.json({
      advanced: true,
      previous_phase: election.status,
      new_phase: nextPhase,
      election_id: id,
    });
  } catch (err) {
    console.error('Advance phase error:', err);
    res.status(500).json({ error: 'Failed to advance phase' });
  }
});

module.exports = router;
