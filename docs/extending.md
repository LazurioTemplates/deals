# Extending Deals

An Organization that adopted Deals owns its copy and changes it freely. Two
things keep the copy healthy: changes within the App generation stay behind
the storage port, and the code moves only along the planned steps below.
Lazurio Marketplace templates allow exactly two kinds of change to their
stack: a **generation move** (the data layer changes) and a **stack profile
release** (tool versions change). Anything else is a patch release with a
security fix.

## Changes within generation v3

- **A new field or record rule.** Change the Zod schema in
  `app/v3/src/domain/`; the TypeScript type follows by itself. Add a new field
  as optional so existing records stay valid, or ship a migration of the data
  in the same release. Run `bun run schema:export` and copy the regenerated
  `templates/data-repo/schemas/` into the Organization's data repository in a
  pull request of its own. Update both starts in `app/v3/seed/`.
- **A rule across records** belongs to `app/v3/src/domain/rules.ts`, as an
  error (it stops a save and a publication) or a warning (it is shown). It
  speaks Czech and English and has its tests.
- **A new figure of the forecast or the statistics** is a pure function in
  `app/v3/src/domain/forecast.ts` or `stats.ts`, with its numbers counted by
  hand over the `sample` start in `tests/forecast.test.ts`. Amounts go
  through `money.ts`: weighted amounts stay exact and are rounded half up once
  per sum.
- **A new operation on the data** is a method of the storage port
  (`app/v3/src/data/store.ts`) named by the domain (`archiveDeal`, not
  `moveFile`), implemented in every store and covered by
  `tests/store-contract.ts`. The server, the service and the tools call only
  the port.
- **A record's revision** is opaque and new on every write (Module Standard,
  "One data port"). Every save of the port stores a new random write revision
  (`crypto.randomUUID()`) in `record.revision`, the instant in
  `record.updatedAt` and the person's subject in `record.updatedBy`
  (`newAudit` in `app/v3/src/data/records.ts`, called once per changed record
  by `record-store.ts`). The revision the port hands out and compares is the
  hash of the record's file as stored: after A → B → A it is new each time,
  so an editor who opened A first is refused with `record_changed` and the
  revision stored now, and a direct change of the file that kept the old
  `record.revision` is still a change. A save that changes nothing writes
  nothing and keeps the revision. Keep it so in a new store and a new
  collection: the shared suite checks A → B → A for every collection.
- **A new page** is a React component in `app/v3/src/ui/pages/` and a route in
  `routes.ts`; it calls only the HTTP API (`app/v3/src/ui/api.ts`) and writes
  every text in both languages. A form edits through `useRecordForm`
  (`app/v3/src/ui/edit.tsx`), so it saves with the revision it came from.
- **A new tool for agents.** An action people and agents do often gets a tool
  in `app/v3/src/server/agent-tools.ts`: defined once on the server with
  `@lazurio/module-kit/tools`, calling the same HTTP API, offered on `/mcp`
  and to the page. Declare its `effect` honestly: `read` changes nothing,
  `write` saves a draft, `publish` is a Publication and a tool of its own
  (with `destructiveHint`, which the kit adds). Add it to `docs/agents.md`
  and to the lists in `tests/agent-tools.test.ts` and `tests/tools.test.ts`.
  Only a tool that just opens a view and changes nothing lives in the page,
  as a view tool in `app/v3/src/ui/tools.ts`.
- **ARES** stays on the server (`app/v3/src/server/ares.ts`): the IČO is
  checked before a call, a call waits at most 5 s, answers are kept 24 hours
  and at most 30 calls a minute leave the process. Another register is another
  client of the same shape, with an injected `fetch` and tests on a stub.
- **The process.** When the way the Organization sells changes, change the
  skills in `.agents/skills/` and copy them to `.claude/skills/` (a test keeps
  them identical and checks every tool they name), and say the Organization's
  own rules in its section of `AGENTS.md`.
- **Look and feel of the App.** The look is the design system's (next
  section). `app/v3/src/instance/` is the Organization's overlay of this App:
  `brand.ts` and `theme.css`. Keep the App's own layout in
  `app/v3/src/ui/styles.css`, with the design system's tokens only, and load
  nothing from another origin.

Run `bun run check` and `bun run build` in `app/v3` before every pull request.

## The look of the App

The App takes its look from the Organization's design system, the package
`design-system`, a dependency of `app/v3/package.json` on a released tag.
This template depends on `github:LazurioTemplates/design-system#v2.2.0`;
`bun.lock` records the tag's commit and the archive's `sha512`, and `bun
install --frozen-lockfile` installs exactly that. No file of the design system
lives in this repository, and nothing imports it by a relative path (Module
Standard).

- **The App** imports `design-system/styles.css` once in
  `app/v3/src/ui/main.tsx` and uses the package's React components
  (`design-system/react`): buttons, badges, alerts, tables, fields,
  checkboxes, switches, dialogs, the navigation and empty states. Its fonts
  come with the package; the page loads nothing from another origin.
  `src/ui/styles.css` holds only the App's own layout and names only the
  package's `--ds-*` tokens; `src/ui/locale.ts` takes the language by the
  package's `resolveLocale()` and `readLazurioLocale()`.
- **A newer release of the design system** is a new tag in the dependency:
  change `#v2.2.0`, run `bun install` and `bun run check`, read the release's
  `CHANGELOG.md`, look at the pages in both languages and both themes, and
  open a pull request that names the release.
- **The Organization's own design system** (an adopted
  `<Organization>/design-system`, which carries the Organization's brand)
  changes only the dependency line:
  `"design-system": "git+ssh://git@github.com/<Organization>/design-system.git#v<version>"`;
  the imports stay the same, because both packages are named
  `design-system`.
- **Known limitation:** the Organization's design system is a private
  repository, which `git+ssh` installs on an Environment with the person's
  SSH key, but the Module's GitHub Actions cannot install it until the
  Organization gives them read access to it
  ([Lazurio/LazurioPlatform#915](https://github.com/Lazurio/LazurioPlatform/issues/915));
  until then CI of such a Module fails at `bun install`, and the check runs on
  the Environment.

## Taking a template release

Later releases of the template arrive as merges, never as copies, rebases or
squashes. The release that was adopted is an ancestor of the Organization's
`main` (see [`adoption.md`](adoption.md)), so Git knows what the Organization
changed and what the template changed.

```bash
git fetch https://github.com/LazurioTemplates/deals.git "refs/tags/<tag>"
test "$(git rev-parse 'FETCH_HEAD^{commit}')" = "<commit from the release notes or registry>"
git switch -c take-<tag> origin/main
git merge --no-ff <commit>
```

- Resolve conflicts hunk by hunk. The Organization's identity
  (`lazurio.module.json`, `lazurio.runtime` ids, `config/data-repository.json`,
  `src/instance/`, its `AGENTS.md` section, the dependency on its own design
  system) stays the Organization's; the rest usually takes the template's side.
- Read the release's `CHANGELOG.md` section: when the schemas changed, the data
  repository gets the regenerated `schemas/` (and any migration) in a pull
  request of its own, merged together with the Module's.
- `bun install --frozen-lockfile && bun run check && bun run build`, then a
  pull request. Merging it is the person's Publication.

## Languages

Every text people see is written in Czech and English side by side
(`t("Firmy", "Companies")` in the UI, `pick(locale, cs, en)` on the server).
The App takes its language from `?lang=` in the address, then from the
person's Lazurio profile in `/.lazurio/shell.json`, then Czech
(`app/v3/src/ui/locale.ts`); the server and the tools answer in the language
the caller asks for (`Accept-Language`). Lazurio relays
`/.lazurio/shell.json` only on its own origins today
([LazurioPlatform#909](https://github.com/Lazurio/LazurioPlatform/issues/909));
when it hands modules the person's language, the App follows it without a
change. A third language is a third string in every pair and a third start in
`app/v3/seed/`: a template release, not a change of one Organization's copy.

## Stack profile releases

The template follows the stack profile [`app-data@2027.03`](https://github.com/Lazurio/LazurioPlatform/blob/main/docs/stack-profiles.md#app-data):
exact versions of Bun, TypeScript, Vite, React, Biome, Zod, repository-db and
module-kit (see `app/v3/package.json`). A **stack profile release** moves
those versions together: one template release that updates `packageManager`,
the exact versions, `bun.lock`, the CI's Bun and, if the formatter changed,
reformats once. Organizations take it by merging its tag like any other
release. Between profile releases only patch versions with a security fix
change. CI installs a pinned Lazurio CLI (`LAZURIO_VERSION` in
`.github/workflows/check.yml`) for `lazurio module readiness`; a newer one is
a change of that pin in a pull request of its own.

When `@lazurio/repository-db` words its Draft & Publish card in English
([Lazurio/repository-db#40](https://github.com/Lazurio/repository-db/issues/40)),
the App's own card (`app/v3/src/ui/components/DraftCard.tsx`) returns to the
engine's `DraftPublishPanel`. When module-kit handles the `AbortError` of a
removed WebMCP tool itself
([Lazurio/module-kit#14](https://github.com/Lazurio/module-kit/issues/14)),
`quietModelContext` in `app/v3/src/ui/tools.ts` goes.

## The move to generation v4 (Dolt)

Generation v4 keeps the data in a Dolt database in the Organization's services
Environment instead of a Git data repository; it fits an Organization where
many people work the pipeline at once or another system writes deals. The
move is planned, reviewed and reversible:

1. **A new App beside the old one.** Create `app/v4/` from `app/v3/`:
   `src/domain/`, `src/service/`, `src/server/`, `src/ui/` and
   `tests/store-contract.ts` are copied unchanged. Add `src/data/dolt-store.ts`,
   the storage port over Dolt (per the profile `app-database`), and SQL
   migrations derived from the Zod schemas. Every write stores a new random
   value in the row's `revision` column, as v3 does in `record.revision`.
   Settings, companies, contacts, deals and activities are flat records with a
   stable id, so they map to rows; the stages and the loss reasons of the
   settings become tables of their own.
2. **Draft & Publish stays the same for people.** A draft is the person's
   working set or branch, publishing is `DOLT_COMMIT` with the author and a
   summary, the review comes from Dolt's diff tables. This mapping is to be
   proven on a prototype before the first v4 release.
3. **The same tests.** `tests/store-contract.ts` runs against Dolt in CI. A
   store that passes the suite replaces the v3 store without a change to the
   server, the UI or the tools.
4. **Moving the data** reads every record through the v3 store, validates it
   with the same Zod schemas, writes it to Dolt and makes one `DOLT_COMMIT`
   naming the source commit of the v3 data, proving the counts and a round
   trip of every record, amounts to the haléř.
5. **Switching.** `lazurio.module.json` lists both Apps; `default_app` moves
   to `app/v4/package.json` only on the decision of the Organization's Steward
   or the person. `app/v3` stays as the way back until that decision is final;
   a Module keeps at most two generations.

Do not confuse the two meanings of "v4": the App generation `app/v4` (Dolt)
and a repository-db data branch named `v4`. Write "App generation" and "data
branch".
