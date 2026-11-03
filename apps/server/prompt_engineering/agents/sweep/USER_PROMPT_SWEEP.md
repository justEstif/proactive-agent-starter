Run one sweep now.

- request_id: {{ request_id }}
- trigger: {{ trigger }}
- started_at: {{ now }}

## Definition Of Done

- `gather_items` called exactly once, its candidates known.
- Every candidate gated with `gate_item` (`present` or `skip`, one-line reason each).
- Every gated-in candidate presented with `present_item` (title plus a two-line summary).
- A closing report naming how many were gated, how many presented, and done.
