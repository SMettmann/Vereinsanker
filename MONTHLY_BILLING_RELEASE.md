# Monthly and yearly membership fees — release checklist

**Status:** implementation branch; do not merge until end-to-end tests pass.

- Monthly rate is entered per month but persisted as an annualized `annual_fee` for legacy compatibility. The new `billing_interval` holds the real payment frequency.
- An annual charge has `contribution_month=0`. Monthly charges have months 1–12. Monthly installments begin in the member's joining month if the joining year matches.
- Important: the live database currently retains the legacy `UNIQUE(member_id, contribution_year)` constraint as a protective rollback. Drop this constraint only when ready to publish monthly billing (the ledger migration in this branch does so). The new 3-column uniqueness is already present.
- The live membership-join-public Edge Function still needs the select/get/submit changes to include `billing_interval` for contribution types and applications. This connector blocked deployment, so public join may otherwise display a monthly rate as an annual one. Do not release the frontend before updating it.
- Run regression tests for monthly new members, partial-year entry, annual members, editing monthly fees, changing plans after payments or SEPA export, SEPA cutoff selection, and digital joining.
- Run browser checks and confirm STRATO's deployment procedure separately.

This branch is **not yet a verified production release**.