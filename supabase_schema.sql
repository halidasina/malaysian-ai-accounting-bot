-- Supabase Schema for BizBook AI Accounting Bot

-- Users Table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  tier TEXT DEFAULT 'free',
  plan_expiry TIMESTAMP WITH TIME ZONE,
  setup_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  nudged_7_days BOOLEAN DEFAULT false,
  setup_fee_paid BOOLEAN DEFAULT false
);

-- Transactions Table
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES users(id),
  type TEXT,
  data JSONB,
  date TIMESTAMP WITH TIME ZONE
);
