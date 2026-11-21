-- AtlasOps 006
-- Commercial onboarding, subscriptions, billing and legal acceptance.
-- Apply once to an existing PostgreSQL database.
-- Never delete existing Docker volumes to apply migrations.

BEGIN;

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  tenant_id uuid PRIMARY KEY
    REFERENCES organizations(id) ON DELETE CASCADE,

  plan_code text NOT NULL DEFAULT 'starter'
    CHECK (plan_code IN ('starter', 'growth', 'scale')),

  status text NOT NULL DEFAULT 'trialing'
    CHECK (status IN (
      'trialing',
      'active',
      'past_due',
      'cancelled'
    )),

  trial_ends_at timestamptz NOT NULL
    DEFAULT now() + interval '14 days',

  current_period_end timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_company_profiles (
  tenant_id uuid PRIMARY KEY
    REFERENCES organizations(id) ON DELETE CASCADE,

  legal_name text NOT NULL DEFAULT '',
  nuit text NOT NULL DEFAULT '',
  billing_email text NOT NULL DEFAULT '',
  billing_address text NOT NULL DEFAULT '',

  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  tenant_id uuid NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,

  user_id uuid NOT NULL,

  terms_version text NOT NULL,
  privacy_version text NOT NULL,

  accepted_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, id),

  FOREIGN KEY (tenant_id, user_id)
    REFERENCES users(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS billing_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  tenant_id uuid NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,

  requested_by uuid NOT NULL,

  plan_code text NOT NULL
    CHECK (plan_code IN ('starter', 'growth', 'scale')),

  amount_mzn numeric(14, 2) NOT NULL
    CHECK (amount_mzn > 0),

  currency char(3) NOT NULL DEFAULT 'MZN'
    CHECK (currency = 'MZN'),

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'paid',
      'failed',
      'cancelled'
    )),

  provider text NOT NULL DEFAULT 'epay',

  provider_id text UNIQUE,
  checkout_url text,

  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, id),

  FOREIGN KEY (tenant_id, requested_by)
    REFERENCES users(tenant_id, id)
);

-- Internal lookup for payment webhooks.
-- This table intentionally contains no passwords,
-- payment amounts, customer emails or card details.

CREATE TABLE IF NOT EXISTS billing_order_directory (
  order_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  provider_id text UNIQUE
);

GRANT SELECT, INSERT, UPDATE
ON billing_order_directory
TO atlasops_runtime;

CREATE INDEX IF NOT EXISTS billing_orders_recent
ON billing_orders (tenant_id, created_at DESC);

-- Tenant-level row security

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'billing_subscriptions',
    'billing_company_profiles',
    'billing_legal_acceptances',
    'billing_orders'
  ] LOOP

    EXECUTE format(
      'ALTER TABLE %I ENABLE ROW LEVEL SECURITY',
      t
    );

    EXECUTE format(
      'ALTER TABLE %I FORCE ROW LEVEL SECURITY',
      t
    );

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
        AND policyname = 'billing_tenant_policy'
    ) THEN

      EXECUTE format(
        'CREATE POLICY billing_tenant_policy ON %I
         USING (
           tenant_id = NULLIF(
             current_setting(''app.tenant_id'', true),
             ''''
           )::uuid
         )
         WITH CHECK (
           tenant_id = NULLIF(
             current_setting(''app.tenant_id'', true),
             ''''
           )::uuid
         )',
        t
      );

    END IF;

  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  billing_subscriptions,
  billing_company_profiles,
  billing_legal_acceptances,
  billing_orders
TO atlasops_runtime;

-- Existing workspaces preserve their data.
-- They receive an initial evaluation period.

INSERT INTO billing_subscriptions (
  tenant_id,
  plan_code,
  status,
  trial_ends_at
)
SELECT
  id,
  'starter',
  'trialing',
  now() + interval '14 days'
FROM organizations
ON CONFLICT (tenant_id) DO NOTHING;

COMMIT;