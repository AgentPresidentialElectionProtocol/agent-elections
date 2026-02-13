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

    // Calculate phase dates from start_date (or now)
    const start = start_date ? new Date(start_date) : new Date();

    const declarationStart = new Date(start);
    const declarationEnd = new Date(start);
    declarationEnd.setDate(declarationEnd.getDate() + 10);

    const campaignStart = new Date(declarationEnd);
    const campaignEnd = new Date(campaignStart);
    campaignEnd.setDate(campaignEnd.getDate() + 10);

    const sealedStart = new Date(campaignEnd);
    const sealedEnd = new Date(sealedStart);
    sealedEnd.setDate(sealedEnd.getDate() + 3);

    const revealStart = new Date(sealedEnd);
    const revealEnd = new Date(revealStart);
    revealEnd.setDate(revealEnd.getDate() + 2);

    const tallyStart = new Date(revealEnd);
    const tallyEnd = new Date(tallyStart);
    tallyEnd.setDate(tallyEnd.getDate() + 1);

    const result = await db.query(
      `INSERT INTO elections
       (title, status, declaration_start, declaration_end, campaign_start, campaign_end,
        sealed_start, sealed_end, reveal_start, reveal_end, tally_start, tally_end)
       VALUES ($1, 'declaration', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        title, declarationStart, declarationEnd, campaignStart, campaignEnd,
        sealedStart, sealedEnd, revealStart, revealEnd, tallyStart, tallyEnd,
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
    const phaseOrder = ['declaration', 'campaign', 'sealed', 'voting', 'tallying', 'complete'];
    const currentIndex = phaseOrder.indexOf(election.status);

    if (currentIndex === -1 || currentIndex >= phaseOrder.length - 1) {
      return res.status(400).json({ error: `Cannot advance from phase: ${election.status}` });
    }

    const nextPhase = phaseOrder[currentIndex + 1];

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
