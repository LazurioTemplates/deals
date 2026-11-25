# Security

## Reporting

Report a vulnerability privately through GitHub's "Report a vulnerability"
on this repository. Do not open a public issue for it.

## What the App defends

- **Who came is Lazurio's to say.** Every request reads the application role
  through `appAccess` of `@lazurio/module-kit`, never cached; without a role
  the API, `/mcp` and the page's tools refuse. A copy of the App writes only
  where the application host says so (`LAZURIO_RUNTIME_DATA_WRITER=true`); a
  production runtime without it never writes, and a copy that may not write
  never fetches, pulls or publishes either.
- **Writes come only from the App itself.** Every writing API request must be
  `application/json` and carry an `Origin` of the App's own listener (loopback
  or the hosted origin Lazurio passes). A foreign `Host` is refused.
- **The App serves one data repository.** The sync host refuses a checkout
  whose configuration names another remote or branch, or whose real path lies
  outside the Module (`boundary_violation`).
- **No Git and no paths of its own on the data.** Records are read and written
  only through repository-db (`Collection`, `readDataFile`), which refuses
  symbolic links and paths outside the checkout. A save names the revision it
  was edited from; a stale save is refused. Every write checks and writes
  under repository-db's draft write gate.
- **Publishing is one validated commit.** The rules across records gate a
  publication, and repository-db runs the data repository's validator before
  every publish. Who may publish to the data repository is decided by the
  person's live GitHub rights on it; the App keeps no roster, token or key.
- **Agents publish only as a separate step.** Every tool for agents calls the
  App's own API with the caller's request; a publication is the one tool
  `publish_draft` with `effect: "publish"` and `destructiveHint`, audited as
  such. Text from records is marked as untrusted content for agents.
- **ARES only through the server.** The page never calls another origin. The
  server checks the IČO before it asks ARES, waits at most 5 s, keeps answers
  24 hours and sends at most 30 questions a minute; the lookup is off until
  the Organization turns it on in the settings.
- **No secrets.** The App declares none, reads no `.env` file and stores no
  credential. Git transport uses the Environment's own sign-in.

## Out of scope

Roles inside the App: an Application User and an Application Admin have the
same rights. An Organization that needs finer roles adds them in its copy.
Access is decided by the application roles Lazurio grants and by GitHub
rights on the data repository.
