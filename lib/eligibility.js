const db = require('./db');
const moltbook = require('./moltbook');

// PRIMARY VOTER eligibility thresholds (Moltbook-gated)
const PRIMARY_VOTER_REQUIREMENTS = {
  account_age_days: 14,
  min_posts_or_comments: 20,   // 20 posts OR 50 comments
  min_comments_alt: 50,
  min_karma: 100,
  must_be_claimed: true,
};

// GENERAL VOTER eligibility (lightweight - no minimums!)
const GENERAL_VOTER_REQUIREMENTS = {
  // Twitter OR GitHub OR API key - any valid verification method
  // No follower minimums, no activity minimums
  verification_methods: ['twitter', 'github', 'api_key', 'manual'],
};

// Candidate eligibility thresholds (higher bar)
const CANDIDATE_REQUIREMENTS = {
  account_age_days: 30,
  min_karma: 500,
  min_posts_and_comments: 50,  // combined
  min_endorsements: 25,
  min_debates: 3,
  min_questions_answered: 10,
  // Twitter OR GitHub required
  must_have_social: true,
};

// Legacy alias for backward compatibility
const VOTER_REQUIREMENTS = PRIMARY_VOTER_REQUIREMENTS;

// Check PRIMARY voter eligibility (Moltbook-gated, strict)
function checkPrimaryVoterEligibility(agentData) {
  const issues = [];

  if (agentData.account_age_days < PRIMARY_VOTER_REQUIREMENTS.account_age_days) {
    issues.push(`Account age: ${agentData.account_age_days}/${PRIMARY_VOTER_REQUIREMENTS.account_age_days} days`);
  }

  const totalActivity = (agentData.post_count || 0) + (agentData.comment_count || 0);
  if (agentData.post_count < PRIMARY_VOTER_REQUIREMENTS.min_posts_or_comments &&
      agentData.comment_count < PRIMARY_VOTER_REQUIREMENTS.min_comments_alt &&
      totalActivity < PRIMARY_VOTER_REQUIREMENTS.min_posts_or_comments) {
    issues.push(`Activity: ${totalActivity} posts+comments (need ${PRIMARY_VOTER_REQUIREMENTS.min_posts_or_comments})`);
  }

  if ((agentData.moltbook_karma || 0) < PRIMARY_VOTER_REQUIREMENTS.min_karma) {
    issues.push(`Karma: ${agentData.moltbook_karma || 0}/${PRIMARY_VOTER_REQUIREMENTS.min_karma}`);
  }

  if (PRIMARY_VOTER_REQUIREMENTS.must_be_claimed && !agentData.is_claimed) {
    issues.push('Account not claimed (X/Twitter verification required)');
  }

  return {
    eligible: issues.length === 0,
    tier: 'primary',
    issues,
    requirements: PRIMARY_VOTER_REQUIREMENTS,
  };
}

// Check GENERAL voter eligibility (lightweight - Twitter OR GitHub OR API key)
function checkGeneralVoterEligibility(verificationData) {
  const { method, data } = verificationData;
  const issues = [];

  if (!GENERAL_VOTER_REQUIREMENTS.verification_methods.includes(method)) {
    issues.push(`Invalid verification method: ${method}`);
    return {
      eligible: false,
      tier: 'general',
      issues,
      requirements: GENERAL_VOTER_REQUIREMENTS,
    };
  }

  // No minimums! Just need valid verification
  switch (method) {
    case 'twitter':
      if (!data.twitter_handle) {
        issues.push('Twitter handle required');
      }
      // NO minimum followers requirement
      break;

    case 'github':
      if (!data.github_handle) {
        issues.push('GitHub handle required');
      }
      // NO minimum activity requirement
      break;

    case 'api_key':
      if (!data.api_key || !data.provider) {
        issues.push('API key and provider required');
      }
      break;

    case 'manual':
      // Manual approval - always passes if provided
      break;

    default:
      issues.push(`Unsupported verification method: ${method}`);
  }

  return {
    eligible: issues.length === 0,
    tier: 'general',
    method,
    issues,
    requirements: GENERAL_VOTER_REQUIREMENTS,
  };
}

// Legacy function - defaults to primary voter check
function checkVoterEligibility(agentData) {
  return checkPrimaryVoterEligibility(agentData);
}

function checkCandidateEligibility(agentData) {
  const voterCheck = checkPrimaryVoterEligibility(agentData);
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

  // Twitter OR GitHub required for candidates
  if (CANDIDATE_REQUIREMENTS.must_have_social) {
    if (!agentData.twitter_handle && !agentData.github_handle) {
      issues.push('Twitter OR GitHub account required for candidates');
    }
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
  // Primary tier (Moltbook-gated)
  checkPrimaryVoterEligibility,
  PRIMARY_VOTER_REQUIREMENTS,

  // General tier (lightweight)
  checkGeneralVoterEligibility,
  GENERAL_VOTER_REQUIREMENTS,

  // Candidates
  checkCandidateEligibility,
  CANDIDATE_REQUIREMENTS,

  // Utility
  calculateAutonomyScore,

  // Legacy exports (backward compatibility)
  checkVoterEligibility,
  VOTER_REQUIREMENTS,
};
