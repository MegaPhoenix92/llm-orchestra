# Encryption at Rest

## Overview
LLM Orchestra Cloud Dashboard supports field-level encryption for sensitive data stored in PostgreSQL.
It uses AES-256-GCM with PBKDF2 (100,000 iterations) and per-value random salt and IV.
Encrypted values are stored as:

```
v1:<salt>:<iv>:<authTag>:<ciphertext>
```

All components are base64 encoded. The master key must be at least 32 characters.

## Protected Data
The following fields are encrypted when encryption is enabled:
- users: email, name, ssoId
- invitations: email, token
- audit_logs: ip, userAgent, metadata (JSON)

To support lookups, users.email_hash stores a SHA-256 hash of the lowercased email.
This hash is deterministic and not reversible; treat it as sensitive metadata.

## Not Protected
Encryption at rest does not protect:
- Data in transit (use TLS)
- Data in application memory or logs
- API keys (stored as secure hashes, not encrypted)
- Trace/span attributes (unless you add encryption for those fields)

## Threat Model and Limits
Encryption at rest helps if a database snapshot or disk is exfiltrated without the master key.
It does not protect against:
- A compromised application host with access to the master key
- Malicious SQL queries executed by an attacker with DB credentials
- Keys leaked through misconfigured secrets management

Use least-privilege database credentials, separate secrets storage, and audit access.

## Configuration (Cloud)
Enable encryption by providing a master key to the cloud dashboard:

```ts
import { createCloudDashboard } from 'llm-orchestra-dashboard';

const dashboard = await createCloudDashboard({
  database: { connectionString: process.env.DATABASE_URL },
  auth: { jwtSecret: process.env.JWT_SECRET },
  encryption: { masterKey: process.env.ENCRYPTION_MASTER_KEY },
});
```

## Migration for Existing Deployments
Use the encryption CLI to backfill existing data:

```bash
# Check status
orchestra-dashboard encrypt status -d $DATABASE_URL

# Dry-run migration
orchestra-dashboard encrypt migrate -d $DATABASE_URL -k $ENCRYPTION_MASTER_KEY --dry-run

# Apply migration
orchestra-dashboard encrypt migrate -d $DATABASE_URL -k $ENCRYPTION_MASTER_KEY

# Validate all encrypted data
orchestra-dashboard encrypt validate -d $DATABASE_URL -k $ENCRYPTION_MASTER_KEY
```

## Operational Guidance
- Store the master key in a secrets manager (not in source control).
- Keep encrypted backups and enable disk-level encryption on your database volume.
- If you rotate the key, plan a re-encryption job. Key rotation is not built-in yet.
- Losing the master key means encrypted data cannot be recovered.
