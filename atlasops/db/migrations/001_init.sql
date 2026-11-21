-- AtlasOps initial schema. PostgreSQL 18. Run once on a fresh database.
-- All tenant-scoped tables FORCE RLS. App queries MUST set app.tenant_id in a transaction.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(name) BETWEEN 2 AND 160),
 slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
 currency char(3) NOT NULL DEFAULT 'MZN',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Public read surface is deliberately *only* slug-to-id for login.
CREATE TABLE tenant_directory (
 slug text PRIMARY KEY REFERENCES organizations(slug) ON DELETE CASCADE,
 tenant_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES organizations(id),
 email text NOT NULL, password_hash text NOT NULL, full_name text NOT NULL,
 role text NOT NULL CHECK (role IN ('owner','admin','manager','analyst','agent')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 last_login_at timestamptz, UNIQUE (tenant_id,id)
);
CREATE UNIQUE INDEX users_tenant_email_unique ON users (tenant_id,lower(email));
-- Sessions are opaque hashed bearer credentials; not accessible through tenant business APIs.
CREATE TABLE auth_sessions (
 session_hash char(64) PRIMARY KEY,
 csrf_hash char(64) NOT NULL,
 tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE employees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES organizations(id),
 user_id uuid, full_name text NOT NULL, job_title text, department text,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,user_id),
 FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE sim_cards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES organizations(id),
 employee_id uuid,phone_e164 text NOT NULL, carrier text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','retired')),
 monthly_bundle_mzn numeric(14,2) NOT NULL DEFAULT 0 CHECK(monthly_bundle_mzn>=0),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,phone_e164),
 FOREIGN KEY(tenant_id,employee_id) REFERENCES employees(tenant_id,id)
);
CREATE TABLE devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES organizations(id),
 employee_id uuid NOT NULL,sim_id uuid,device_label text NOT NULL,
 device_token_hash char(64) UNIQUE,os_name text NOT NULL DEFAULT 'android',
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 last_synced_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,employee_id) REFERENCES employees(tenant_id,id),
 FOREIGN KEY(tenant_id,sim_id) REFERENCES sim_cards(tenant_id,id)
);
CREATE TABLE device_enrollments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES organizations(id),
 employee_id uuid NOT NULL,sim_id uuid,device_label text NOT NULL,
 enrollment_hash char(64) NOT NULL UNIQUE,expires_at timestamptz NOT NULL,
 used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,employee_id) REFERENCES employees(tenant_id,id),
 FOREIGN KEY(tenant_id,sim_id) REFERENCES sim_cards(tenant_id,id)
);
CREATE TABLE customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL,email text,phone_e164 text,industry text,notes text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id)
);
CREATE TABLE leads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES organizations(id),
 customer_id uuid,employee_id uuid,title text NOT NULL,
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','qualified','unqualified','converted')),
 source text NOT NULL DEFAULT 'manual',expected_value_mzn numeric(14,2) CHECK(expected_value_mzn>=0),
 next_followup_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
 FOREIGN KEY(tenant_id,employee_id) REFERENCES employees(tenant_id,id)
);
CREATE TABLE deals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES organizations(id),
 lead_id uuid,customer_id uuid,employee_id uuid,title text NOT NULL,
 stage text NOT NULL DEFAULT 'prospecting' CHECK(stage IN ('prospecting','proposal','negotiation','won','lost')),
 amount_mzn numeric(14,2) NOT NULL DEFAULT 0 CHECK(amount_mzn>=0),
 closed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
 FOREIGN KEY(tenant_id,employee_id) REFERENCES employees(tenant_id,id)
);
CREATE TABLE call_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES organizations(id),
 employee_id uuid,device_id uuid,sim_id uuid,customer_id uuid,lead_id uuid,
 external_id text,remote_phone_e164 text NOT NULL, direction text NOT NULL CHECK(direction IN ('outgoing','incoming','missed','rejected')),
 started_at timestamptz NOT NULL,duration_seconds integer NOT NULL CHECK(duration_seconds BETWEEN 0 AND 86400),
 estimated_cost_mzn numeric(14,2) CHECK(estimated_cost_mzn>=0),actual_cost_mzn numeric(14,2) CHECK(actual_cost_mzn>=0),
 evidence text NOT NULL DEFAULT 'employee_reported' CHECK(evidence IN ('employee_reported','device_reported','carrier_statement','carrier_api')),
 outcome text NOT NULL DEFAULT 'unknown' CHECK(outcome IN ('unknown','no_answer','not_interested','interested','followup','meeting_booked')),
 notes text,carrier_reference text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,employee_id) REFERENCES employees(tenant_id,id),
 FOREIGN KEY(tenant_id,device_id) REFERENCES devices(tenant_id,id),
 FOREIGN KEY(tenant_id,sim_id) REFERENCES sim_cards(tenant_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
 FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id)
);
CREATE UNIQUE INDEX call_device_dedupe ON call_events (tenant_id,device_id,external_id) WHERE device_id IS NOT NULL AND external_id IS NOT NULL;
CREATE UNIQUE INDEX call_carrier_dedupe ON call_events(tenant_id,sim_id,carrier_reference) WHERE sim_id IS NOT NULL AND carrier_reference IS NOT NULL;
CREATE INDEX calls_tenant_time ON call_events (tenant_id,started_at DESC);
CREATE INDEX calls_employee_time ON call_events (tenant_id,employee_id,started_at DESC);
CREATE TABLE tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES organizations(id),
 employee_id uuid,lead_id uuid,title text NOT NULL,description text,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','done','cancelled')),
 priority text NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
 due_at timestamptz,completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,employee_id) REFERENCES employees(tenant_id,id),
 FOREIGN KEY(tenant_id,lead_id) REFERENCES leads(tenant_id,id)
);
CREATE TABLE expenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES organizations(id),
 employee_id uuid,category text NOT NULL,description text,amount_mzn numeric(14,2) NOT NULL CHECK(amount_mzn>=0),
 occurred_at timestamptz NOT NULL,source text NOT NULL DEFAULT 'manual',
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,employee_id) REFERENCES employees(tenant_id,id)
);
CREATE TABLE revenue_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES organizations(id),
 deal_id uuid,employee_id uuid,customer_id uuid, description text NOT NULL,
 amount_mzn numeric(14,2) NOT NULL CHECK(amount_mzn>=0),
 status text NOT NULL DEFAULT 'confirmed' CHECK(status IN ('pending','confirmed','reversed')),
 occurred_at timestamptz NOT NULL,source text NOT NULL DEFAULT 'manual',
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,deal_id) REFERENCES deals(tenant_id,id),
 FOREIGN KEY(tenant_id,employee_id) REFERENCES employees(tenant_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);
CREATE TABLE audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES organizations(id),
 actor_id uuid, action text NOT NULL,entity text NOT NULL,entity_id uuid,
 detail jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX audit_tenant_created ON audit_events(tenant_id,created_at DESC);
CREATE TABLE carrier_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES organizations(id),
 carrier text NOT NULL,filename text,imported_by uuid,rows_received integer NOT NULL,
 rows_inserted integer NOT NULL, rows_updated integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,imported_by) REFERENCES users(tenant_id,id)
);
CREATE TABLE analysis_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES organizations(id),
 report_type text NOT NULL,period_start timestamptz NOT NULL,period_end timestamptz NOT NULL,
 engine text NOT NULL,findings jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id)
);
-- Tenant policies even apply to table owner: prevents accidental unscoped queries.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['organizations','users','employees','sim_cards','devices','device_enrollments',
 'customers','leads','deals','call_events','tasks','expenses','revenue_events','audit_events','carrier_imports','analysis_reports']
 LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  IF t='organizations' THEN
   EXECUTE 'CREATE POLICY tenant_policy ON organizations USING (id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)';
  ELSE
   EXECUTE format('CREATE POLICY tenant_policy ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  END IF;
 END LOOP;
END $$;
-- App role is a non-superuser; never grant BYPASSRLS.
