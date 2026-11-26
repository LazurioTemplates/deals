# The data of Deals

Deals keeps its records in the Organization's data repository
`<Organization>/deals-data`, branch `v3`, checked out as `db/` at the Module
root and read and written only through [repository-db](https://github.com/Lazurio/repository-db).

## Collections

Every record is one YAML document `data/<collection>/<id>.yaml` in the
envelope of repository-db:

```yaml
id: D-2026-0011
record:
  closedAt: 2026-10-20
  companyId: C-0005
  contactIds:
    - P-0008
  createdAt: 2026-08-10
  dealTypeId: delivery
  id: D-2026-0011
  ownerId: S-0001
  paymentPlan:
    payments:
      - amount: 15228000
        dueOn: 2026-11-04
        id: p1
        invoicedOn: 2026-10-21
        label: Záloha
        month: 2026-10
      - amount: 15228000
        id: p2
        month: 2026-12
      - amount: 20304000
        id: p3
        label: Doplatek
        month: 2027-02
    status: planned
  stageId: won
  title: Kanceláře na stavbě
  value: 50760000
schemaVersion: deals.deal.v2
```

| Collection | Id | `schemaVersion` | Holds |
| --- | --- | --- | --- |
| `settings` | `settings` | `deals.settings.v2` | the Organization's choices (below) |
| `salespeople` | `S-0001` | `deals.salesperson.v1` | name, role, e-mail, phone, `active`, a note |
| `companies` | `C-0001` | `deals.company.v1` | name, IČO (eight digits), DIČ, address (`street`, `city`, `postalCode`, `country`), website, its own days to pay an invoice (`paymentDueDays`), a note |
| `contacts` | `P-0001` | `deals.contact.v1` | name, e-mail, phone, role, the company (`companyId`), a note |
| `deals` | `D-<year>-<4 digits>` | `deals.deal.v2` | the deal (below) |
| `activities` | `A-<year>-<5 digits>` | `deals.activity.v1` | the deal, the type (call, meeting, email, note, task), when (`at`, a date and time with its offset), a summary, contacts, and for a task whether it is done |
| `pricebook` | `I-0001` | `deals.pricebook-item.v1` | name, the Organization's `code`, a description, `unit`, `unitPrice` without VAT, the quote section a line from it goes to (`sectionId`), `active` |
| `quotes` | `Q-<year>-<4 digits>-r<n>` | `deals.quote.v1` | one revision of a quote (below) |
| `forecastEntries` | `F-<year>-<4 digits>` | `deals.forecast-entry.v1` | a manual row of the forecast (below) |
| `forecastNotes` | the month, `2026-12` | `deals.forecast-note.v1` | a note on one month of the forecast (`text`) |

**The settings** hold the currency (ISO 4217, CZK by default); the stages of
the pipeline in order (`id`, `label`, `kind` open, won or lost, `probability`
0–100); the loss reasons; the deal types (`dealTypes`, „Typ zakázky“,
optional); the billing entities that issue quotes and invoices
(`billingEntities`: `id`, `name`, IČO, DIČ, address, e-mail, phone, website,
bank account; the first is the default); what a new quote starts with
(`quotes`: `vatRate` in basis points, `validityDays`, the `sections` of its
lines, the `units` a line offers, the texts of its `terms` — the note on VAT,
payments and deposits, scope — and the version and address of the
Organization's commercial terms, `termsVersion` and `termsUrl`); the days from
an invoice to its due date (`paymentDueDays`, unless a company has its own);
and whether the App looks companies up in ARES (`aresLookup`). Since 0.2.0
the salespeople are a collection of their own, not a list in the settings.

**A salesperson** is a record so that a deal names them by id and a name
changes in one place. Somebody who left stays with `active: false`: their
deals keep their name, a new deal offers only the active ones.

**A deal** has a title, its company, contacts, salesperson (`ownerId`), stage,
deal type (`dealTypeId`) and billing entity (`billingEntityId`, else the
first), its value without VAT, its own probability (else the stage's), the
day it was created (`createdAt`), the expected and the actual closing date,
the loss reason and a note on the loss, the quote its value follows
(`primaryQuoteId`, optional), its payment plan (`paymentPlan`, only when won)
and a description.

**A quote** is one revision of an offer. The quote number `Q-2026-0001` names
the offer and every revision is a record of its own (`version` 2, id
`Q-2026-0001-r2`), so a revision sent to a customer never changes when the
next one is written. A revision has its deal, `status` (`draft`, `active` —
sent —, `approved`, `superseded` by a later revision, `cancelled`), title,
the day it was written (`issuedOn`) and how long it holds (`validUntil`), the
currency, the billing entity offering it, the customer as a copy of the
company when it was written (`customer`: `companyId`, name, IČO, DIČ,
address), a contact, one VAT rate (`vatRate`, basis points) and whether the
customer accounts for the VAT (`reverseCharge`), its `sections` and `lines`,
a reserve for changes outside the price (`changeReserve`), the texts of its
terms, the record of the commercial terms (below), a note, and the days it
was sent (`sentOn`) and approved (`approvedOn`). A line has an id, a section,
the price list item it came from (`pricebookItemId`, optional), a name and a
description, a `quantity` (up to three decimals), a `unit`, a `unitPrice`
without VAT and a `discount` in basis points. A line copies its item, so a
later change of the price list never changes a quote already written.

**The record of the commercial terms** (`commercialTerms` of a quote) says
which terms a quote offered and how the customer accepted them, never the
legal text: whether the customer is a business, a consumer or both
(`customerScope`: `b2b`, `b2c`, `mixed`, `unresolved`), the version and the
address of the terms, the day they were accepted and the evidence
(`evidence`: a signed quote, an e-mail, a document path), and per area
(`payments`, `deposit`, `ownership`, `warranty`, `liability`, `service`,
`support`, `sla`, `changes`) whether the standard terms apply (`standard`,
`custom`, `customer`, `not-applicable`, `excluded`, `pending`).

**A manual forecast row** is an income expected in a month that no won deal
plans, such as a recurring fee or a contract signed outside the pipeline: its
`month`, title, amount without VAT, and optionally the company, salesperson,
deal type, billing entity and deal it belongs to, reverse charge, and the
state of a payment (`invoicedOn`, `dueOn`, `paidOn`).

The schemas are Zod in `app/v3/src/domain/` and nothing else; `bun run
schema:export` writes their JSON Schemas into `templates/data-repo/schemas/`.
A date is `YYYY-MM-DD` and must exist in the calendar; a month is `YYYY-MM`.

Every record may carry three audit fields, which are not business data:
`revision`, a new random value of every write; `updatedAt`, when it was
written (UTC with milliseconds, `2026-11-24T09:30:00.000Z`); and `updatedBy`,
the subject of the person the App wrote it for, left out when nobody is
known. The App writes them on every save, replaces any a caller sends and
leaves them out of what it shows; the starts in `app/v3/seed/` have none.
Whoever changes a record's file directly, past the App, writes a new
`revision` (`crypto.randomUUID()`) and `updatedAt` too (Module Standard, "One
data port"): repository-db v3.4.0 refuses to merge a colleague's change into a
record whose `revision` one side kept. The App still sees a direct change that
kept the old `revision`, because its revision of a record covers the whole
file. A save from a stale revision is refused with `record_changed` and the
revision stored now (`current_revision` in the API and the tools).

A save may write records of several collections at once (a quote and the
deal whose value follows it, a new salesperson and the deal handed to them):
every revision is checked and the rules are judged on the result before
anything is written, so it is written whole or not at all. A record is
removed as a draft too, from the revision it was read at, and the removal is
refused while another record names it (a salesperson of a deal, a company of
a contact).

## Money

- **Amounts** are whole minor units of the currency, haléře for CZK, without
  VAT unless a total says otherwise: `21999990` is 219 999,90 Kč.
- **Shares** are basis points, 0–10 000: a VAT rate of `2100` is 21 %, a
  discount of `1000` is 10 %, a payment's share of `3000` is 30 %. **A
  probability** is a whole percent, 0–100.
- **A quote line** is unit price × quantity less its discount, counted in
  thousandths of the quantity and rounded half up (never to the even
  neighbour) once, to a whole haléř. A section and the subtotal are sums of
  the rounded lines. **The VAT** is the subtotal × the quote's rate, rounded
  half up once; with reverse charge it is 0. The total is the subtotal and
  the VAT. The reserve for changes is added only to the planning figure,
  never to the total.
- **A deal's value follows its primary quote** while that quote has a line:
  the quote `primaryQuoteId` names, else the deal's approved quote, else its
  newest revision that is a draft, active or approved, else its newest quote.
  The App saves the quote and the deal's new value in one write; a deal
  whose value differs from its primary quote's subtotal is a warning.
- **A payment plan split by shares** gives every payment but the last its
  share of the value rounded half up; the last takes what is left, so the
  payments always sum to the value.
- Every product and division goes through BigInt
  (`app/v3/src/domain/money.ts`); no amount is ever a floating-point crown.
  `tests/money.test.ts`, `tests/quote.test.ts` and
  `tests/payment-plan.test.ts` hold the cases.

## The payment plan

The payment plan of a won deal is how its value is invoiced, month by month.
It is `planned`, with 1 to 12 payments whose amounts sum exactly to the
deal's value, or `unassigned` with none, while nobody has planned it yet.
Winning a deal plans it when the person says how it is invoiced, else leaves
it unassigned; reopening a deal forgets it.

A payment has an id within the plan (`p1`), the month it is invoiced, its
amount without VAT, a label („Záloha“, „Doplatek“), a note and its state:
`invoicedOn` and `dueOn` once the invoice is issued (the due date is the
company's `paymentDueDays` after it, else the settings'), `paidOn` once it is
paid. The state shown is derived, never stored: `paid` with a day it was
paid; `overdue` when invoiced, unpaid and its due date has passed (due today
is not overdue yet); `invoiced` when an invoice was issued; else `planned`.
Marking a payment paid that was not invoiced invoices it the same day; taking
the invoice back takes the payment back too. A payment invoiced or paid keeps
its month and amount when the plan changes.

## Rules across records

`app/v3/src/domain/rules.ts` checks what the schema of one record cannot
express. An **error** stops the save of the record it is about and every
publication; a **warning** is shown and stops nothing.

| Rule | |
| --- | --- |
| The settings exist; the ids of stages, loss reasons, deal types, billing entities and quote sections are unique; exactly one won stage (100 %), exactly one lost stage (0 %), at least one open stage | error |
| A stage, a loss reason, a deal type or a billing entity a record uses is not removed from the settings | error |
| An IČO passes its check digit (modulo 11) and no two companies share one | error |
| A contact, a deal, an activity, a quote and a forecast row name a company, contacts, a salesperson, a stage, a reason, a deal type, a billing entity and a deal that exist | error |
| A deal's primary quote is a quote of that deal | error |
| A won deal has a value above zero and a closing date; a lost deal a reason and a closing date; an open deal neither; only a lost deal a reason | error |
| A deal does not close before it was created; only a task is done or not done | error |
| Only a won deal has a payment plan; a planned plan has a payment and its payments sum to the value; an unassigned plan has none; the payment ids of a plan are unique | error |
| A due date needs an issued invoice and is not before it; a payment is not before its invoice (a payment of a plan and a forecast row alike) | error |
| A quote's id is its number and version; its sections and lines have unique ids and every line is in one of its sections; it is valid no earlier than written | error |
| A contact of a deal belongs to the deal's company | warning |
| An open deal's salesperson is active | warning |
| An open deal has an expected closing date that has not passed | warning |
| A deal's value is its primary quote's subtotal | warning |
| A deal has at most one approved quote | warning |
| An approved quote that records commercial terms names the evidence of their acceptance | warning |
| A price list item's section is one of the settings' quote sections | warning |

The App checks the rules before every save and every publication; `bun run
validate:db` checks the whole checkout; the data repository's validator checks
the shape of each record, the id of the file and the one settings document.

## The forecast and the statistics

`app/v3/src/domain/forecast.ts` and `stats.ts` are pure functions of the data
(and of today for the forecast). The API (`/api/forecast`, `/api/stats`), the
pages and the tools for agents use the same ones.

- **The forecast** is what the Organization invoices: the payments of the
  payment plans of won deals and the manual forecast rows, never a weighted
  guess over open deals. For a year (this year by default) it gives each
  month and quarter and the year's total: the forecast, what is invoiced,
  paid, overdue and on the way (invoiced, not paid yet), and the count of
  rows. Every row says its deal and payment or its manual row, its state,
  its share of the deal's value and its salesperson, deal type and billing
  entity (a deal without one counts for the first entity). The rows group by
  salesperson, deal type and billing entity, and the same three filter the
  whole forecast. The years offered are this one and every year with a row.
  A won deal without a planned plan is **unassigned**: it is listed apart, in
  every year, until somebody plans it.
- **The statistics of a period** (both days included; the last 90 days by
  default) compare every figure with the **previous period** of the same
  length, the days right before it. A deal is closed in the period when it
  is won or lost with its closing date in it, and new when it was created in
  it; a quote counts by the day it was written, valued without VAT. The
  conversion is won / (won + lost) in basis points, half up (6000 = 60 %).
  The average win and the average sales cycle (days from `createdAt` to
  `closedAt`) are of the won deals, half up to a whole haléř and a whole day.
  The open pipeline is the open deals now, with no comparison. The
  leaderboard gives each salesperson's won value in the period and before it
  and their open deals. The charts take new deals (by where they stand now)
  and quotes by week for a period of up to 120 days, by month beyond, won
  deals by month for the twelve months up to the period's end, and the won
  value summed day by day against the previous period. By stage, an open
  stage counts the deals in it now, a won or lost stage those closed in the
  period; lost deals are counted by their reason, in the order of the
  settings. Every figure carries the ids behind it. A filter by salesperson
  or deal type narrows every figure.
- **The periods** a person picks (`periods.ts`) are relative to today: today,
  yesterday, the last 7, 30, 90 and 365 days, this and last week (from
  Monday), last month, this and last quarter, this and last year, and all
  (from the oldest date of the data).

`tests/forecast.test.ts` and `tests/stats.test.ts` hold the numbers of the
`sample` start counted by hand.

## The migration from 0.1.x

0.2.0 changes the shape of two collections: the settings
(`deals.settings.v1` → `v2`) and the deals (`deals.deal.v1` → `v2`). Data of
0.1.x does not read in 0.2.0 until it is migrated:

```bash
cd app/v3
bun run migrate ../../db/data --lang cs           # says what it would change
bun run migrate ../../db/data --lang cs --write   # writes it
bun run validate:db
```

- **The settings** lose `owners`: every name in it becomes a salesperson
  record (`salespeople/S-0001` …, active). They gain what a new quote starts
  with (21 % VAT, 30 days, the sections `items` and `work`, the usual units,
  in the language given) and 14 days to pay an invoice. Deal types and
  billing entities stay empty until the Organization adds them under
  Nastavení / Settings.
- **The deals** replace the free-text `owner` with `ownerId`: a name in the
  former `owners` takes that salesperson, any other name gets a salesperson
  record of its own, and a deal without one gets „Nepřiřazeno“ /
  „Unassigned“. A `quoteRef` of the neighbouring Quotes Module is kept as a
  line of the description (`Nabídka: NAB-2026-0007`). A won deal gets an
  unassigned payment plan, so the forecast lists it until somebody plans it.
- Companies, contacts and activities stay as they are; the new collections
  start empty.

Every record it writes gets a new `revision` and `updatedAt`, as a change past
the App must. It reads only `settings`, `salespeople` and `deals` and is
idempotent: data already at 0.2.0 has nothing to migrate. `tests/migrate.test.ts`
runs it over 0.1 data and checks the result against the schemas, the rules
and the data repository's validator. How an Organization takes it is in
[`adoption.md`](adoption.md), "Taking 0.2.0".

## The data repository

`templates/data-repo/` is what an adopting Organization puts into its
`deals-data` (see [`adoption.md`](adoption.md)):

| Path | Holds |
| --- | --- |
| `repository-db.yaml` | `schema`, `layout` and `validate` for the engine |
| `schemas/*.schema.json` | generated, one per collection; never edited there |
| `scripts/validate.ts` | the dependency-free validator repository-db runs before every publish |
| `.github/workflows/validate.yml` | the same validator in CI |
| `AGENTS.md`, `README.md` | the rules and the map of the data repository |

The records of a start come from `app/v3/seed/<cs|en>/<empty|sample>/`, laid
out like `data/`, with a directory for every collection. `empty` holds only
the settings: four open stages (10, 25, 50 and 75 %), won and lost, four loss
reasons, three deal types, one billing entity with placeholder details, what
a new quote starts with, 14 days to pay, CZK and ARES off. `sample` holds 3
salespeople (one who left), 6 fictional companies, 10 contacts, 14 deals
across the pipeline (3 won — two with a planned payment plan, one unassigned
— and 2 lost with a reason), 20 activities, a price list of 8 items, 7 quote
revisions of 6 quotes in every status but cancelled, 3 manual forecast rows
and a note on December. Its companies carry no IČO and no DIČ: even an
invented number with a valid check digit may belong to a real company. Two of
its open deals are on purpose without a usable date, so the warnings show;
one payment and one manual row are overdue on the tests' today, 25 November
2026.
