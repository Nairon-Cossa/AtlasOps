-- Secret-derived lookup indexes only. They hold SHA256 hashes, never raw tokens.
CREATE TABLE enrollment_directory (
 enrollment_hash char(64) PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 enrollment_id uuid NOT NULL UNIQUE
);
CREATE TABLE device_directory (
 device_token_hash char(64) PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 device_id uuid NOT NULL UNIQUE
);
