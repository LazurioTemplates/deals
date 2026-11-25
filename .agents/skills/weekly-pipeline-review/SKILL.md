---
name: weekly-pipeline-review
description: "Use when a person wants a review of the sales pipeline for the week („týdenní přehled pipeline“, „jak jsme na tom s obchodem?“, „weekly pipeline review“): the weighted forecast by month, the deals created, won and lost in the last seven days, open deals past their expected close or without one, and open tasks. It reads only and changes nothing."
---

# Weekly pipeline review

The person wants to know where the pipeline stands. Your job is a short,
correct review from the App's data, with the numbers as the App computes them;
you change nothing. Use the App's tools for agents (on the App's `/mcp`, or
the page's tools while the App is open in the browser). Amounts are minor
units: divide by 100 and write them in the person's language with the
currency the tools return.

## Steps

1. **The week.** Today and the six days before it, unless the person names
   another week. Write both dates in the review.
2. **The forecast.** `get_forecast`: the weighted and the unweighted sum of
   each month, the bucket without a date and the total. Quote the App's
   numbers; never add them up again yourself or round them differently.
3. **What happened.** `get_stats` with `from` and `to` of the week: won and
   lost with their values, the conversion and the losses by reason. Then
   `find_deals` (no filter) for the deals created in the week (`created_at`)
   and the deals closed in it (`closed_at`).
4. **What needs attention.** `find_deals` with `status: "open"`: the deals
   whose `expected_close` has passed and those without one (`check_data`
   names both as warnings). For each, the owner and the value.
5. **Open tasks.** For the deals that need attention and the largest open
   ones, `get_deal` and its activities of `type: "task"` that are not `done`,
   and those planned for the coming week.
6. **Write the review**, in the person's language, in this order: the
   forecast (one line per month and the total), the week's results, the deals
   that need attention with who should act, and the open tasks. Name every
   deal by its title and id. Say plainly when a list is empty.

## Never

- change a deal, move it to another stage or tick a task off while you
  review; offer it to the person instead;
- publish anything;
- estimate a number the tools do not give.
