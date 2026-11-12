# Releasing

For the maintainer. Releases run only in CI: the Developer ID signature never happens on a local
machine. The maintainer checks a candidate and approves every run in the `release` environment.

## What a release produces

A tag `v<version>` runs `.github/workflows/release.yml`. After approval in the `release`
environment the run:

1. checks that the tag matches `package.json`, is not a prerelease, that `server.json` agrees,
   and that the tagged commit is on `main` (`scripts/release/check-tag.sh`);
2. runs typecheck, vitest and the TypeScript build;
3. fails early if a signing secret is missing (`require-env.sh`, prints `Missing secret: NAME`);
4. imports the Developer ID certificate into a temporary keychain (`import-signing.sh`; the
   `.p12` lives in `$RUNNER_TEMP` under `umask 077` and is removed by a `trap`);
5. builds the universal helper `bin/calendar-helper` with `CODESIGN_IDENTITY` set to the
   Developer ID, so a missing certificate fails the build instead of falling back to ad hoc, then
   removes the keychain at once (`cleanup-keychain.sh`);
6. notarizes the helper with the App Store Connect API key and requires the status `Accepted`
   (`notarize.sh`). A bare binary cannot be stapled; the submitted ZIP becomes the release asset
   `calendar-helper.zip`;
7. verifies the helper: both architectures, identifier, Developer ID authority, team, hardened
   runtime, calendar entitlement, the release requirement (`verify-helper.sh`, prints the CDHash);
8. packs the npm tarball and checks the unpacked copy: helper present and executable, nothing
   else under `bin/`, valid signature, same CDHash (`verify-npm-pack.sh`);
9. attests `calendar-helper.zip`;
10. publishes the tarball to npm with provenance and creates the GitHub release with
    `calendar-helper.zip` and `SHA256SUMS` (`publish.sh`; a re-run skips what is already out);
11. publishes `server.json` to the MCP Registry (`scripts/publish-registry.sh`);
12. runs `cleanup-keychain.sh` again as a fallback, also after a failure.

Tags with a prerelease version such as `v0.3.0-rc.1` are refused. Candidates come from the
release candidate workflow.

## Release candidate

`.github/workflows/release-candidate.yml` runs on `workflow_dispatch`, in the same `release`
environment and with the same scripts. It sets the version to `<version>-rc.<run number>`
without committing it, runs steps 2 to 9 and uploads `calendar-helper.zip` and the npm tarball as
the artifact `release-candidate-<run number>` (kept 14 days). It publishes nothing.

## Cutting a release

1. Dispatch the release candidate workflow on `main` and check the artifact on a Mac.
2. `npm version <patch|minor|major>` on `main`; the `version` hook keeps `server.json` in step.
3. `git push --follow-tags`.
4. Approve the run in the `release` environment.

If the run fails after npm publish, re-run the failed job: `publish.sh` skips the npm version
that is already out and leaves a complete GitHub release unchanged. If only the registry step
failed, run the `MCP Registry` workflow.

## One-time setup

Done by the maintainer in the GitHub and npm settings:

- Environment `release`: the maintainer as required reviewer, deployments only from tags `v*`
  (and the default branch, for the candidate workflow).
- Environment secrets: `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`. The API key is the one
  shared with apple-mail-mcp (role Developer).
- Tag ruleset for `refs/tags/v*`: only admins create, update or delete.
- npm trusted publisher for `@redpop/apple-calendar-mcp`: workflow `release.yml`, environment
  empty or `release`. Any other environment name makes the OIDC publish fail after notarization.
- Delete the repository secrets `APPLE_ID` and `APPLE_APP_PASSWORD` and revoke the app-specific
  password at appleid.apple.com.
