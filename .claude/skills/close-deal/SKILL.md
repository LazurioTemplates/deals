---
name: close-deal
description: "Use when a person says a deal is won or lost („vyhráli jsme…“, „zákazník to odmítl“, „uzavři obchodní případ“, „mark the deal as won / lost“): move it to the won stage with its final value, closing date and, when the person says how it is invoiced, its payment plan (else it waits unassigned in the forecast), or to the lost stage with a reason from the settings, a note and the date, as a draft. The draft is published only on the person's instruction."
---

# Close a deal

A deal ended; the person wants the pipeline to say so. Your job is the move
to the won or the lost stage with everything closing needs, as a draft the
person reviews. Use the App's tools for agents (on the App's `/mcp`, or the
page's tools while the App is open in the browser).

## Steps

1. **Find the deal.** `find_deals` with `status: "open"` and `search` with
   words of its title, its description or its company; when the person names
   the salesperson, add `owner_id` with their id from `list_salespeople`
   (`search` does not look at the salesperson). When more than one fits, ask
   which. Then `get_deal` for its current details, its quotes and its
   `revision`.
2. **What closing needs**, from the person, never assumed:
   - **won:** the final value without VAT (it may differ from the deal's
     value; while the deal has a quote, its value is the primary quote's, so
     ask when the person names another one) and the day it was won;
   - **lost:** the reason, one of the loss reasons `get_settings` lists (ask
     the person to choose when they did not name one), a short note in their
     words when they gave one, and the day it was lost.
   When the person says "today", use today's date.
3. **Move it:** `move_deal_stage` with `id`, `base_revision` from step 1,
   `stage_id` of the won or the lost stage (`get_settings`, `kind` `won` or
   `lost`) and the details above (`value` in minor units and `closed_at` for
   won; `loss_reason_id`, `loss_note` and `closed_at` for lost). A refusal
   with `record_changed` means someone changed the deal meanwhile: read it
   again with `get_deal`, tell the person what changed and move it from
   `current_revision` only when it still holds.
4. **How a won deal is invoiced.** The forecast is the payment plans of won
   deals; a won deal without one waits there among the unassigned. Ask the
   person how it is invoiced, unless they said it already:
   - **they say it** (one invoice in December; half now, half on handover in
     February; three equal monthly payments from January): plan it. Either
     pass `payments` to `move_deal_stage` in step 3, each with its `month`
     (`YYYY-MM`), its `amount` in minor units and a `label` in their words,
     adding up exactly to the value; or, after the move, `plan_payments` with
     `deal_id`, the new `revision`, `first_month` and `count` (equal
     payments) or `shares` in basis points (`[5000, 5000]`), and the App
     splits the value so the amounts add up. Set `reverse_charge` only when
     the person says the customer accounts for the VAT;
   - **they do not know yet:** leave it. The deal waits unassigned, the
     weekly review names it, and `plan_payments` plans it later.
   Never make up a month or a split. An invoice issued or paid is recorded
   with `mark_payment` only when the person says it was; it neither issues
   nor sends one.
5. **Log it**, when the person told you how it ended: `add_activity` with
   `deal_id` of the deal, `type: "note"`, `at` now with its offset
   (`2026-11-25T14:30:00+01:00`) and `summary` one sentence in the person's
   words.
6. **Check and show the draft:** `check_data` (a won deal needs a value
   above zero, a planned plan adds up to the value; a lost one a reason) and
   `get_draft`. Tell the person, in their language, every record the draft
   holds (not only yours: a colleague's change may wait in it too) with each
   of its `fields`: the field, its value before and its value after, whole,
   as `get_draft` gives them; never only a count of changed fields. Say
   whether the payments are planned or the deal waits unassigned, and that it
   waits in "Koncept a publikování" / "Draft & publish". Keep the draft's
   `revision` you showed. When `get_draft` says `complete: false`, the draft
   also holds a change outside the fields of Deals' records (its
   `reviewable: false` entries: another file, or a comment or the formatting
   of a record's file) that no tool shows: say which files, and that the
   person reviews them in the data repository and decides on that page
   themselves, publish or discard; `publish_draft` refuses such a draft.
7. **Publish only what they approved.** When the person says "Publikuj" /
   "Publish" for this draft, `publish_draft` with `expected_revision` the
   `revision` you showed in step 6, never one read afterwards: the App
   publishes only that very draft. A refusal with `draft_changed` means the
   draft changed since they saw it: `get_draft`, show the person every
   change in it again as in step 6 and publish only on their new word, with
   the new `revision`. A refusal with `draft_not_reviewable` means the draft
   holds a change the tools cannot show: name its files, leave the decision
   to the person on "Koncept a publikování" / "Draft & publish" and do not
   try again.

## Never

- choose a loss reason, a value, a date, a month of a payment or a split for
  the person;
- mark a payment invoiced or paid that the person did not say was;
- publish without the person's explicit instruction for this draft, or a
  revision of the draft other than the one they saw;
- send an invoice or a message to the customer;
- reopen or change another deal on the way.
