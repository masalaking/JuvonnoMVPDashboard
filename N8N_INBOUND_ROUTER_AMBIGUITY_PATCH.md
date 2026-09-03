# Inbound Retell Router: Ambiguous Phone Mapping Guard

Apply this patch to the active **Juvonno INBOUND - PRODUCTION MULTICLINIC** workflow before the controlled Retell phone test. It is additive and does not change the direct `Retell -> n8n -> dashboard/Juvonno` architecture.

## Purpose

The `Postgres: Resolve Clinic by Number` query currently ends in `LIMIT 1`. The database's active destination-number uniqueness constraint is the primary invariant, but the routing code must also fail closed if duplicate active rows are ever present.

## Required node changes

### `Postgres: Resolve Clinic by Number`

Keep the existing parameterized `$1` destination-number replacement and all selected fields. Change only the final SQL clause from:

```sql
LIMIT 1;
```

to:

```sql
LIMIT 2;
```

### `Build Retell Inbound Response`

Replace the initial single-row handling with this cardinality guard before constructing `dynamicVariables`:

```javascript
const request = $('Normalize Retell Request').first().json || {};
const rows = $input.all().map(item => item.json || {}).filter(row => Boolean(row.tenant_id));

if (!request.valid_request || rows.length !== 1) {
  const ambiguous = request.valid_request && rows.length > 1;
  return [{ json: {
    call_inbound: {
      dynamic_variables: {
        tenant_resolution_status: ambiguous ? 'ambiguous' : 'not_found',
        client_name: 'the clinic',
        clinic_name: 'the clinic',
        timezone: 'America/Toronto',
      },
      metadata: {
        tenant_resolution_status: ambiguous ? 'ambiguous' : 'not_found',
        routing_error: ambiguous
          ? 'ambiguous_destination_number'
          : (request.valid_request ? 'unknown_destination_number' : 'invalid_inbound_payload'),
        retell_to_number: String(request.to_number || ''),
      },
    },
  } }];
}

const clinic = rows[0];
```

Retain the remainder of the existing response construction after this block. Do not use an incoming Retell agent ID to resolve scope. `override_agent_id` may be returned only from the unique clinic configuration record.

## Verification

1. Validate the workflow after the edit and publish the corrected version.
2. Invoke the phone-router with an unknown number; it must return `tenant_resolution_status: not_found` and must not write data.
3. In a safe fixture or transaction that cannot affect live routing, create two matching active mappings and invoke the router; it must return `tenant_resolution_status: ambiguous` with `routing_error: ambiguous_destination_number`, no `tenant_id`, no `clinic_id`, and no `override_agent_id`.
4. Remove the fixture/rollback the transaction, then invoke the attached Retell phone number in a controlled test. Confirm exactly one clinic scope and that clinic's distinct Retell agent are returned.

