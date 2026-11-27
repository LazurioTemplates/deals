# Changelog

## Unreleased

### For whoever uses it

- **A quieter, denser look.** The pages, flows and data stay as they were;
  how they look changes. Small type and two weights, grays in steps of the
  ink, hairlines instead of borders, dense table rows, tinted pills for
  stages and quote statuses (also where they are chosen in a row), the
  navigation with icons and counts on a gray frame and the page on a white
  panel set into it. A page starts with one quiet row: where it sits and
  its actions; a record's page adds its name as a large title. The board,
  the overview's pipeline, the tiles, the forecast months and the charts
  follow the same language, in the light and the dark theme.

### For whoever changes it

- **The look layer** `app/v3/src/ui/styles/look.css` (see
  [`docs/extending.md`](docs/extending.md), "The look of the App"): sizes and
  density on top of the design system; colours stay its `--ds-*` tokens.

## 0.2.0 — 2026-11-26

0.2.0 brings Deals to the structure of a mature sales pipeline: salespeople
as records, a price list, quotes with revisions, a forecast that is the
payment plans of won deals, statistics against the previous period, a record
of commercial terms and a CSV import. The data changes shape; an Organization
on 0.1.x migrates it (below).

### For whoever runs it

- **Salespeople are records.** `salespeople` (`S-0001`): name, role,
  contacts and whether still active. A deal names its salesperson by id
  (`ownerId`) instead of a free name; somebody who left stays, inactive, and
  an open deal of theirs is a warning.
- **The settings grow** (`deals.settings.v2`): deal types, the billing
  entities that issue quotes and invoices, what a new quote starts with (VAT
  rate, validity, sections, units, the texts of the terms, the version and
  address of the commercial terms) and the days an invoice is due; a company
  may have its own.
- **Deals** (`deals.deal.v2`) carry a deal type, a billing entity, the quote
  their value follows and, once won, a payment plan.
- **The price list** (`pricebook`, `I-0001`): items with a code, a unit, a
  price without VAT and a quote section; an item no longer sold stays,
  inactive.
- **Quotes** (`quotes`): a quote of a deal from the price list and the
  settings, with lines in sections, quantities to three decimals, discounts,
  one VAT rate or reverse charge, a reserve for changes and the customer
  copied as it was. Every revision is a record of its own
  (`Q-2026-0001-r2`), so what was sent never changes; statuses draft,
  active (sent), approved, superseded and cancelled. A line is rounded half
  up once, the VAT once per quote. While a deal has a quote with lines, its
  value follows its primary quote (the one it names, else the approved one,
  else the newest live revision), saved in the same write. A print view
  makes the PDF; the App sends nothing.
- **A record of the commercial terms** on a quote: business or consumer, the
  version and address of the terms, when and how the customer accepted them,
  and per area whether the standard terms apply. Never the legal text.
- **The forecast is the payment plans of won deals**, no longer a weighted
  pipeline: each payment planned, invoiced, overdue or paid, by month and
  quarter of a year, with what is invoiced, paid, overdue and on the way,
  grouped and filtered by salesperson, deal type and billing entity, plus
  manual rows (`forecastEntries`) and notes on a month (`forecastNotes`). A
  won deal without a plan waits among the unassigned. Winning a deal plans
  its payments or leaves it unassigned; a plan adds up exactly to the value,
  a split by shares gives the last payment what is left.
- **Statistics against the previous period** of the same length: won, lost,
  new deals and quotes, conversion, average win and cycle, the open
  pipeline, a leaderboard of the salespeople, charts by week or month, the
  won value day by day, every number with the deals behind it; period
  presets from today to last year; filters by salesperson and deal type.
- **A CSV import** of companies, contacts and deals with a preview row by
  row, written as one draft.
- **The App**: a navigation in sections, the deals as a table with sortable,
  movable and resizable columns kept per viewer or as a board by stage with
  drag and drop, and pages for the quotes, the price list, the salespeople,
  the forecast, the statistics and the import.
- **The storage port** gains generic `list`, `get`, `save`, `saveAll` and
  `remove`: a write of several records of any collections is checked whole
  and written whole or not at all, and a removal is refused while another
  record names the record. The shared contract suite covers them.
- **New rules across records**: a salesperson, a deal type, a billing entity
  and a quote a record names exist; only a won deal has a payment plan and
  a planned one adds up to the value; an invoice's due date and payment are
  not before it; a quote's id, sections and lines agree. Warnings: a value
  that differs from the quote, two approved quotes of a deal, approved terms
  without evidence of their acceptance.
- **Tools for agents**: `list_salespeople`, `list_pricebook`, `list_quotes`,
  `get_quote`, `create_quote`, `save_quote`, `set_quote_status`,
  `revise_quote`, `plan_payments`, `mark_payment` and
  `create_forecast_entry`; `get_forecast` takes a year and filters,
  `get_stats` filters, and the deal tools take `owner_id`. Every one of them
  writes a draft or only reads; `publish_draft` stays the one publication.
- **Skills**: a new `prepare-quote` prepares a quote from a message or a call
  note as a draft, from the price list where it fits, never inventing a
  price and never sending it; `create-deal-from-message` names the
  salesperson by id; `weekly-pipeline-review` reads the payment-plan
  forecast, what is overdue and what is unassigned; `close-deal` plans the
  payments of a won deal or leaves it unassigned.
- **The starts** carry the new collections; the `sample` has three
  salespeople, a price list, quotes in every status but cancelled, payment
  plans in every state and manual forecast rows, fictional only.

### For whoever adopts it

- **The data must be migrated.** The App of 0.2.0 does not read 0.1 data:
  `bun run migrate <data directory> [--lang cs|en] [--write]` turns the
  names of the salespeople into records, moves the deals to `ownerId`, keeps
  a 0.1 quote reference in the description, gives the settings what a new
  quote starts with and leaves every won deal unassigned in the forecast. It
  stamps every record it writes and is idempotent.
- **The data repository** takes the release's `schemas/` (five new, three
  changed) and `scripts/validate.ts`, which now checks the shapes the quotes
  use.
- **The order**: the Module's pull request, then in its worktree the
  schemas, the migration and both validations in the data checkout, the
  review and the publication of that draft in the App, and the merge of the
  Module right after, all on the person's word (`docs/adoption.md`, "Taking
  0.2.0"). Afterwards the person checks the salespeople it created, fills
  the deal types, the billing entities and the price list, and plans the
  payments of the won deals that should count in the forecast.

## 0.1.2 — 2026-11-26

### For whoever adopts it

From the first adoption tried end to end, in an example Organization:

- **What GitHub enforces, and what the Organization requires.** On GitHub
  Free, private repositories have no rulesets or branch protection and
  GitHub answers 403 "Upgrade to GitHub Team"; the adoption now reads the
  plan first and no longer takes that for a missing right. It reports per
  pull request what GitHub enforces and, separately, what the
  Organization's own working rules require, since a review agreed there
  holds where GitHub enforces nothing. Where missing rights keep it from the
  rules, it prepares a request to someone who has them, and never invents
  the rules.
- **The default Team first.** It recommends the Team the root marks as
  default and says what a Team is here.
- **A private design system** may install in the Module's CI after all; the
  guide no longer says it cannot.
- **The last step in the handoff.** The access of Teams in Přehled
  Organizace is named as the step that stays open.

## 0.1.1 — 2026-11-25

### For whoever adopts it

- **An existing pipeline first.** Before the plan, the adoption looks for a
  Module that already keeps the Organization's deals, customers or pipeline,
  under any name, and asks the person whether Deals goes beside it, replaces
  it (without touching it) or serves only as a pattern; without an answer it
  adopts nothing (`docs/adoption.md`, step 1.4).
- **The scaffold's own files go.** After the merge of the release, the
  adoption removes every file under `app/v3/` the release does not have, by
  one loop over `git ls-files`, instead of a fixed list that missed what
  `lazurio module create --data` adds today (`src/server.ts`,
  `src/app-server.ts`, `src/agent-tools.ts`, `tests/store-contract.test.ts`
  and their tests); left behind, they failed the Module's checks. A test runs
  the loop.
- **Teams the command accepts.** The adoption offers only Teams the root's
  `lazurio.organization.json` declares, that GitHub has under their bound
  slug and, where the binding names an id, with that id (every page of
  the list), and stops before the plan when none is, instead of meeting
  `unknown_team`, `team-not-on-github` or `team-binding-mismatch` at the
  command.
- **Who approves, said up front.** For each of the three pull requests
  (the root's default branch, the new Module's `main`, the data's `v3`) the
  adoption reads the rulesets, the Organization's rulesets that reach new
  repositories and the branch protection, and the plan says what each
  requires and who could approve, or that it cannot be established yet;
  when the person is the only one who could, it says so before anything is
  created, never proposing a bypass (step 1.7).

## 0.1.0 — 2026-11-25

The first release of Deals, a sales pipeline for a Lazurio Organization, on
the stack profile `app-data@2027.03` (Bun 1.4.4, `@lazurio/repository-db`
v3.4.0, `@lazurio/module-kit` v0.6.0) and the design system v2.2.0.

### For whoever runs it

- **The data.** Settings with the stages of the pipeline (exactly one won and
  one lost stage), loss reasons, salespeople, the currency and the ARES
  switch; companies, contacts, deals and activities as Zod schemas in
  `app/v3/src/domain/`, with their JSON Schemas generated into
  `templates/data-repo/schemas/`. The Organization's data repository is
  `deals-data`, branch `v3`, checked out as `db/`.
- **Rules across records**, in Czech and English: references that exist, what
  a won and a lost deal need, an IČO checked modulo 11 and used once, a stage
  or a reason a deal uses kept in the settings. An error stops a save and a
  publication, a warning only shows.
- **The forecast and the statistics** as pure functions: the weighted forecast
  by month of the expected close with a bucket for deals without a date or
  past it, won deals by month, and for a period the conversion, the average
  win, the average sales cycle, counts by stage and losses by reason. Amounts
  are whole haléře; weighted amounts are rounded half up once per sum.
- **The storage port** over repository-db and in memory, with the shared
  contract suite: every write stores a new `record.revision`, `updatedAt` and
  `updatedBy`, a stale save is refused with `record_changed` and the revision
  stored now, and Draft & Publish publishes exactly the draft shown.
- **The App**: one Bun process with the HTTP API, health, the client built by
  Vite and an ARES lookup asked only by the server (IČO checked first, 5 s,
  24 h cache, 30 calls a minute). The React interface on the design system
  speaks Czech and English, works at a phone's width, in light and dark, and
  loads nothing from another origin. Who came is read through `appAccess` on
  every request; a copy writes only with `LAZURIO_RUNTIME_DATA_WRITER=true`.
- **Tools for agents** on `/mcp` and as WebMCP tools of the page: reading,
  writing as a draft, and `publish_draft`, the one publication, which an agent
  calls only on the person's instruction. Three skills: create a deal from a
  message, review the pipeline for the week, close a deal.
- **The starts** `empty` and `sample` in Czech and English, fictional only;
  `bun run dev:demo` serves the sample in memory.
- **CI** runs `bun run check` and `bun run build` on Linux, the check on
  Windows, and `lazurio module readiness`, which must say `ready-for-live`.
