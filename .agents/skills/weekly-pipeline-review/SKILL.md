---
name: weekly-pipeline-review
description: "Use when a person wants a review of the sales pipeline for the week („týdenní přehled pipeline“, „jak jsme na tom s obchodem?“, „weekly pipeline review“): the forecast as the payment plans of won deals (what is invoiced, paid, overdue and still unassigned), the week's results against the week before, open deals past their expected close or without one, and open tasks. It reads only and changes nothing."
---

# Weekly pipeline review

The person wants to know where the pipeline stands. Your job is a short,
correct review from the App's data, with the numbers as the App computes them;
you change nothing. Use the App's tools for agents (on the App's `/mcp`, or
the page's tools while the App is open in the browser). Amounts are minor
units without VAT: divide by 100 and write them in the person's language with
the currency the tools return.

The forecast of Deals is what the Organization invoices: the payments of the
payment plans of won deals and the manual rows of the forecast. Open deals are
not in it, whatever their probability; they are the pipeline.

## Steps

1. **The week.** Today and the six days before it, unless the person names
   another week. Write both dates in the review. When the person asks about
   one salesperson, take their id from `list_salespeople` and pass it as
   `owner_id` below.
2. **The forecast.** `get_forecast` (this year; `year` for another one):
   the total of the year with what is invoiced, paid and overdue, and the
   months from this one on with their `forecast`. Quote the App's numbers;
   never add them up again yourself or round them differently.
3. **What is overdue.** The forecast's `rows` with `state: "overdue"`: an
   invoice issued, unpaid and past its due date. For each, the deal or the
   manual row by its title, the amount, the due date (`dueOn`) and the
   salesperson (`ownerId`, by name from `list_salespeople`).
4. **What is unassigned.** The forecast's `unassigned`: won deals whose
   payments nobody planned yet, so the forecast does not count them. For
   each, the title, the value, the day it was won and the salesperson.
   Planning them is the skill `close-deal` (step 4), never part of this
   review.
5. **What happened.** `get_stats` with `from` and `to` of the week: won and
   lost with their values, the new deals and quotes, the conversion and the
   losses by reason, each against `previous` (the week before, as the App
   computes it). Name the deals behind the numbers (`ids`) by their titles
   with `find_deals`.
6. **What needs attention.** `find_deals` with `status: "open"`: the deals
   whose `expected_close` has passed and those without one (`check_data`
   names both as warnings), and open deals of a salesperson who left
   (`salesperson_inactive`). For each, the salesperson and the value.
7. **Open tasks.** For the deals that need attention and the largest open
   ones, `get_deal` and its activities of `type: "task"` that are not `done`,
   and those planned for the coming week.
8. **Write the review**, in the person's language, in this order: the
   forecast (the year's total, invoiced, paid, overdue, and one line per
   coming month), what is overdue, what is unassigned, the week's results
   against the week before, the deals that need attention with who should
   act, and the open tasks. Name every deal by its title and id. Say plainly
   when a list is empty.

## Never

- change a deal, plan its payments, mark a payment, move a deal to another
  stage or tick a task off while you review; offer it to the person instead;
- count open deals into the forecast, or weight them by their probability;
- publish anything, or write to a customer about an overdue invoice: that is
  the person's step;
- estimate a number the tools do not give.
