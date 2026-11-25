# Deals

A sales pipeline for a Lazurio Organization: deals, the companies and people
they are with, what happened on them, a weighted forecast and the results of
a period. Deals is a Module of the
[Lazurio Module Standard](https://github.com/Lazurio/LazurioPlatform/blob/main/docs/module-standard.md)
and a template of the Lazurio Marketplace, published by LazurioTemplates as the
public upstream `LazurioTemplates/deals` under the MIT license. In Czech it is
called „Obchodní případy“.

![The overview: the open pipeline by stage, the weighted forecast and the results of a period](docs/screenshots/en/overview.webp)

- **Pipeline.** Stages in the Organization's order, each with a probability,
  plus exactly one won and one lost stage, all data in the settings. A deal
  moves between them from its card or its page; won asks for the final value
  and the day, lost for a reason from the settings, a note and the day.
- **Deals, companies and contacts.** A deal names its company, its contacts,
  its owner, a value, an expected closing date and, if it differs from its
  stage's, its own probability. A company may carry its IČO (checked modulo
  11, never twice) and its address; the App can fill it in from ARES, asked
  only by the server, when the Organization turns that on.
- **Activities.** Calls, meetings, e-mails, notes and tasks on a deal, newest
  first; a task is ticked off.
- **Forecast and statistics.** The weighted forecast by month of the expected
  close (value × probability, rounded half up once per month), a bucket for
  open deals without a date or past it, and won deals by month. For any
  period (the last 90 days by default): the conversion, won and lost, the
  average win, the average sales cycle, counts by stage and losses by reason.
  Amounts are whole haléře, never floating point.
- **Rules across records.** A deal names a company, contacts, a stage and a
  reason that exist; a won deal has a value and a date, a lost one a reason; a
  stage or a reason a deal uses cannot be removed. An error stops a save and a
  publication; a warning (an open deal without a date, a contact of another
  company) is shown and stops nothing.
- **For agents.** Three skills (`.agents/skills/`): create a deal from a
  message, review the pipeline for the week, close a deal. The App's tools for
  agents are defined once on its server, offered on `/mcp` of the Application
  and as WebMCP tools in the Environment browser; they list only what the
  person's role and the writer mode allow. One of them, `publish_draft`,
  publishes, and an agent calls it only on the person's instruction.
- **Draft & Publish.** Every save is a draft; a person reviews the changed
  records in business language and publishes them as one change to the
  Organization's data repository, or returns them.

![Přehled: otevřené obchodní případy podle fáze, vážený forecast a výsledky období](docs/screenshots/cs/overview.webp)

The App speaks Czech or English: `?lang=` in the address first, then the
language of the person's Lazurio profile where Lazurio hands it to the page
(`/.lazurio/shell.json`), otherwise Czech. The records hold whatever language
the Organization writes in; both starts ship in both languages.

## How it is built

| | |
| --- | --- |
| App generation | `app/v3`: data in [repository-db](https://github.com/Lazurio/repository-db) |
| Stack profile | [`app-data@2027.03`](https://github.com/Lazurio/LazurioPlatform/blob/main/docs/stack-profiles.md#app-data): Bun 1.4.4, TypeScript 7.0.2, Vite 8.3.5, React 19.3.1, Biome 2.6.4, Zod 4.6.7, `@lazurio/repository-db` v3.4.0, `@lazurio/module-kit` v0.6.0, exact versions only |
| Data | the Organization's own repository `deals-data`, branch `v3`, checked out as `db/` |
| Shape of the data | Zod schemas in `app/v3/src/domain/`; the JSON Schemas of the data repository are generated from them |
| Look of the App | the package `design-system`: [LazurioTemplates/design-system](https://github.com/LazurioTemplates/design-system) v2.2.0, a dependency on its released tag; the Organization's own design system replaces it by one line |

```text
app/v3/src/
  domain/     Zod schemas and pure logic: money, rules across records, the forecast, the statistics
  data/       the storage port (store.ts), its repository-db and memory implementations
  service/    the operations the API and the tools share
  server/     Bun.serve: the HTTP API over the port, ARES, the tools for agents (/mcp and the page),
              health, the client, the demo
  ui/         React; talks only to the HTTP API; registers the server's tools for agents
  cli/        validation and schema export
  i18n/       the two languages
app/v3/seed/<cs|en>/<empty|sample>/   the starts, laid out like db/data/
app/v3/tests/store-contract.ts        the shared test suite every store implementation passes
templates/data-repo/                  the data repository an adopting Organization starts from
.agents/skills/, .claude/skills/      the process for agents (the same files for Codex and Claude Code)
```

The server never runs Git on the data and never reads a record file by a path
it built: every read and write goes through the storage port, which in `v3`
is repository-db's sync host. A later generation replaces only that port
implementation; see [`docs/extending.md`](docs/extending.md).

## Run it

Lazurio starts the App from its Module manifest: `lazurio module start
<Organization>/deals`. To work on it in a worktree:

```bash
cd app/v3
bun install --frozen-lockfile
bun run check          # typecheck, Biome, generated schemas, the starts, tests
LAZURIO_RUNTIME_LISTENER_APP_HOST=127.0.0.1 LAZURIO_RUNTIME_LISTENER_APP_PORT=<free port> bun run dev
```

`bun run dev` serves the data checkout `db/` at the Module root. Without one,
the App runs and says that the data is not available yet.

`bun run dev:demo` (or `bun run dev:demo en`) serves the fictional example in
memory instead: nothing is read from or written to a repository, ARES is never
asked, and every change is gone when the process ends. It needs the same
listener as `bun run dev`; without it the process exits 2:

```bash
LAZURIO_RUNTIME_LISTENER_APP_HOST=127.0.0.1 LAZURIO_RUNTIME_LISTENER_APP_PORT=<free port> bun run dev:demo
LAZURIO_RUNTIME_LISTENER_APP_HOST=127.0.0.1 LAZURIO_RUNTIME_LISTENER_APP_PORT=<free port> bun run dev:demo en
```

Outside Lazurio, add `?lang=en` to the address for the English interface.
The Marketplace screenshots come from it.

| Script | Does |
| --- | --- |
| `check` | the one gate: `typecheck`, `lint`, `schema:check`, `validate:data`, `bun test` |
| `dev:demo` | the App over the fictional example in memory |
| `validate:db` | checks the data checkout `db/` (draft included) against the schemas and the rules across records |
| `schema:export` | regenerates `templates/data-repo/schemas/*.schema.json` from the Zod schemas |
| `build` | the client build of the built version (`dist/`) |

CI runs `bun run check` and `bun run build` on Linux, the same check on
Windows, and `lazurio module readiness`, which must say `ready-for-live`.

## Adopt it

The Marketplace in Lazurio hands an agent a brief; the agent follows
[`docs/adoption.md`](docs/adoption.md): it checks rights and name collisions,
creates a private Module with its data repository by `lazurio module create
--data`, merges the released commit so it stays an ancestor, prepares the data
in the person's language and opens pull requests. Nothing is merged, published
or sent without the person's instruction.

## Screens

| | Czech | English |
| --- | --- | --- |
| Overview | [`cs/overview.webp`](docs/screenshots/cs/overview.webp) | [`en/overview.webp`](docs/screenshots/en/overview.webp) |
| Deals | [`cs/deals.webp`](docs/screenshots/cs/deals.webp) | [`en/deals.webp`](docs/screenshots/en/deals.webp) |
| A deal with its activities | [`cs/deal.webp`](docs/screenshots/cs/deal.webp) | [`en/deal.webp`](docs/screenshots/en/deal.webp) |
| A company with its deals and contacts | [`cs/company.webp`](docs/screenshots/cs/company.webp) | [`en/company.webp`](docs/screenshots/en/company.webp) |
| Settings of the pipeline | [`cs/settings.webp`](docs/screenshots/cs/settings.webp) | [`en/settings.webp`](docs/screenshots/en/settings.webp) |

## Documents

- [`AGENTS.md`](AGENTS.md): rules for agents working on this repository and in an adopted Module
- [`docs/adoption.md`](docs/adoption.md): taking the template into an Organization
- [`docs/extending.md`](docs/extending.md): changes within the generation, the look of the App,
  taking template updates, stack profile releases, the next generation
- [`docs/data.md`](docs/data.md): the records, money in haléře, the forecast, the data repository
- [`docs/agents.md`](docs/agents.md): the tools for agents and their effects
- [`CHANGELOG.md`](CHANGELOG.md), [`SECURITY.md`](SECURITY.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`NOTICE.md`](NOTICE.md)

## License

MIT, see [`LICENSE`](LICENSE).
