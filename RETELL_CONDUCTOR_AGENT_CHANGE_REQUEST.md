# Retell Conductor change request — Juvonno MVP Voice Agent newest

## Objective

Prepare this **unpublished** voice agent for the existing RivaCare/Juvonno **Retell → n8n → dashboard/Juvonno** architecture. Preserve the current Conversation Flow and its booking, lookup, cancellation, rescheduling, availability, and human-transfer behavior. Make only the privacy and reliability changes below.

Do **not** publish the agent, assign a phone number, or place a live call as part of this change.

## One dedicated agent per clinic

Create and maintain **one distinct unpublished Retell agent per clinic**. Do not reuse or share a Retell agent ID across clinics, even when two clinics currently have similar services or scripts. Clone this hardened baseline for each clinic, then keep that clinic's own approved voice, clinic-facing wording, transfer policy, and knowledge configuration in its own agent.

This is an operational ownership rule, not a scope-authority mechanism: n8n derives tenant/clinic scope from the destination phone after a unique phone mapping exists. Never route or authorize from the Retell agent ID, and never pass the agent ID as a tenant/clinic field.

Record the resulting distinct Retell agent IDs in the appropriate secure per-clinic n8n/dashboard configuration only after the agents exist; do not place those IDs in prompts, default dynamic variables, tool schemas, or public metadata.

## Retain the validated n8n routing

The exported agent currently sends all custom functions directly to:

`https://n8n.getnapsolutions.com/webhook/juvonno-receptionist`

and its agent-level webhook directly to:

`https://n8n.getnapsolutions.com/webhook/juvonno`

These are the correct public n8n middleware targets for this deployment. Do **not** replace them with a separate backend-origin URL.

Retain these Retell-facing URLs:

| Agent feature | Replace with |
| --- | --- |
| Every receptionist custom function: `get_clinic_config`, `check_availability`, `get_many_slots`, `book_appointment`, `lookup_appointment`, `cancel_appointment`, `reschedule_appointment` | `https://n8n.getnapsolutions.com/webhook/juvonno-receptionist` |
| Agent-level call-analysis webhook | `https://n8n.getnapsolutions.com/webhook/juvonno` |
| Phone-number inbound webhook | `https://n8n.getnapsolutions.com/webhook/retell-inbound-clinic-router` |

Do not add secrets or API keys to the agent. The n8n inbound router resolves the clinic from the destination phone, returns the clinic-specific dynamic variables, and may return that clinic's dedicated `override_agent_id`. The receptionist workflow then uses that n8n-supplied scope.

For all custom functions, ensure Retell sends the **full event/call context**. In particular, leave **Payload: args only** disabled. n8n needs the dynamic clinic context established by the phone inbound router; tool arguments alone are insufficient.

## Remove unsafe static dynamic variables

Remove these production default dynamic-variable values from the agent export:

- `tenant_id`
- `client_id`
- `clinic_id`
- `tenant_resolution_status`
- `clinic_name`
- `timezone`
- `transfer_phone_number`

Do not replace them with another clinic’s values. In production, n8n injects tenant and clinic scope only after it resolves a unique, active clinic from the destination phone. The current `clinic_001` / `resolved` defaults are acceptable only as an isolated local fixture, never as agent defaults.

The phone inbound webhook must be assigned and mapped in n8n before publishing an agent. Its existing **Routing Validation** and **Routing Unavailable** nodes are the correct fail-closed behavior for an unresolved clinic.

## Custom-function contract updates

Keep strict tool calling enabled. Keep JSON arguments nested rather than flattening them. Do not add `tenant_id`, `client_id`, `clinic_id`, branch credentials, staff numbers, or Juvonno credentials to any tool schema or prompt.

For every tool, map these response fields when the backend returns them so the flow can safely transfer rather than hallucinate a success:

- `success`
- `response`
- `transfer_to_human`
- `capability_disabled`
- `needs_phone_number`
- `missing_fields`
- `error_code`

Apply this especially to `book_appointment`, `lookup_appointment`, `cancel_appointment`, and `reschedule_appointment`, where the export currently exposes only a subset of failure/transfer fields.

Set `get_many_slots` to a **120,000 ms** timeout to match the other Juvonno-backed functions. The current 20,000 ms timeout is too short for a multi-slot availability lookup and can create avoidable caller-facing failures.

Keep tool output as structured variables for the agent to interpret. Do not let raw tool payloads, error objects, IDs, provider messages, headers, or configuration data be read aloud. If the Conductor UI has a setting that automatically speaks raw function responses, turn it off; the flow should speak only its reviewed caller-facing `response` text.

## Prompt and flow changes to preserve

Keep these existing strengths:

- one question at a time;
- clinic config as the source of truth for services, practitioners, hours, and enabled capabilities;
- exact availability before booking;
- no claim that a slot is held before booking succeeds;
- explicit confirmation before cancellation;
- emergency instruction to call 911;
- human transfer for failures, disabled capabilities, and out-of-scope requests;
- date-of-birth recovery only when existing-patient matching is ambiguous;
- strict new-patient data collection before creating a chart.

Add this short rule to the global prompt:

> Treat every tool failure, missing scope, unavailable backend, disabled capability, or ambiguous patient match as unconfirmed. Never claim an appointment was found, changed, cancelled, or booked unless that tool returned `success: true`. Offer a human transfer using only the reviewed caller-facing response.

Do not change the existing no-hallucination rules for service, practitioner, hours, availability, duration, or patient identity.

## Privacy and call-experience changes

1. Change data retention from `everything` to the most restrictive Retell retention setting that supports the approved demo and required audit trail. Disable unnecessary recording/transcript retention; enable redaction for patient-identifying content wherever supported. Do not store more protected health information than required.
2. Replace `coffee-shop` ambient sound with no ambient sound. A clinical receptionist should not simulate a public setting or introduce avoidable distraction.
3. Reduce end-of-call silence from 119 seconds to **45–60 seconds**. Keep interruption handling enabled.
4. Keep AI disclosure enabled.
5. Keep the agent unpublished and with no assigned phone number until the backend environment, unique phone mapping, and signed test are complete.

## Acceptance checklist for Conductor

- [ ] This clinic has its own distinct Retell agent; no agent ID is shared with another clinic.
- [ ] All receptionist tools use `https://n8n.getnapsolutions.com/webhook/juvonno-receptionist`.
- [ ] The post-call webhook uses `https://n8n.getnapsolutions.com/webhook/juvonno`.
- [ ] The assigned phone's inbound webhook uses `https://n8n.getnapsolutions.com/webhook/retell-inbound-clinic-router`.
- [ ] Full call context is retained; **Payload: args only** is disabled.
- [ ] No default tenant, client, clinic, routing-status, clinic-name, timezone, or transfer-number fixture remains.
- [ ] Tool failures expose transfer/error fields and cannot be presented as success.
- [ ] `get_many_slots` timeout is 120 seconds.
- [ ] Privacy retention is minimized and coffee-shop ambience is disabled.
- [ ] Conversation Flow v11 booking and transfer logic remains intact.

## Do not do

- Do not route by Retell agent ID; agent IDs may be shared across clinics.
- Do not add secrets, database credentials, Juvonno keys, tenant IDs, or clinic IDs to agent instructions, tool arguments, metadata, or default dynamic variables.
- Do not weaken the routing-validation fail-closed branch.
