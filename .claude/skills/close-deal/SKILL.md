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

1. **Find the deal.** `find_deals` with words of its title, the company or
   the owner and `status: "open"`; when more than one fits, ask which. Then
   `get_deal` for its current details and its `revision`.
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
   `type: "note"` and one sentence.
5. **Check and show the draft:** `check_data` (a won deal needs a value
   above zero; a lost one a reason) and `get_draft`. Tell the person, in their
   language, what changed and that it waits in "Koncept a publikování" /
   "Draft & publish".
6. **Publish only on their word.** When the person says "Publikuj" /
   "Publish" for this draft, `get_draft` again, and `publish_draft` with its
   `revision`. A refusal with `draft_changed` means the draft changed since
   they saw it: show it again and ask once more.

## Never

- choose a loss reason, a value or a date for the person;
- publish without the person's explicit instruction for this draft;
- reopen or change another deal on the way.
