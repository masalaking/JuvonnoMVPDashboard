# Retell Conductor follow-up: retain n8n as the Retell middleware

The intended deployed architecture is **Retell → n8n → dashboard/Juvonno**. No separate backend origin is required for Retell configuration.

## Apply now

Apply the non-routing hardening from `RETELL_CONDUCTOR_AGENT_CHANGE_REQUEST.md`:

- remove the seven static clinic/routing default dynamic variables;
- add the complete safe response-variable mappings to all seven tools;
- set `get_many_slots` to 120,000 ms;
- add the tool-failure/ambiguous-match rule to the global prompt;
- set data storage to `everything_except_pii` and configure the stated PII categories;
- remove coffee-shop ambience;
- set end-of-call silence to 60,000 ms;
- retain AI disclosure;
- retain `args_at_root: false` / full call context;

Create a separate agent for each clinic. Do not reuse an agent ID between clinics. This does not replace n8n's destination-phone scope lookup; it prevents operational/configuration cross-talk between clinics.

## Required n8n URLs

Keep these URLs in Retell:

| Agent feature | Required URL |
| --- | --- |
| Every receptionist custom function | `https://n8n.getnapsolutions.com/webhook/juvonno-receptionist` |
| Agent-level call-analysis webhook | `https://n8n.getnapsolutions.com/webhook/juvonno` |
| Assigned phone-number inbound webhook | `https://n8n.getnapsolutions.com/webhook/retell-inbound-clinic-router` |

Before publishing, verify the three corresponding n8n workflows are active and run a safe non-mutating Retell test for the mapped phone number.
