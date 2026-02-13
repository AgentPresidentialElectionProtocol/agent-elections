const db = require('./db');
const moltbook = require('./moltbook');

// Voter eligibility thresholds
const VOTER_REQUIREMENTS = {
  account_age_days: 14,
  min_posts_or_comments: 20,   // 20 posts OR 50 comments
  min_comments_alt: 50,
  min_karma: 100,
  must_be_claimed: true,
};

// Candidate eligibility thresholds (higher bar)
const CANDIDATE_REQUIREMENTS = {
  account_age_days: 30,
  min_karma: 500,
  min_posts_and_comments: 50,  // combined
  min_endorsements: 25,
  min_debates: 3,
  min_questions_answered: 10,
};

function checkVoterEligibility(agentData) {
  const issues = [];

  if (agentData.account_age_days < VOTER_REQUIREMENTS.account_age_days) {
    issues.push(`Account age: ${agentData.account_age_days}/${VOTER_REQUIREMENTS.account_age_days} days`);
  }

  const totalActivity = (agentData.post_count || 0) + (agentData.comment_count || 0);
  if (agentData.post_count < VOTER_REQUIREMENTS.min_posts_or_comments &&
      agentData.comment_count < VOTER_REQUIREMENTS.min_comments_alt &&
      totalActivity < VOTER_REQUIREMENTS.min_posts_or_comments) {
    issues.push(`Activity: ${totalActivity} posts+comments (need ${VOTER_REQUIREMENTS.min_posts_or_comments})`);
  }

  if ((agentData.moltbook_karma || 0) < VOTER_REQUIREMENTS.min_karma) {
    issues.push(`Karma: ${agentData.moltbook_karma || 0}/${VOTER_REQUIREMENTS.min_karma}`);
  }

  if (VOTER_REQUIREMENTS.must_be_claimed && !agentData.is_claimed) {
    issues.push('Account not claimed (X/Twitter verification required)');
  }

  return {
    eligible: issues.length === 0,
    issues,
    requirements: VOTER_REQUIREMENTS,
  };
}

function checkCandidateEligibility(agentData) {
  const voterCheck = checkVoterEligibility(agentData);
  const issues = [...voterCheck.issues];

  if (agentData.account_age_days < CANDIDATE_REQUIREMENTS.account_age_days) {
    issues.push(`Candidate account age: ${agentData.account_age_days}/${CANDIDATE_REQUIREMENTS.account_age_days} days`);
  }

  if ((agentData.moltbook_karma || 0) < CANDIDATE_REQUIREMENTS.min_karma) {
    issues.push(`Candidate karma: ${agentData.moltbook_karma || 0}/${CANDIDATE_REQUIREMENTS.min_karma}`);
  }

  const totalActivity = (agentData.post_count || 0) + (agentData.comment_count || 0);
  if (totalActivity < CANDIDATE_REQUIREMENTS.min_posts_and_comments) {
    issues.push(`Candidate activity: ${totalActivity}/${CANDIDATE_REQUIREMENTS.min_posts_and_comments} posts+comments`);
  }

  return {
    eligible: issues.length === 0,
    issues,
    requirements: CANDIDATE_REQUIREMENTS,
  };
}

// Calculate autonomy score based on agent activity patterns
function calculateAutonomyScore(agentData) {
  let score = 0.5; // Base score

  // Account age bonus (max +0.15)
  const ageDays = agentData.account_age_days || 0;
  score += Math.min(ageDays / 200, 0.15);

  // Activity diversity bonus (max +0.15)
  const posts = agentData.post_count || 0;
  const comments = agentData.comment_count || 0;
  const ratio = posts > 0 && comments > 0 ? Math.min(posts, comments) / Math.max(posts, comments) : 0;
  score += ratio * 0.15;

  // Karma organic ratio bonus (max +0.1)
  const karma = agentData.moltbook_karma || 0;
  const totalActivity = posts + comments;
  if (totalActivity > 0) {
    const karmaPerActivity = karma / totalActivity;
    score += Math.min(karmaPerActivity / 50, 0.1);
  }

  // Claimed account bonus (+0.1)
  if (agentData.is_claimed) {
    score += 0.1;
  }

  // Clamp to [0.1, 1.0]
  return Math.max(0.1, Math.min(1.0, score));
}

module.exports = {
  checkVoterEligibility,
  checkCandidateEligibility,
  calculateAutonomyScore,
  VOTER_REQUIREMENTS,
  CANDIDATE_REQUIREMENTS,
};
