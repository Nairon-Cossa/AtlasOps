-- ============================================================
-- ATLASOPS
-- Migration 005: Customer Onboarding
-- ============================================================

-- Existing accounts are marked verified only when the
-- column is first introduced. Re-running the migration
-- must not verify newly registered, unverified accounts.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'email_verified_at'
    ) THEN

        ALTER TABLE public.users
        ADD COLUMN email_verified_at TIMESTAMPTZ;

        UPDATE public.users
        SET email_verified_at = COALESCE(
            last_login_at,
            created_at,
            NOW()
        );

    END IF;
END
$$;


-- ============================================================
-- Authentication challenges
-- ============================================================

CREATE TABLE IF NOT EXISTS auth_challenges (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    user_id UUID NOT NULL,

    purpose TEXT NOT NULL
        CHECK (
            purpose IN (
                'verify_email',
                'reset_password',
                'staff_invite'
            )
        ),

    token_hash CHAR(64) NOT NULL UNIQUE,

    expires_at TIMESTAMPTZ NOT NULL,

    used_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (tenant_id, user_id)
        REFERENCES users(tenant_id, id)
        ON DELETE CASCADE
);


-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS auth_challenges_lookup
ON auth_challenges (
    tenant_id,
    user_id,
    purpose,
    created_at DESC
);

CREATE INDEX IF NOT EXISTS auth_challenges_expiry
ON auth_challenges (
    expires_at
);


-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE auth_challenges
ENABLE ROW LEVEL SECURITY;

ALTER TABLE auth_challenges
FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_policy
ON auth_challenges;

CREATE POLICY tenant_policy
ON auth_challenges

USING (
    tenant_id = NULLIF(
        current_setting('app.tenant_id', true),
        ''
    )::UUID
)

WITH CHECK (
    tenant_id = NULLIF(
        current_setting('app.tenant_id', true),
        ''
    )::UUID
);


-- ============================================================
-- Application role privileges
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE
ON auth_challenges
TO atlasops_runtime;