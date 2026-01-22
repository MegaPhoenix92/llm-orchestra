# Encryption at Rest

## Overview
LLM Orchestra Cloud Dashboard supports field-level encryption for sensitive data stored in PostgreSQL.
It uses AES-256-GCM with PBKDF2 (100,000 iterations) and per-value random salt and IV.

### Encryption Formats
The dashboard supports two encryption formats:

**v1 (Legacy):**
```
v1:<salt>:<iv>:<authTag>:<ciphertext>
```

**v2 (Current - supports key rotation):**
```
v2:<keyId>:<salt>:<iv>:<authTag>:<ciphertext>
```

All components are base64 encoded. The master key must be at least 32 characters.
New encryptions use v2 format. The v1 format is supported for backward compatibility during migration.

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

## Key Rotation

Key rotation allows you to re-encrypt all data with a new encryption key. This is important for:
- Regular security hygiene (rotating keys periodically)
- Responding to potential key compromise
- Upgrading from v1 to v2 encryption format

### Rotation Process

```bash
# Generate a new key (min 32 characters)
NEW_KEY=$(openssl rand -base64 32)

# Dry-run to preview changes
orchestra-dashboard encrypt rotate \
  -d $DATABASE_URL \
  --old-key $ENCRYPTION_MASTER_KEY \
  --new-key $NEW_KEY \
  --dry-run

# Apply rotation
orchestra-dashboard encrypt rotate \
  -d $DATABASE_URL \
  --old-key $ENCRYPTION_MASTER_KEY \
  --new-key $NEW_KEY

# Validate all data can be decrypted
orchestra-dashboard encrypt validate \
  -d $DATABASE_URL \
  -k $NEW_KEY

# Check status (should show all v2 format)
orchestra-dashboard encrypt status -d $DATABASE_URL
```

### Rotation Options

| Option | Description |
|--------|-------------|
| `--old-key` | Current encryption key (or OLD_ENCRYPTION_KEY env var) |
| `--new-key` | New encryption key (or NEW_ENCRYPTION_KEY env var) |
| `--old-key-id` | Key ID for old key (default: `primary`) |
| `--new-key-id` | Key ID for new key (default: `rotated`) |
| `--batch-size` | Records per batch (default: 100) |
| `--dry-run` | Preview without changes |
| `-v, --verbose` | Show detailed progress |

### Configuration with Multiple Keys

During transition, configure your application to support both old and new keys:

```ts
const dashboard = await createCloudDashboard({
  database: { connectionString: process.env.DATABASE_URL },
  auth: { jwtSecret: process.env.JWT_SECRET },
  encryption: {
    masterKey: process.env.NEW_ENCRYPTION_KEY,
    keyId: 'rotated',
    previousKeys: [
      { keyId: 'primary', masterKey: process.env.OLD_ENCRYPTION_KEY },
    ],
  },
});
```

After rotation completes and you've verified all data is readable:
1. Update `ENCRYPTION_MASTER_KEY` to the new key
2. Remove the old key from `previousKeys` after a transition period
3. Securely delete the old key

## Operational Guidance
- Store encryption keys in a secrets manager (not in source control).
- Keep encrypted backups and enable disk-level encryption on your database volume.
- Rotate keys periodically (e.g., annually) or after suspected compromise.
- Losing the master key means encrypted data cannot be recovered.
- During key rotation, keep both old and new keys available until migration is complete.
