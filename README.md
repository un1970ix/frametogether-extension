# FrameTogether Extension

Browser extension for synchronized video playback on MUBI. More platforms coming soon, hopefully. 😁

## License

See the [LICENSE](LICENSE) file for details.

## Server

See the [FrameTogether Server repository](https://github.com/un1970ix/frametogether-server) for a more detailed explanation.

Version 2 requires frametogether-server 0.2.0 or later. It sends a `Leave` message when you leave a room, which older servers do not handle.

## Build

Use the Bun version in `.bun-version`.

Install dependencies.

```bash
bun install
```

Build for Chrome.

```bash
bun run build
```

Build for Firefox.

```bash
bun run build:firefox
```

## Development

Start in watch mode.

```bash
bun run dev
```

Load the `dist` directory as an unpacked extension.

## Testing

```bash
bun run typecheck
bun test
```

## Publishing

The publishing workflow requires the `store-release` environment. Configure
`CHROME_PUBLISHER_ID` and `CHROME_EXTENSION_ID` as GitHub Actions variables, and
`CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`,
`AMO_JWT_ISSUER`, and `AMO_JWT_SECRET` as secrets. Find the publisher ID in the
Chrome Web Store developer dashboard. Both stores must be configured before
either upload starts. Dependency audits report findings and errors without
blocking checks or publishing.

Use a manual workflow run to retry either store independently. A Chrome
publication failure does not prevent the validated Firefox package from being
submitted.
