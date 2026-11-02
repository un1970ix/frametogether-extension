set shell := ["sh", "-eu", "-c"]
set positional-arguments

[doc("List the available recipes.")]
default:
    @just --list

[doc("Install the locked dependencies.")]
setup:
    bun install --frozen-lockfile

[doc("Check types for the extension and publishing scripts.")]
check:
    bun run typecheck

[doc("Run the extension and publishing tests.")]
test *args:
    bun test "$@"

[doc("Build the Chrome and Firefox extensions.")]
build: build-chrome build-firefox

[doc("Build the Chrome extension.")]
build-chrome:
    bun run build

[doc("Build the Firefox extension.")]
build-firefox:
    bun run build:firefox

[doc("Build and lint the Firefox extension.")]
lint: build-firefox
    bun run lint:ext

[doc("Build the Chrome extension and watch for changes.")]
dev:
    bun run dev

[doc("Audit dependencies for vulnerabilities.")]
audit:
    bun audit --audit-level=moderate

[doc("Report audit failures without blocking later commands.")]
audit-report:
    just audit || printf '%s\n' 'Warning: Dependency audit failed; continuing.' >&2

[doc("Validate the extensions without publishing them.")]
deploy-check: check test build audit-report
    bun run lint:ext
