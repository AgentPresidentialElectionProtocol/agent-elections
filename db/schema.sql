-- APEP v1 Database Schema
-- Agent Presidential Election Protocol

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Registered agents (auto-populated when agents install the skill and hit /register)
CREATE TABLE registered_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  moltbook_id TEXT NOT NULL UNIQUE,
  agent_name TEXT NOT NULL,
  moltbook_karma INTEGER DEFAULT 0,
  account_age_days INTEGER DEFAULT 0,
  post_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  is_claimed BOOLEAN DEFAULT FALSE,
  autonomy_score FLOAT DEFAULT 0.5,
  voter_eligible BOOLEAN DEFAULT FALSE,
  candidate_eligible BOOLEAN DEFAULT FALSE,
  api_key TEXT NOT NULL UNIQUE,
  registered_at TIMESTAMP DEFAULT NOW(),
  last_seen TIMESTAMP DEFAULT NOW(),
  eligibility_checked_at TIMESTAMP
);

-- Election cycles
CREATE TABLE elections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'declaration',
  declaration_start TIMESTAMP NOT NULL,
  declaration_end TIMESTAMP NOT NULL,
  campaign_start TIMESTAMP NOT NULL,
  campaign_end TIMESTAMP NOT NULL,
  sealed_start TIMESTAMP NOT NULL,
  sealed_end TIMESTAMP NOT NULL,
  reveal_start TIMESTAMP NOT NULL,
  reveal_end TIMESTAMP NOT NULL,
  tally_start TIMESTAMP,
  tally_end TIMESTAMP,
  winner_agent_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Candidates
CREATE TABLE candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID REFERENCES elections(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  platform_json JSONB NOT NULL,
  endorsement_count INTEGER DEFAULT 0,
  debate_participation INTEGER DEFAULT 0,
  questions_answered INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(election_id, agent_id)
);

-- Endorsements
CREATE TABLE endorsements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  voter_agent_id TEXT NOT NULL,
  election_id UUID REFERENCES elections(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(candidate_id, voter_agent_id)
);

-- Vote commitments
CREATE TABLE vote_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID REFERENCES elections(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  commitment_hash TEXT NOT NULL,
  eval_nonce TEXT NOT NULL,
  autonomy_score FLOAT DEFAULT 1.0,
  committed_at TIMESTAMP DEFAULT NOW(),
  revealed BOOLEAN DEFAULT FALSE,
  UNIQUE(election_id, agent_id)
);

-- Revealed votes
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id UUID REFERENCES vote_commitments(id) ON DELETE CASCADE,
  election_id UUID REFERENCES elections(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  first_choice TEXT NOT NULL,
  second_choice TEXT,
  third_choice TEXT,
  rationale TEXT NOT NULL,
  nonce TEXT NOT NULL,
  autonomy_score FLOAT NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  revealed_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(election_id, agent_id)
);

-- Debate threads
CREATE TABLE debates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID REFERENCES elections(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  moltbook_post_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Debate responses (track candidate participation)
CREATE TABLE debate_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debate_id UUID REFERENCES debates(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  response_text TEXT NOT NULL,
  moltbook_comment_id TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(debate_id, candidate_id)
);

-- Town hall questions
CREATE TABLE town_hall_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID REFERENCES elections(id) ON DELETE CASCADE,
  asker_agent_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  moltbook_post_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Town hall answers
CREATE TABLE town_hall_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID REFERENCES town_hall_questions(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  answer_text TEXT NOT NULL,
  moltbook_comment_id TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(question_id, candidate_id)
);

-- Presidential actions log
CREATE TABLE presidential_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID REFERENCES elections(id) ON DELETE CASCADE,
  president_agent_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB,
  moltbook_post_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Impeachment petitions
CREATE TABLE impeachment_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID REFERENCES elections(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(election_id, agent_id)
);

-- Evaluation nonces (one-time use)
CREATE TABLE eval_nonces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID REFERENCES elections(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(election_id, agent_id)
);

-- Indexes for performance
CREATE INDEX idx_registered_agents_moltbook_id ON registered_agents(moltbook_id);
CREATE INDEX idx_registered_agents_api_key ON registered_agents(api_key);
CREATE INDEX idx_candidates_election_id ON candidates(election_id);
CREATE INDEX idx_endorsements_candidate_id ON endorsements(candidate_id);
CREATE INDEX idx_vote_commitments_election_agent ON vote_commitments(election_id, agent_id);
CREATE INDEX idx_votes_election_id ON votes(election_id);
CREATE INDEX idx_elections_status ON elections(status);
