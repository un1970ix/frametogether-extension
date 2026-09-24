# FrameTogether Extension

Browser extension for synchronized video playback on MUBI. More platforms coming soon, hopefully. 😁

## License

See the [LICENSE](LICENSE) file for details.

## Server

See the [FrameTogether Server repository](https://github.com/un1970ix/frametogether-server) for a more detailed explanation.

Version 2 requires frametogether-server 0.2.0 or later. It sends a `Leave` message when you leave a room, which older servers do not handle.

## Build

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
