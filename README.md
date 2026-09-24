# tsconfig-to-swcconfig

[![NPM version](https://img.shields.io/npm/v/tsconfig-to-swcconfig.svg?style=flat)](https://npmjs.org/package/tsconfig-to-swcconfig)
[![NPM downloads](https://img.shields.io/npm/dm/tsconfig-to-swcconfig.svg?style=flat)](https://npmjs.org/package/tsconfig-to-swcconfig)

Convert tsconfig to swc config.

> Why?
>
> (https://github.com/swc-project/swc/issues/1348)
>
> `swc` has no plans to support `tsconfig.json`, but it could be useful in some cases. For example, migrating from `tsc` to `swc` in a large project, you can use this tool to convert `tsconfig.json` to `.swcrc`, and then modify the `.swcrc` to make it work.

## `@ovos-media/tsconfig-to-swcconfig`

This is a fork of [tsconfig-to-swcconfig](https://github.com/Songkeys/tsconfig-to-swcconfig), published as `@ovos-media/tsconfig-to-swcconfig`. Version `3.0.0-mod.0` is upstream `v3.0.0` with these changes:

- The CLI accepts positional arguments and ignores them, so lint-staged can append the staged file paths.
- The output leaves out values equal to swc's defaults, keeps `$schema` and a stable key order, writes the react block and `tsx` only with `jsx`, and writes `useDefineForClassFields` only when it is `false`. Source maps are not generated unless the tsconfig asks for them.
- Generated `.swcrc` files are portable: `jsc.baseUrl` and `jsc.paths` are relative (`./src`, `./`), never absolute. Without a `baseUrl`, `paths` come with `"baseUrl": "./"`, which swc needs to apply them.
- `module.ignoreDynamic` is never written, so a dynamic `import()` in CommonJS output keeps compiling to `require()` and the path aliases in it are rewritten. Upstream keeps it a native `import()` in Node modes, which fails at runtime for aliased specifiers.
- `jsc.experimental.keepImportAttributes` is written only for output other than CommonJS, where it changes nothing.

## Install

```bash
npm i tsconfig-to-swcconfig
```

Version 3 requires Node.js 22 or newer and generates configurations for `@swc/core` 1.16.2 or newer. Install SWC in the project that compiles your code; it is an optional peer dependency so the converter's CLI can also be used on its own.

## Usage

## Convert config in a tsconfig file

```typescript
import { convert } from 'tsconfig-to-swcconfig'

const swcConfig = convert() // will look for tsconfig under the cwd and convert it to swc config
```

Advanced options:

```typescript
import { convert } from 'tsconfig-to-swcconfig'

convert('tsconfig-filename.json', process.cwd(), {
  // more swc config to override...
  minify: true,
})
```

## Convert tsconfig value

Convert tsconfig value directly:

```typescript
import { convertTsConfig } from 'tsconfig-to-swcconfig'

const swcConfig = convertTsConfig({
  module: 'commonjs',
  target: 'es2018',
  strict: true,
  esModuleInterop: true,
})
```

Advanced usage:

```typescript
import { convertTsConfig } from 'tsconfig-to-swcconfig'

const swcConfig = convertTsConfig(
  { target: 'es2018' }, // tsconfig
  { minify: true }, // more swc config to override...
)
```

For Node module modes, pass the source filename through the SWC options when a project contains `.mts`, `.cts`, or nested `package.json` files:

```typescript
const swcConfig = convert('tsconfig.json', process.cwd(), {
  filename: '/path/to/project/src/entry.mts',
})
```

The converter uses that file's extension and nearest `package.json` to select its module format. Without a source filename, it uses the config directory for `convert()` or `cwd` for `convertTsConfig()`. A single generated `.swcrc` cannot choose different module formats for every file in a mixed project; convert each file with its filename or provide separate SWC configurations.

Both APIs resolve `jsc.baseUrl` to an absolute path so the result can be passed directly to SWC. `convert()` resolves paths relative to their tsconfig, including inherited `paths` without `baseUrl`. For an options object, use the third `convertTsConfig(options, overrides, cwd)` argument to specify the base directory. Explicit SWC overrides are still merged last.

For Jest and React Native projects, see the [Jest guide](docs/jest.md) for module mocks and a configuration that keeps React Native's Babel transforms.

## CLI

To use the CLI, install globally:

```bash
npm i -g tsconfig-to-swcconfig
```

Then run:

```bash
tsconfig-to-swcconfig --help
```

```bash
Usage: tsconfig-to-swcconfig [options]
Alias: t2s [options]

Options:
  -f, --filename <filename>  filename to tsconfig (default: "tsconfig.json")
  -c, --cwd <cwd>            cwd (default: process.cwd())
  -o, --output <output>      output file (default: stdout)
  -s, --set <name>=<value>   set additional swcrc options
  -h, --help                 display help for command
```

Instead of installing globally, you can also use `npx` to run the CLI without installing:

```bash
npx tsconfig-to-swcconfig -f tsconfig.json -c /path/to/project -o /path/to/project/.swcrc
```

The CLI writes JSON. Generated `baseUrl` values are relative to the output file, or to `--cwd` when printing to stdout, so the configuration can move with your project. An explicit `--set jsc.baseUrl=...` is preserved.

## Migrating from 2.x

- Upgrade your consuming project's SWC to 1.16.2 or newer and run Node.js 22 or newer.
- API results now contain absolute `baseUrl` values. Use the CLI to generate portable `.swcrc` files.
- `jsx: "preserve"` and `"react-native"` now leave JSX intact. If your next build step expects JavaScript, select a React runtime in tsconfig or override `jsc.transform.react.runtime`.
- Class field and import-preservation options are now honored, so emitted code can change to match the requested behavior.
- Standard decorators are enabled when `experimentalDecorators` is off. Keep `experimentalDecorators: true` for legacy decorators and `emitDecoratorMetadata`.
- `module: "preserve"` no longer emits CommonJS, and Node modes honor a supplied source filename. Upstream Node modes also retain dynamic `import()`, this fork does not (see above).

## Development and releases

Run `npm ci`, `npm run lint`, and `npm test`. CI runs on Node.js 22, 24, and 26 and checks the package with `npm pack --dry-run`. Packing automatically builds `dist`.

Use `npm version patch` (or `minor` / `major`) to update the version, lockfile, and Git tag together. Pushing a `v*` tag triggers lint, tests, a version check, npm publishing through OIDC, and GitHub release notes.

Before publishing, configure an [npm trusted publisher](https://docs.npmjs.com/trusted-publishers/) for `songkeys/tsconfig-to-swcconfig`, workflow `release.yml`, with permission to run `npm publish`. No environment name or npm token is required.

## License

MIT
