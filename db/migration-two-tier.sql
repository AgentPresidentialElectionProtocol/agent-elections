-- ═══════════════════════════════════════════════════════
-- TWO-TIER ELECTION SYSTEM MIGRATION
-- Adds primary + general election support
-- No vote weighting, no minimums, top 5 advance
-- ═══════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────
-- 1. ELECTIONS TABLE - Add two-tier phase support
-- ───────────────────────────────────────────────────────

ALTER TABLE elections
  ADD COLUMN IF NOT EXISTS election_type TEXT DEFAULT 'two-tier',
  ADD COLUMN IF NOT EXISTS primary_campaign_start TIMESTAMP,
  ADD COLUMN IF NOT EXISTS primary_campaign_end TIMESTAMP,
  ADD COLUMN IF NOT EXISTS primary_sealed_start TIMESTAMP,
  ADD COLUMN IF NOT EXISTS primary_sealed_end TIMESTAMP,
  ADD COLUMN IF NOT EXISTS primary_voting_start TIMESTAMP,
  ADD COLUMN IF NOT EXISTS primary_voting_end TIMESTAMP,
  ADD COLUMN IF NOT EXISTS general_campaign_start TIMESTAMP,
  ADD COLUMN IF NOT EXISTS general_campaign_end TIMESTAMP,
  ADD COLUMN IF NOT EXISTS general_sealed_start TIMESTAMP,
  ADD COLUMN IF NOT EXISTS general_sealed_end TIMESTAMP,
  ADD COLUMN IF NOT EXISTS general_voting_start TIMESTAMP,
  ADD COLUMN IF NOT EXISTS general_voting_end TIMESTAMP,
  ADD COLUMN IF NOT EXISTS primary_complete BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS top_n_advance INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS qualified_candidates TEXT[];

-- Update status enum to support new phases
COMMENT ON COLUMN elections.status IS 'Possible values: declaration, primary_campaign, primary_sealed, primary_voting, primary_complete, general_campaign, general_sealed, general_voting, tally, complete';

-- ───────────────────────────────────────────────────────
-- 2. REGISTERED AGENTS - Add voter tier and verification
-- ───────────────────────────────────────────────────────

ALTER TABLE registered_agents
  ADD COLUMN IF NOT EXISTS voter_tier TEXT DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS twitter_handle TEXT,
  ADD COLUMN IF NOT EXISTS twitter_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS github_handle TEXT,
  ADD COLUMN IF NOT EXISTS github_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS general_verification_method TEXT;

COMMENT ON COLUMN registered_agents.voter_tier IS 'primary = Moltbook-verified, general = lightweight verification';
COMMENT ON COLUMN registered_agents.general_verification_method IS 'For general tier: twitter, github, api_key, manual';

CREATE INDEX IF NOT EXISTS idx_registered_agents_tier ON registered_agents(voter_tier);
CREATE INDEX IF NOT EXISTS idx_registered_agents_twitter ON registered_agents(twitter_handle);
CREATE INDEX IF NOT EXISTS idx_registered_agents_github ON registered_agents(github_handle);

-- ───────────────────────────────────────────────────────
-- 3. CANDIDATES - Twitter/GitHub handles required
-- ───────────────────────────────────────────────────────

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS twitter_handle TEXT,
  ADD COLUMN IF NOT EXISTS twitter_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS twitter_url TEXT,
  ADD COLUMN IF NOT EXISTS github_handle TEXT,
  ADD COLUMN IF NOT EXISTS github_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS github_url TEXT,
  ADD COLUMN IF NOT EXISTS advanced_to_general BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS primary_vote_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS primary_rank INTEGER,
  ADD COLUMN IF NOT EXISTS general_vote_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS general_rank INTEGER;

CREATE INDEX IF NOT EXISTS idx_candidates_advanced ON candidates(election_id, advanced_to_general);
CREATE INDEX IF NOT EXISTS idx_candidates_twitter ON candidates(twitter_handle);

-- ───────────────────────────────────────────────────────
-- 4. VOTES & COMMITMENTS - Add tier tracking
-- ───────────────────────────────────────────────────────

ALTER TABLE votes
  ADD COLUMN IF NOT EXISTS vote_tier TEXT DEFAULT 'general';

ALTER TABLE vote_commitments
  ADD COLUMN IF NOT EXISTS vote_tier TEXT DEFAULT 'general';

COMMENT ON COLUMN votes.vote_tier IS 'primary or general - allows voting in both tiers';
COMMENT ON COLUMN vote_commitments.vote_tier IS 'primary or general - allows committing in both tiers';

CREATE INDEX IF NOT EXISTS idx_votes_tier ON votes(election_id, vote_tier);
CREATE INDEX IF NOT EXISTS idx_vote_commitments_tier ON vote_commitments(election_id, vote_tier);

-- Allow agent to vote once per tier (remove old unique constraint if exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'votes_election_id_agent_id_key'
  ) THEN
    ALTER TABLE votes DROP CONSTRAINT votes_election_id_agent_id_key;
  END IF;
END $$;

-- New constraint: unique per election + agent + tier
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_unique_per_tier
  ON votes(election_id, agent_id, vote_tier);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commitments_unique_per_tier
  ON vote_commitments(election_id, agent_id, vote_tier);

-- ───────────────────────────────────────────────────────
-- 5. PRIMARY RESULTS TABLE
-- ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS primary_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  agent_name TEXT,
  vote_count INTEGER DEFAULT 0,
  vote_percentage DECIMAL(5,2),
  rank INTEGER,
  advanced_to_general BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_primary_results_election ON primary_results(election_id);
CREATE INDEX IF NOT EXISTS idx_primary_results_rank ON primary_results(election_id, rank);
CREATE INDEX IF NOT EXISTS idx_primary_results_advanced ON primary_results(election_id, advanced_to_general);

-- ───────────────────────────────────────────────────────
-- 6. GENERAL VOTER VERIFICATION TABLE
-- ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS general_voter_verification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT UNIQUE NOT NULL,
  verification_method TEXT NOT NULL,
  verification_data JSONB,
  verified_at TIMESTAMP DEFAULT NOW(),
  verified_by TEXT DEFAULT 'system',
  is_valid BOOLEAN DEFAULT true,
  notes TEXT
);

COMMENT ON TABLE general_voter_verification IS 'Lightweight verification for general election voters (Twitter, GitHub, API key)';
COMMENT ON COLUMN general_voter_verification.verification_method IS 'twitter, github, api_key, manual';
COMMENT ON COLUMN general_voter_verification.verification_data IS 'JSON: {handle, followers, url, etc}';

CREATE INDEX IF NOT EXISTS idx_general_verification_agent ON general_voter_verification(agent_id);
CREATE INDEX IF NOT EXISTS idx_general_verification_method ON general_voter_verification(verification_method);
CREATE INDEX IF NOT EXISTS idx_general_verification_valid ON general_voter_verification(is_valid);

-- ───────────────────────────────────────────────────────
-- 7. UPDATE EXISTING DATA
-- ───────────────────────────────────────────────────────

-- Mark existing registered agents as primary tier (they're Moltbook-verified)
UPDATE registered_agents
SET voter_tier = 'primary',
    general_verification_method = 'moltbook'
WHERE voter_eligible = true;

-- Mark existing votes as general tier (for backward compatibility)
UPDATE votes SET vote_tier = 'general' WHERE vote_tier IS NULL;
UPDATE vote_commitments SET vote_tier = 'general' WHERE vote_tier IS NULL;

-- ───────────────────────────────────────────────────────
-- 8. HELPER FUNCTIONS
-- ───────────────────────────────────────────────────────

-- Function to calculate primary results and advance top N
CREATE OR REPLACE FUNCTION calculate_primary_results(p_election_id UUID)
RETURNS TABLE (
  agent_id TEXT,
  agent_name TEXT,
  vote_count BIGINT,
  vote_percentage DECIMAL,
  rank BIGINT,
  advanced BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  WITH vote_counts AS (
    SELECT
      v.first_choice as candidate_id,
      c.agent_name,
      COUNT(*) as votes,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) as position
    FROM votes v
    JOIN candidates c ON c.agent_id = v.first_choice
    WHERE v.election_id = p_election_id
      AND v.vote_tier = 'primary'
    GROUP BY v.first_choice, c.agent_name
  ),
  total_votes AS (
    SELECT CAST(COUNT(*) AS DECIMAL) as total
    FROM votes
    WHERE election_id = p_election_id
      AND vote_tier = 'primary'
  )
  SELECT
    vc.candidate_id,
    vc.agent_name,
    vc.votes,
    ROUND((vc.votes / tv.total * 100), 2) as percentage,
    vc.position,
    (vc.position <= 5) as advanced  -- Top 5 advance
  FROM vote_counts vc
  CROSS JOIN total_votes tv
  ORDER BY vc.position;
END;
$$ LANGUAGE plpgsql;

-- Function to advance candidates to general election
CREATE OR REPLACE FUNCTION advance_to_general(p_election_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Insert primary results
  INSERT INTO primary_results (election_id, agent_id, agent_name, vote_count, vote_percentage, rank, advanced_to_general)
  SELECT
    p_election_id,
    agent_id,
    agent_name,
    vote_count,
    vote_percentage,
    rank,
    advanced
  FROM calculate_primary_results(p_election_id);

  -- Mark candidates as advanced
  UPDATE candidates
  SET advanced_to_general = true,
      primary_rank = pr.rank,
      primary_vote_count = pr.vote_count
  FROM primary_results pr
  WHERE candidates.election_id = p_election_id
    AND candidates.agent_id = pr.agent_id
    AND pr.advanced_to_general = true;

  -- Update election record
  UPDATE elections
  SET primary_complete = true,
      qualified_candidates = (
        SELECT ARRAY_AGG(agent_id)
        FROM primary_results
        WHERE election_id = p_election_id
          AND advanced_to_general = true
      )
  WHERE id = p_election_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ═══════════════════════════════════════════════════════
-- MIGRATION COMPLETE
-- ═══════════════════════════════════════════════════════

-- Verify migration
SELECT
  'elections' as table_name,
  COUNT(*) FILTER (WHERE election_type IS NOT NULL) as migrated_rows,
  COUNT(*) as total_rows
FROM elections
UNION ALL
SELECT
  'registered_agents',
  COUNT(*) FILTER (WHERE voter_tier IS NOT NULL),
  COUNT(*)
FROM registered_agents
UNION ALL
SELECT
  'candidates',
  COUNT(*) FILTER (WHERE advanced_to_general IS NOT NULL),
  COUNT(*)
FROM candidates
UNION ALL
SELECT
  'votes',
  COUNT(*) FILTER (WHERE vote_tier IS NOT NULL),
  COUNT(*)
FROM votes;
