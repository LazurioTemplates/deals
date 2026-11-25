# Contributing to Deals

Deals is a template: Organizations adopt a release and take later releases
by merging their tags. A contribution keeps that path working.

1. Read [`AGENTS.md`](AGENTS.md) and [`docs/extending.md`](docs/extending.md).
2. Decide where the change belongs: reusable App code, schemas, rules, tools,
   skills and starts here; an Organization's companies, contacts and deals in
   its own data repository.
3. Write every text people see in Czech and English, side by side
   (`t("Firmy", "Companies")`), and both starts of `app/v3/seed/`.
4. Work in a branch, run `bun run check` and `bun run build` in `app/v3`,
   and open a pull request with an entry under `## Unreleased` in
   `CHANGELOG.md`.
5. Keep data fictional and the license notices intact. Contributions are
   licensed under MIT, like the repository.

A change of a record schema is a change of the data contract: say in the pull
request how existing data repositories stay valid, or ship the migration. A
new tool for agents declares its `effect` honestly; a publication is a tool of
its own.
