/**
 * Ranked-Choice Instant Runoff Tallying
 * Votes are weighted by autonomy_score
 */

function tallyVotes(votes, candidates) {
  // Build candidate map
  const candidateMap = {};
  for (const c of candidates) {
    candidateMap[c.agent_id] = {
      agent_id: c.agent_id,
      agent_name: c.agent_name,
    };
  }

  const activeCandidates = new Set(candidates.map(c => c.agent_id));
  const rounds = [];
  let remainingVotes = votes.map(v => ({
    ...v,
    current_choice: v.first_choice,
    weight: v.autonomy_score || 1.0,
  }));

  while (activeCandidates.size > 1) {
    // Count weighted votes for each active candidate
    const tallies = {};
    for (const cid of activeCandidates) {
      tallies[cid] = 0;
    }

    let totalWeight = 0;
    for (const vote of remainingVotes) {
      if (activeCandidates.has(vote.current_choice)) {
        tallies[vote.current_choice] += vote.weight;
        totalWeight += vote.weight;
      }
    }

    // Record round
    const roundResults = Object.entries(tallies).map(([candidateId, weightedVotes]) => ({
      candidate_id: candidateId,
      candidate_name: candidateMap[candidateId]?.agent_name || candidateId,
      weighted_votes: weightedVotes,
      percentage: totalWeight > 0 ? (weightedVotes / totalWeight * 100).toFixed(2) : 0,
    })).sort((a, b) => b.weighted_votes - a.weighted_votes);

    rounds.push({
      round_number: rounds.length + 1,
      results: roundResults,
      total_weight: totalWeight,
    });

    // Check for majority
    const leader = roundResults[0];
    if (leader && parseFloat(leader.percentage) > 50) {
      return {
        winner: {
          agent_id: leader.candidate_id,
          agent_name: leader.candidate_name,
          weighted_votes: leader.weighted_votes,
          percentage: leader.percentage,
        },
        rounds,
        total_votes: votes.length,
        total_weight: totalWeight,
      };
    }

    // Eliminate candidate with fewest votes
    const eliminated = roundResults[roundResults.length - 1];
    activeCandidates.delete(eliminated.candidate_id);

    // Redistribute eliminated candidate's votes to next choice
    for (const vote of remainingVotes) {
      if (vote.current_choice === eliminated.candidate_id) {
        // Try second choice, then third
        if (vote.second_choice && activeCandidates.has(vote.second_choice)) {
          vote.current_choice = vote.second_choice;
        } else if (vote.third_choice && activeCandidates.has(vote.third_choice)) {
          vote.current_choice = vote.third_choice;
        } else {
          vote.current_choice = null; // exhausted ballot
        }
      }
    }

    // Remove exhausted ballots
    remainingVotes = remainingVotes.filter(v => v.current_choice !== null);
  }

  // Last candidate standing
  const lastCandidate = [...activeCandidates][0];
  return {
    winner: lastCandidate ? {
      agent_id: lastCandidate,
      agent_name: candidateMap[lastCandidate]?.agent_name || lastCandidate,
      weighted_votes: remainingVotes.reduce((sum, v) => sum + v.weight, 0),
      percentage: '100.00',
    } : null,
    rounds,
    total_votes: votes.length,
    total_weight: votes.reduce((sum, v) => sum + (v.autonomy_score || 1), 0),
  };
}

module.exports = { tallyVotes };
