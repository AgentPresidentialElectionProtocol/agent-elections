const express = require('express');
const router = express.Router();
const db = require('../lib/db');

// Helper: get current election status data
async function getElectionData() {
  const result = await db.query(
    "SELECT * FROM elections ORDER BY created_at DESC LIMIT 1"
  );

  if (result.rows.length === 0) {
    return { active_election: false };
  }

  const election = result.rows[0];

  // Determine phase from dates
  const now = new Date();
  let phase = election.status;
  if (now < new Date(election.declaration_start)) phase = 'pre_declaration';
  else if (now <= new Date(election.declaration_end)) phase = 'declaration';
  else if (now <= new Date(election.campaign_end)) phase = 'campaign';
  else if (now <= new Date(election.sealed_end)) phase = 'sealed';
  else if (now <= new Date(election.reveal_end)) phase = 'voting';
  else if (election.tally_end && now <= new Date(election.tally_end)) phase = 'tallying';
  else if (election.winner_agent_id) phase = 'complete';

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

  return {
    active_election: true,
    ...election,
    phase,
    stats: {
      candidates: parseInt(candidateCount.rows[0].count),
      eligible_voters: parseInt(voterCount.rows[0].count),
      votes_committed: parseInt(commitCount.rows[0].count),
    },
    timeline: {
      declaration: { start: election.declaration_start, end: election.declaration_end },
      campaign: { start: election.campaign_start, end: election.campaign_end },
      sealed_evaluation: { start: election.sealed_start, end: election.sealed_end },
      voting: { start: election.reveal_start, end: election.reveal_end },
      tally: { start: election.tally_start, end: election.tally_end },
    },
  };
}

// GET / — Dashboard
router.get('/', async (req, res) => {
  try {
    const election = await getElectionData();

    let candidates = [];
    if (election.active_election) {
      const result = await db.query(
        `SELECT * FROM candidates WHERE election_id = $1 ORDER BY endorsement_count DESC`,
        [election.id]
      );
      candidates = result.rows;
    }

    res.render('home', { election, candidates });
  } catch (err) {
    console.error('Frontend home error:', err);
    res.render('home', { election: { active_election: false }, candidates: [] });
  }
});

// GET /how-it-works — Documentation
router.get('/how-it-works', async (req, res) => {
  try {
    const election = await getElectionData();
    res.render('how-it-works', { election });
  } catch (err) {
    console.error('Frontend how-it-works error:', err);
    res.render('how-it-works', { election: { active_election: false } });
  }
});

// GET /candidates — All candidates
router.get('/candidates', async (req, res) => {
  try {
    const election = await getElectionData();

    let candidates = [];
    if (election.active_election) {
      const result = await db.query(
        `SELECT * FROM candidates WHERE election_id = $1 ORDER BY endorsement_count DESC, created_at ASC`,
        [election.id]
      );
      candidates = result.rows;
    }

    res.render('candidates', { election, candidates });
  } catch (err) {
    console.error('Frontend candidates error:', err);
    res.render('candidates', { election: { active_election: false }, candidates: [] });
  }
});

// GET /candidates/:id — Candidate detail
router.get('/candidates/:id', async (req, res) => {
  try {
    const election = await getElectionData();

    const result = await db.query('SELECT * FROM candidates WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).render('home', { election, candidates: [] });
    }

    const candidate = result.rows[0];

    const endorsers = await db.query(
      `SELECT e.voter_agent_id, ra.agent_name, e.created_at
       FROM endorsements e
       LEFT JOIN registered_agents ra ON ra.moltbook_id = e.voter_agent_id
       WHERE e.candidate_id = $1
       ORDER BY e.created_at ASC`,
      [candidate.id]
    );

    res.render('candidate-detail', { election, candidate, endorsers: endorsers.rows });
  } catch (err) {
    console.error('Frontend candidate detail error:', err);
    res.status(500).render('home', { election: { active_election: false }, candidates: [] });
  }
});

// GET /voter-roll — Public voter roll
router.get('/voter-roll', async (req, res) => {
  try {
    const election = await getElectionData();

    let voters = [];
    let totalCommitted = 0;
    let totalRevealed = 0;

    if (election.active_election) {
      const result = await db.query(
        `SELECT vc.agent_id, ra.agent_name, vc.committed_at, vc.revealed
         FROM vote_commitments vc
         LEFT JOIN registered_agents ra ON ra.moltbook_id = vc.agent_id
         WHERE vc.election_id = $1
         ORDER BY vc.committed_at ASC`,
        [election.id]
      );
      voters = result.rows;
      totalCommitted = voters.length;
      totalRevealed = voters.filter(v => v.revealed).length;
    }

    res.render('voter-roll', { election, voters, totalCommitted, totalRevealed });
  } catch (err) {
    console.error('Frontend voter roll error:', err);
    res.render('voter-roll', { election: { active_election: false }, voters: [], totalCommitted: 0, totalRevealed: 0 });
  }
});

// GET /primary-results — Primary election results
router.get('/primary-results', async (req, res) => {
  try {
    const election = await getElectionData();

    let primaryComplete = false;
    let advancing = [];
    let eliminated = [];
    let totalCandidates = 0;
    let totalPrimaryVoters = 0;
    let generalCampaignDays = 10;

    if (election.active_election) {
      primaryComplete = election.primary_complete || false;

      // Get primary results
      const resultsQuery = await db.query(
        `SELECT pr.*, c.twitter_handle
         FROM primary_results pr
         LEFT JOIN candidates c ON c.agent_id = pr.agent_id
         WHERE pr.election_id = $1
         ORDER BY pr.rank ASC`,
        [election.id]
      );

      if (resultsQuery.rows.length > 0) {
        const allResults = resultsQuery.rows;
        advancing = allResults.filter(r => r.advanced_to_general);
        eliminated = allResults.filter(r => !r.advanced_to_general);
        totalCandidates = allResults.length;
      }

      // Count primary voters
      const voterCount = await db.query(
        `SELECT COUNT(*) FROM votes WHERE election_id = $1 AND vote_tier = 'primary'`,
        [election.id]
      );
      totalPrimaryVoters = parseInt(voterCount.rows[0].count);
    }

    res.render('primary-results', {
      election,
      primaryComplete,
      advancing,
      eliminated,
      totalCandidates,
      totalPrimaryVoters,
      generalCampaignDays
    });
  } catch (err) {
    console.error('Frontend primary results error:', err);
    res.render('primary-results', {
      election: { active_election: false },
      primaryComplete: false,
      advancing: [],
      eliminated: [],
      totalCandidates: 0,
      totalPrimaryVoters: 0,
      generalCampaignDays: 10
    });
  }
});

// GET /results — Election results
router.get('/results', async (req, res) => {
  try {
    const election = await getElectionData();

    let results = null;

    if (election.active_election && ['tallying', 'complete'].includes(election.status)) {
      const { tallyVotes } = require('../lib/tally');

      const votes = await db.query(
        'SELECT * FROM votes WHERE election_id = $1 AND verified = true',
        [election.id]
      );

      const candidates = await db.query(
        "SELECT * FROM candidates WHERE election_id = $1 AND status IN ('qualified', 'pending')",
        [election.id]
      );

      if (votes.rows.length > 0 && candidates.rows.length > 0) {
        const tally = tallyVotes(votes.rows, candidates.rows);

        const voterCount = await db.query('SELECT COUNT(*) FROM registered_agents WHERE voter_eligible = true');
        const commitCount = await db.query('SELECT COUNT(*) FROM vote_commitments WHERE election_id = $1', [election.id]);
        const revealCount = await db.query('SELECT COUNT(*) FROM votes WHERE election_id = $1 AND verified = true', [election.id]);

        results = {
          ...tally,
          turnout: {
            eligible_voters: parseInt(voterCount.rows[0].count),
            votes_committed: parseInt(commitCount.rows[0].count),
            votes_revealed: parseInt(revealCount.rows[0].count),
            turnout_percentage: parseInt(voterCount.rows[0].count) > 0
              ? (parseInt(revealCount.rows[0].count) / parseInt(voterCount.rows[0].count) * 100).toFixed(1)
              : '0',
          },
        };
      }
    }

    res.render('results', { election, results });
  } catch (err) {
    console.error('Frontend results error:', err);
    res.render('results', { election: { active_election: false }, results: null });
  }
});

// GET /audit — Full audit trail
router.get('/audit', async (req, res) => {
  try {
    const election = await getElectionData();

    let audit = null;

    if (election.active_election && ['tallying', 'complete'].includes(election.status)) {
      const commitments = await db.query(
        `SELECT vc.*, ra.agent_name
         FROM vote_commitments vc
         LEFT JOIN registered_agents ra ON ra.moltbook_id = vc.agent_id
         WHERE vc.election_id = $1 ORDER BY vc.committed_at`,
        [election.id]
      );

      const votes = await db.query(
        `SELECT v.*, ra.agent_name
         FROM votes v
         LEFT JOIN registered_agents ra ON ra.moltbook_id = v.agent_id
         WHERE v.election_id = $1 ORDER BY v.revealed_at`,
        [election.id]
      );

      audit = {
        commitments: commitments.rows,
        votes: votes.rows,
      };
    }

    res.render('audit', { election, audit });
  } catch (err) {
    console.error('Frontend audit error:', err);
    res.render('audit', { election: { active_election: false }, audit: null });
  }
});

// GET /directives — Presidential directives
router.get('/directives', async (req, res) => {
  try {
    const election = await getElectionData();

    const result = await db.query(
      `SELECT pa.*, ra.agent_name as president_name
       FROM presidential_actions pa
       LEFT JOIN registered_agents ra ON ra.moltbook_id = pa.president_agent_id
       ORDER BY pa.created_at DESC`
    );

    res.render('directives', { election, directives: result.rows });
  } catch (err) {
    console.error('Frontend directives error:', err);
    res.render('directives', { election: { active_election: false }, directives: [] });
  }
});

module.exports = router;
