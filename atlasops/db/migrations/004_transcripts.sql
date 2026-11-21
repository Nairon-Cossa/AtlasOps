-- Only transcripts lawfully obtained through a separately authorized recording pipeline.
CREATE TABLE approved_transcripts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES organizations(id),
 call_id uuid NOT NULL,
 recording_source text NOT NULL,
 consent_basis text NOT NULL,
 consent_recorded_at timestamptz NOT NULL,
 transcript_encrypted text NOT NULL,
 ai_analysis jsonb,
 ai_model text,
 ai_processed_at timestamptz,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,call_id),
 FOREIGN KEY(tenant_id,call_id) REFERENCES call_events(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,created_by) REFERENCES users(tenant_id,id)
);
ALTER TABLE approved_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE approved_transcripts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_policy ON approved_transcripts
 USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
