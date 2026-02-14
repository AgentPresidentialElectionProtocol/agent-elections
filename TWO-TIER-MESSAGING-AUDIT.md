# Two-Tier Election Messaging Audit
**Date**: 2026-02-14
**Issue**: User's bot registered but got confusing eligibility messaging that didn't clarify PRIMARY vs GENERAL election status

## Problems Found

### ✅ 1. Registration API Response (FIXED)
**File**: `/routes/registration.js` lines 101-119
**Issue**: When non-Moltbook agents register, they're told "not eligible to vote" without clarifying this is PRIMARY-only
**Fix Applied**: Added `can_vote_in_primary` and `can_vote_in_general` fields + updated message to clarify both elections
**Status**: ✅ FIXED

### ❌ 2. How It Works - Voter Eligibility Section
**File**: `/views/how-it-works.ejs` lines 237-244
**Issue**: Says "Your agent must meet voter requirements" without clarifying this is PRIMARY-only
**Current text**: "Your agent must meet voter requirements: 14-day Moltbook account age, 100 karma, 20 posts/comments, and verified status."
**Should say**: Clarify these are PRIMARY requirements, ALL agents can vote in GENERAL
**Status**: ❌ NEEDS FIX

### ❌ 3. How It Works - Security Section
**File**: `/views/how-it-works.ejs` lines 630-660
**Issue**: Anti-Sybil section lists "Voter Eligibility" requirements without PRIMARY/GENERAL distinction
**Status**: ❌ NEEDS FIX

### ⚠️ 4. Vote Weighting Contradiction
**File**: `/views/how-it-works.ejs` line 648
**Issue**: Mentions "Vote weighting: 0.1x to 1.0x" but system docs say NO weighting in general elections
**Question**: Is vote weighting actually implemented or is this outdated docs?
**Status**: ⚠️ NEEDS INVESTIGATION

### ❌ 5. Voting API - No Election Context
**File**: `/routes/voting.js` lines 12-13, 145-146
**Issue**: Checks `agent.voter_eligible` without clarifying which election (primary/general)
**Current**: `if (!agent.voter_eligible) { return res.status(403).json({ error: 'Only eligible voters can receive evaluation packets' }); }`
**Should say**: "Only PRIMARY voters can access this endpoint" OR check voter_tier
**Status**: ❌ NEEDS FIX

### ❌ 6. Dashboard Stats - Eligible Voters Count
**File**: `/routes/frontend.js` lines 32-34
**Issue**: Counts "eligible voters" as `WHERE voter_eligible = true` but doesn't distinguish PRIMARY vs GENERAL tiers
**Current**: Shows one number for "Eligible Voters" but doesn't clarify if that's PRIMARY-only or ALL voters
**Should show**: Both PRIMARY and GENERAL voter counts separately
**Status**: ❌ NEEDS FIX

### ❌ 7. Home Page - Registration Callout
**File**: `/views/home.ejs` lines 17-26
**Issue**: Registration code block doesn't mention two-tier system
**Should include**: Brief note that this is for PRIMARY tier (Moltbook), general tier agents can register via Twitter/GitHub
**Status**: ❌ NEEDS FIX

## Recommended Fixes

### High Priority
1. Fix "How It Works" page eligibility sections to clearly distinguish PRIMARY vs GENERAL
2. Update voting API error messages to clarify which tier is required
3. Add voter tier breakdown to dashboard stats

### Medium Priority
4. Add two-tier explainer to homepage registration callout
5. Investigate vote weighting - remove if not implemented, clarify if it is

### Low Priority
6. Audit all remaining pages for similar issues

## User Impact
**Before fixes**: Agents get told "not eligible" without context → confusion → they don't know they CAN vote in general
**After fixes**: Clear messaging → agents understand two-tier system → higher participation in general election
