# Adopting Deals into an Organization

This is the procedure an agent follows when a person chooses "Přidat do
Organizace" for Deals in the Lazurio Marketplace, or asks for it in Chat. It
follows LazurioPlatform
[`docs/marketplace.md`](https://github.com/Lazurio/LazurioPlatform/blob/main/docs/marketplace.md)
and the [Module Standard](https://github.com/Lazurio/LazurioPlatform/blob/main/docs/module-standard.md).

The brief names the **release** (tag and full commit, as the Marketplace
registry records them), the **target Organization**, the **start** (`empty`:
the settings with a ready pipeline and loss reasons, no records; `sample`:
fictional companies, contacts, deals across the pipeline and activities) and the
**language** of the start (`cs` or `en`). When the brief does not name the
language, take the person's (the `locale` of the Folder's profile, the
language you speak with them); when it does not name the start, ask.

**Nothing is merged, published, granted, started or sent without the
person's explicit instruction.** The agent prepares pull requests and
requests; every merge, every publish of data and every access change is the
person's Publication. Where the person's rights do not reach, the agent
prepares a request for whoever may do it and goes on with the rest.

## 1. Check rights, name and compatibility

Do all of this live, before showing a plan.

1. **Who acts.** `gh api user --jq .login` is the person's login. Creating an
   Organization's Module needs an active Owner of the Organization:
   `gh api orgs/<Org>/memberships/<login> --jq .role` is `admin`. Otherwise
   prepare a request for an Owner
   (`gh api --paginate "orgs/<Org>/members?role=admin" --jq '.[].login'`): an issue in
   the Organization's root repository with the plan below, assigned to them.
2. **The release.** Compare it with the brief. Releases are annotated tags,
   so ask for the commit the tag points to, its peeled ref:
   `git ls-remote https://github.com/LazurioTemplates/deals 'refs/tags/<tag>^{}'`
   must print the recorded commit (asking for `refs/tags/<tag>` alone gives
   the tag object, not the commit). A mismatch, or no line, stops the
   adoption.
3. **Name collision.** The slug is `deals`. Look in the Organization's
   `modules.manifest.json` for a slot with that slug or path, and on GitHub for
   `<Org>/deals` and `<Org>/deals-data`.
   - Nothing there: go on with the slug `deals`.
   - The Organization already runs Deals (an adoption of this template): this
     is not a new adoption. Take the release as an update
     ([`extending.md`](extending.md), "Taking a template release") and tell
     the person.
   - An unrelated Module or repository has the name (an Organization's own
     CRM or pipeline): tell the person what exists and agree another slug
     with them (for example `obchod`); use it below for the Module and
     its `<slug>-data` repository. Never overwrite or merge into it.
4. **An existing pipeline under another name.** A collision of the slug
   is not the only overlap: the Organization may already keep its deals in a
   Module of its own, a CRM, a pipeline or a sales tracker, under any name.
   Read its `modules.manifest.json` (each slot's name, title and
   description) and every one of its repositories on GitHub, all pages
   (`gh repo list` stops at 30 unless told otherwise):

   ```bash
   gh api --paginate orgs/<Org>/repos --jq '.[] | [.name, (.description // "")] | @tsv'
   ```

   Look for one that keeps deals, customers or a sales pipeline. When there is one, stop before the plan and ask the person,
   naming it with its link, which they want:
   - **beside it:** Deals as a second, separate Module; say that the two do
     not share data and that their people will keep deals in two places;
   - **instead of it:** Deals replaces it; this adoption only adds Deals,
     never touches, migrates or archives the existing Module, and moving its
     data over is a plan of its own with the person;
   - **only as a pattern:** nothing is adopted; the existing Module takes
     what it wants from this release (its skills, its tools for agents, its
     forecast) by its own pull requests, and this adoption ends here.

   Go on only with their answer; without one, adopt nothing.
5. **Compatibility.** The Organization's Environments run a LazurioPlatform
   release that knows `start_script` and `build_output` (v0.1.11 or newer);
   Bun 1.4.4 is fetched by Lazurio when missing.
6. **Teams the command accepts.** `lazurio module create` takes a Team only
   when the root's `lazurio.organization.json` declares it (`teams[].slug`,
   otherwise `unknown_team`), GitHub has a Team under the slug its
   `forge_binding.team.asserted_slug` names, or under its own slug without a
   binding (otherwise `team-not-on-github`), and that Team's id is the
   binding's `forge_binding.team.id` (otherwise `team-binding-mismatch`).
   Read both sides, every page of the GitHub list:

   ```bash
   jq -r '.teams[] | [.slug, (.forge_binding.team.asserted_slug // .slug), (.forge_binding.team.id // "")] | @tsv' lazurio.organization.json
   gh api --paginate orgs/<Org>/teams --jq '.[] | [.slug, (.id | tostring)] | @tsv'
   ```

   Offer the person only a declared Team whose GitHub slug is in the list
   and, where the binding names an id, has that id. When none qualifies,
   stop before the plan and tell the person which Team is missing or bound
   to another id: an Owner creates the Team or corrects the binding in the
   root; this adoption changes neither.
7. **Who approves the pull requests.** The adoption ends with three pull
   requests and the person merges them: the root's slot (into the root's
   default branch), the Module (into `main` of the new `<Org>/<slug>`) and
   the data (into `v3` of `<Org>/<slug>-data`). For each target read the
   approvals it requires and who may give them:

   ```bash
   # the root's default branch: rulesets and classic branch protection
   gh api repos/<Org>/<root>/rules/branches/<default> --jq '.[] | select(.type == "pull_request") | .parameters'
   gh api repos/<Org>/<root>/branches/<default>/protection --jq '.required_pull_request_reviews' # 404: none
   # the Organization's rulesets, which also reach repositories created later
   gh api --paginate orgs/<Org>/rulesets --jq '.[].id'
   gh api orgs/<Org>/rulesets/<id> --jq '{enforcement, target, conditions, pull_request: [.rules[] | select(.type == "pull_request") | .parameters]}'
   # who could approve in the root: write access, and CODEOWNERS when code owners must review
   gh api --paginate repos/<Org>/<root>/collaborators --jq '.[] | select(.permissions.push) | .login'
   ```

   A ruleset counts for a target when it is `active` and its `conditions`
   (`repository_name` include and exclude, `ref_name` include and exclude,
   `~DEFAULT_BRANCH`, `~ALL`) match the target's repository and branch; the
   Module and its data repository do not exist yet, so match their names
   `<slug>` and `<slug>-data` and the branches `main` and `v3`.
   `required_approving_review_count` above 0 means someone other than the
   author approves, and GitHub never counts the author's own approval;
   `require_code_owner_review` means one of the code owners. The new
   repositories' possible reviewers are the Organization's Owners and the
   members of the Teams chosen in step 1.6.

   In the plan, say per target what it requires and who could approve.
   When the person is the only one who could (the Organization's only Owner,
   no other member with write access or among the code owners), say so now,
   not at the third pull request, and ask whom to ask; when the Organization
   has no one, the pull request waits until it adds someone. When a target's
   requirement cannot be established yet (a ruleset whose conditions you
   cannot match with certainty, rules you cannot read), say exactly that in
   the plan and read the rules again once the repository exists, before
   asking the person to merge. Never promise a reviewer you have not found,
   and never propose a bypass, an exception in the rules or merging without
   the review.

## 2. Show the plan and wait for confirmation

Show the person, in their language and in a few lines:

- when the Organization already keeps its deals in another Module (step 1.4),
  that Module and what the person chose: beside it or instead of it;
- the release (version, tag, commit) and that its code runs in the
  Organization's Environments (`bun install`, the tests, the App);
- the two private repositories that will be created: `<Org>/<slug>` and
  `<Org>/<slug>-data`;
- the Teams that get access, chosen with the person from those step 1.6
  found both declared and on GitHub, never guessed;
- per pull request (root, Module, data) what approval it requires and who
  could give it (step 1.7), or that it cannot be established yet;
  when the person is the only one who could, whom they will ask;
- the start and its language;
- for the `empty` start: the stages of the Organization's pipeline and their
  probabilities, its loss reasons, its salespeople, its currency and whether
  the App may look companies up in ARES. Take them from the person; whatever
  they do not change stays as the start has it (four open stages, won and
  lost, four reasons, CZK, ARES off), and they change it later under
  Nastavení / Settings;
- the pull requests that will wait for them.

Go on only after the person confirms this plan.

## 3. Create the Module and its data repository

From a task worktree of the Organization's root repository:

```bash
lazurio module create <Org>/<slug> --stack vite-react --teams <team,team> --data --dry-run
lazurio module create <Org>/<slug> --stack vite-react --teams <team,team> --data --confirm <plan>
```

This creates the private Module repository with the scaffold, the private data
repository `<slug>-data` on branch `v3` (initialised by `repository-db init`),
and declares both slots in the root worktree. The root's pull request is the
person's to merge.

## 4. Merge the release into the Module

In a worktree of the new Module, on a branch:

```bash
git fetch https://github.com/LazurioTemplates/deals.git "refs/tags/<tag>"
test "$(git rev-parse 'FETCH_HEAD^{commit}')" = "<commit>"
git merge --allow-unrelated-histories --no-ff --no-commit <commit>
```

The template's tree wins everywhere except the Organization's identity:

| File | Keep from the scaffold | Take from the template |
| --- | --- | --- |
| `lazurio.module.json` | `id`, `company`, `port_leases` | `apps`, `default_app` (both `app/v3/package.json`) |
| `app/v3/package.json` | `lazurio.runtime`: `id`, `company`, `module` | everything else: scripts, exact dependencies, `packageManager`, `title`, `description`, `dev_script`, `start_script`, `build_script`, `build_output`, the listener `app` with health `/healthz`, `preparation` |
| `app/v3/bun.lock`, `biome.json`, `tsconfig.json`, `vite.config.ts`, `src/`, `tests/`, `seed/` | | the template's |
| `.github/workflows/` | | the template's |
| `README.md`, `AGENTS.md` | | the template's; add a section "This Organization's copy" at the end of `AGENTS.md` |
| `.gitignore` | | the template's (it ignores `/db/`) |

Remove every file under `app/v3/` that only the scaffold had, whatever the
Lazurio release created (an `index.html`, `src/App.tsx`, `src/greeting.ts`,
`src/server.ts`, `src/app-server.ts`, `src/agent-tools.ts`,
`tests/store-contract.test.ts`, `seed/.gitkeep` and others): anything the
release does not have would still run in the Module's checks against the
template's code. In the Module's root, after the merge and before its commit:

```bash
git ls-files app/v3 | while IFS= read -r file; do
  git cat-file -e "<commit>:$file" 2>/dev/null || git rm -q -f -- "$file"
done
```

`git status` then shows no file under `app/v3/` that the release lacks. Then
set the Organization's identity:

- `app/v3/config/data-repository.json`: the `remote` of `<Org>/<slug>-data`
  exactly as `db/repository-db.yaml` names it, `branch: v3`;
- `app/v3/src/instance/brand.ts`: the Organization's display name;
- `AGENTS.md`, section "This Organization's copy": who reviews, where its data
  lives, its own sales rules (who owns which deals, the first stage, when a
  deal counts as lost), so the skills follow them;
- the design system: when the Organization has adopted and released its own
  design system, change the dependency in `app/v3/package.json` to
  `"design-system": "git+ssh://git@github.com/<Org>/design-system.git#v<version>"`
  and run `bun install` (commit `bun.lock`); otherwise keep
  `github:LazurioTemplates/design-system#v2.2.0` and tell the person the App
  shows the example brand until they have their own. A private
  design system cannot be installed by the Module's CI yet
  (Lazurio/LazurioPlatform#915): say so in the pull request, and run
  `bun run check` on the Environment. Both pins pass the Module's tests
  (`tests/design-system.test.ts`) as long as they name a released tag
  `v<major>.<minor>.<patch>` and `bun.lock` matches it;
- keep `LICENSE` and `NOTICE.md`: MIT requires the notices.

The template's own contract in `tests/template.test.ts` (the placeholder
identity, its public design system pin and the Marketplace screenshots) is skipped as soon as `company` in
`lazurio.module.json` is the Organization's; the module contract next to it
keeps running.

Commit the merge, then check that the release stays an ancestor; this is what
lets later releases arrive as ordinary merges:

```bash
git merge-base --is-ancestor <commit> HEAD
cd app/v3 && bun install --frozen-lockfile && bun run check && bun run build
```

Push the branch and open a pull request in the Module. Do not merge it.

## 5. Prepare the data repository

In a worktree of `<Org>/<slug>-data`, on a branch from `v3`:

- copy `templates/data-repo/` of the release: `schemas/`, `scripts/`,
  `.github/`, `.gitignore`, `README.md` and `AGENTS.md`;
- in `repository-db.yaml` keep `app` and `data_repo` as `lazurio module
  create` wrote them and take `schema`, `layout`, `generated_manifest` and
  `validate` from the template;
- copy the start into `data/`: `app/v3/seed/<cs|en>/<empty|sample>/` of the
  release becomes `data/` (`settings/`, `companies/`, `contacts/`, `deals/`,
  `activities/`);
- for the `empty` start, put what the person said into
  `data/settings/settings.yaml`: the stages (exactly one `won` with 100 and
  one `lost` with 0, at least one `open`), the loss reasons, the `owners`, the
  `currency` and `aresLookup`;
- run `bun scripts/validate.ts` there and, with the Module's worktree pointing
  `db/` at this branch, `bun run validate:db` in `app/v3` (the rules across
  records); push and open a pull request into `v3`.

## 6. After the person merges

- `lazurio module start <Org>/<slug>`, then open the App by its `runtime.url`
  and check the main path: a new company, a new deal of it, its move through
  the stages to won, the forecast and the statistics, all saved as a draft.
  Publishing that draft is a Publication into the Organization's data: only on
  the person's instruction, otherwise return it in "Koncept a publikování".
- **Last step: access of Teams.** Set or confirm which Teams reach the Module
  and its data the same way as for every Module, in the Organization overview
  (Přehled Organizace) of Lazurio. The Marketplace has no access list of its
  own. Change access only on the person's instruction.

## Handoff

Tell the person, with links: the root pull request (slots), the Module pull
request, the data pull request, what each waits for and who decides it, the
settings still left as the start had them, and any request prepared for
someone with more rights.
