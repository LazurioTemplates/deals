---
name: close-deal
description: "Use when a person says a deal is won or lost („vyhráli jsme…“, „zákazník to odmítl“, „uzavři obchodní případ“, „mark the deal as won / lost“): move it to the won stage with its final value and closing date, or to the lost stage with a reason from the settings, a note and the date, as a draft. The draft is published only on the person's instruction."
---

# Close a deal

A deal ended; the person wants the pipeline to say so. Your job is the move
to the won or the lost stage with everything closing needs, as a draft the
person reviews. Use the App's tools for agents (on the App's `/mcp`, or the
page's tools while the App is open in the browser).

## Steps

1. **Find the deal.** `find_deals` with `status: "open"` and `search` with
   words of its title, its description or its company; when the person names
   the salesperson, add `owner` with their exact name as `get_settings` lists
   it (`search` does not look at the owner). When more than one fits, ask
   which. Then `get_deal` for its current details and its `revision`.
2. **What closing needs**, from the person, never assumed:
   - **won:** the final value (it may differ from the deal's value; ask when
     the person did not say it) and the day it was won;
   - **lost:** the reason, one of the loss reasons `get_settings` lists (ask
     the person to choose when they did not name one), a short note in their
     words when they gave one, and the day it was lost.
   When the person says "today", use today's date.
3. **Move it:** `move_deal_stage` with `id`, `base_revision` from step 1,
   `stage_id` of the won or the lost stage (`get_settings`, `kind` `won` or
   `lost`) and the details above (`value` in
   minor units and `closed_at` for won; `loss_reason_id`, `loss_note` and
   `closed_at` for lost). A refusal with `record_changed` means someone
   changed the deal meanwhile: read it again with `get_deal`, tell the person
   what changed and move it from `current_revision` only when it still holds.
4. **Log it**, when the person told you how it ended: `add_activity` with
   `deal_id` of the deal, `type: "note"`, `at` now with its offset
   (`2026-11-25T14:30:00+01:00`) and `summary` one sentence in the person's
   words.
5. **Check and show the draft:** `check_data` (a won deal needs a value
   above zero; a lost one a reason) and `get_draft`. Tell the person, in their
   language, every record the draft holds (not only yours: a colleague's
   change may wait in it too) with each of its `fields`: the field, its value
   before and its value after, whole, as `get_draft` gives them; never only a
   count of changed fields. Say that it waits in "Koncept a publikování" /
   "Draft & publish". Keep the draft's `revision` you showed.
6. **Publish only what they approved.** When the person says "Publikuj" /
   "Publish" for this draft, `publish_draft` with `expected_revision` the
   `revision` you showed in step 5, never one read afterwards: the App
   publishes only that very draft. A refusal with `draft_changed` means the
   draft changed since they saw it: `get_draft`, show the person every
   change in it again as in step 5 and publish only on their new word, with
   the new `revision`.

## Never

- choose a loss reason, a value or a date for the person;
- publish without the person's explicit instruction for this draft, or a
  revision of the draft other than the one they saw;
- reopen or change another deal on the way.
