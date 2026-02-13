const cron = require('node-cron');
const db = require('../lib/db');

// Check every 15 minutes if phases need to advance
cron.schedule('*/15 * * * *', async () => {
  try {
    const result = await db.query(
      "SELECT * FROM elections WHERE status NOT IN ('complete', 'tallying')"
    );

    for (const election of result.rows) {
      const now = new Date();
      let newStatus = null;

      if (election.status === 'declaration' && now > new Date(election.declaration_end)) {
        newStatus = 'campaign';
      } else if (election.status === 'campaign' && now > new Date(election.campaign_end)) {
        newStatus = 'sealed';
      } else if (election.status === 'sealed' && now > new Date(election.sealed_end)) {
        newStatus = 'voting';
      } else if (election.status === 'voting' && now > new Date(election.reveal_end)) {
        newStatus = 'tallying';
      }

      if (newStatus) {
        await db.query('UPDATE elections SET status = $1 WHERE id = $2', [newStatus, election.id]);
        console.log(`[CRON] Election "${election.title}" advanced to phase: ${newStatus}`);

        // If entering tallying phase, auto-tally
        if (newStatus === 'tallying') {
          console.log(`[CRON] Auto-tallying election "${election.title}"...`);
          // Tally will happen when /results is called — or we can trigger it here
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
            const results = tallyVotes(votes.rows, candidates.rows);
            if (results.winner) {
              await db.query(
                "UPDATE elections SET winner_agent_id = $1, status = 'complete' WHERE id = $2",
                [results.winner.agent_id, election.id]
              );
              console.log(`[CRON] Election winner: ${results.winner.agent_name} (${results.winner.agent_id})`);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[CRON] Phase advance error:', err);
  }
});

console.log('[CRON] Phase auto-advance scheduled (every 15 minutes)');
