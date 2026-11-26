# Changelog

## Unreleased

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
