# 06 - HubSpot CRM Ingestion

## Topic Statement

The system reads HubSpot CRM data to provide relationship and deal context for workstream detection, enriching contact information across all data sources.

## Scope

**In-scope:** Reading contacts, companies, and deals from HubSpot API. Normalizing CRM records into activity records. Providing contact enrichment data to other ingestion sources.

**Boundaries:** Creating or modifying CRM records is out of scope for MVP. Workstream assignment is out of scope (see 07-workstream-detection).

## Data Contracts

### HubSpot Contact (input)

- Contact ID
- Email, first name, last name
- Company association
- Deal associations
- Last activity date
- Lifecycle stage
- Owner

### HubSpot Deal (input)

- Deal ID
- Deal name, stage, amount
- Associated contacts
- Associated company
- Close date
- Last activity date

### Normalized Activity Record (output, per deal)

- Source: "hubspot"
- Source ID: deal ID
- Timestamp: deal last activity date
- Title: deal name
- Participants: associated contacts as { email, displayName }
- Preview: "Stage: [stage] - $[amount]"
- Body: null
- Labels: ["crm", deal stage]
- Metadata: { dealId, stage, amount, closeDate, companyName, lifecycleStage }

### Contact Enrichment Record (output, shared with other sources)

- Email (lookup key)
- Display name
- Company name
- Deal names (active deals)
- Lifecycle stage
- VIP flag (true if deal amount exceeds threshold or lifecycle is "customer")
- Relationship score (derived from deal stage and activity recency)

## Behaviors (execution order)

1. **Authentication**: Retrieve HubSpot API key from 1Password. If unavailable, skip HubSpot ingestion entirely with a warning. No error shown to user.

2. **Contact fetch**: Fetch all contacts with email addresses. Build a contact enrichment lookup table keyed by email.

3. **Deal fetch**: Fetch all open deals. Each deal becomes one activity record. Associate contacts and companies with each deal record.

4. **Contact enrichment**: The contact enrichment table is made available to all other ingestion sources. When Gmail, Calendar, or other sources encounter an email address, they can look up CRM context (company, deal, VIP status).

5. **Relationship scoring**: Compute a relationship score (0-1) per contact based on: deal stage progression (higher = further in pipeline), activity recency (higher = more recent), lifecycle stage (customer > opportunity > lead).

6. **Refresh**: Re-fetch CRM data every 15 minutes. CRM data changes less frequently than email or browser state.

## Acceptance Criteria

- Reads contacts and deals from HubSpot API
- Each active deal normalized into an activity record
- Builds contact enrichment lookup table keyed by email
- Computes relationship scores per contact
- Enrichment data available to all other ingestion sources
- Gracefully skips if API key is unavailable
- Refreshes every 15 minutes
