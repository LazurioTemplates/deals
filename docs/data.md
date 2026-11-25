# The data of Deals

Deals keeps its records in the Organization's data repository
`<Organization>/deals-data`, branch `v3`, checked out as `db/` at the Module
root and read and written only through [repository-db](https://github.com/Lazurio/repository-db).

## Collections

Every record is one YAML document `data/<collection>/<id>.yaml` in the
envelope of repository-db:

```yaml
id: D-2026-0004
record:
  companyId: C-0002
  contactIds:
    - P-0003
    - P-0004
  createdAt: 2026-08-25
  expectedClose: 2026-12-18
  id: D-2026-0004
  owner: Petr Vzorný
  probability: 45
  stageId: negotiation
  title: Chladicí vozy do flotily
  value: 21999990
schemaVersion: deals.deal.v1
```

| Collection | Id | `schemaVersion` | Holds |
| --- | --- | --- | --- |
| `settings` | `settings` | `deals.settings.v1` | the currency (ISO 4217, CZK by default), the stages of the pipeline in order (`id`, `label`, `kind` open, won or lost, `probability` 0–100), the loss reasons, the salespeople (`owners`, optional) and whether the App looks companies up in ARES (`aresLookup`) |
| `companies` | `C-0001` | `deals.company.v1` | name, IČO (eight digits), DIČ, address (`street`, `city`, `postalCode`, `country`), website, a note |
| `contacts` | `P-0001` | `deals.contact.v1` | name, e-mail, phone, role, the company (`companyId`), a note |
| `deals` | `D-<year>-<4 digits>` | `deals.deal.v1` | title, company, contacts, owner, stage, value, its own probability (else the stage's), the day it was created (`createdAt`), the expected and the actual closing date, the loss reason and a note on the loss, a quote of the neighbouring Quotes Module (`quoteRef`, not checked), a description |
| `activities` | `A-<year>-<5 digits>` | `deals.activity.v1` | the deal, the type (call, meeting, email, note, task), when (`at`, a date and time with its offset), a summary, contacts, and for a task whether it is done |

The schemas are Zod in `app/v3/src/domain/` and nothing else; `bun run
schema:export` writes their JSON Schemas into `templates/data-repo/schemas/`.
A date is `YYYY-MM-DD` and must exist in the calendar.

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

## Money

- **Amounts** are whole minor units of the currency, haléře for CZK:
  `21999990` is 219 999,90 Kč.
- **A probability** is a whole percent, 0–100. A deal's own probability
  replaces its stage's; without one the stage's counts.
- **A weighted amount** is `value × probability`, kept exact as hundredths of
  a haléř and rounded half up (never to the even neighbour) only in the sum of
  a month or a bucket. Rounded deal by deal, a month could be a haléř off.
- Every product and division goes through BigInt
  (`app/v3/src/domain/money.ts`); no amount is ever a floating-point crown.
  `tests/money.test.ts` holds the cases.

## Rules across records

`app/v3/src/domain/rules.ts` checks what the schema of one record cannot
express. An **error** stops the save of the record it is about and every
publication; a **warning** is shown and stops nothing.

| Rule | |
| --- | --- |
| The settings exist; the stage ids and the reason ids are unique; exactly one won stage (100 %), exactly one lost stage (0 %), at least one open stage | error |
| A stage or a loss reason a deal uses is not removed from the settings | error |
| An IČO passes its check digit (modulo 11) and no two companies share one | error |
| A contact, a deal and an activity name a company, contacts, a stage, a reason and a deal that exist | error |
| A won deal has a value above zero and a closing date; a lost deal a reason and a closing date; an open deal neither; only a lost deal a reason | error |
| A deal does not close before it was created; only a task is done or not done | error |
| A contact of a deal belongs to the deal's company | warning |
| The owner is one of the salespeople, when the settings name them | warning |
| An open deal has an expected closing date that has not passed | warning |

The App checks the rules before every save and every publication; `bun run
validate:db` checks the whole checkout; the data repository's validator checks
the shape of each record, the id of the file and the one settings document.

## The forecast and the statistics

`app/v3/src/domain/forecast.ts` and `stats.ts` are pure functions of the data
(and of today for the forecast). The API (`/api/forecast`, `/api/stats`), the
overview and the tools for agents use the same ones.

- **The weighted forecast** groups the open deals by the month of their
  expected close: count, value and weighted value per month. A deal without
  an expected close, or with one already past, counts in the bucket without a
  date. Won deals are grouped by the month they were closed and never count
  as open.
- **The statistics of a period** (both days included; the last 90 days by
  default): a deal is closed in the period when it is won or lost with its
  closing date in it. The conversion is won / (won + lost) in basis points,
  half up (6000 = 60 %). The average win and the average sales cycle (days
  from `createdAt` to `closedAt`) are of the won deals, half up to a whole
  haléř and a whole day. By stage, an open stage counts the deals in it now,
  a won or lost stage those closed in the period. Lost deals are counted by
  their reason, in the order of the settings.

`tests/forecast.test.ts` holds the numbers of the `sample` start counted by
hand.

## The data repository

`templates/data-repo/` is what an adopting Organization puts into its
`deals-data` (see [`adoption.md`](adoption.md)):

| Path | Holds |
| --- | --- |
| `repository-db.yaml` | `schema`, `layout` and `validate` for the engine |
| `schemas/*.schema.json` | generated; never edited there |
| `scripts/validate.ts` | the dependency-free validator repository-db runs before every publish |
| `.github/workflows/validate.yml` | the same validator in CI |
| `AGENTS.md`, `README.md` | the rules and the map of the data repository |

The records of a start come from `app/v3/seed/<cs|en>/<empty|sample>/`, laid
out like `data/`. `empty` holds only the settings: four open stages (10, 25,
50 and 75 %), won and lost, four loss reasons, CZK and ARES off. `sample`
holds 6 fictional companies, 10 contacts, 14 deals across the pipeline (3 won
and 2 lost with a reason) and 20 activities. Its companies carry no IČO and no
DIČ: even an invented number with a valid check digit may belong to a real
company. Two of its open deals are on purpose without a usable date, so the
warnings and the bucket without a date show.
