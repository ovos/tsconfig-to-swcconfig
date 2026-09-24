// Tests for the behaviour of the @ovos-media fork, kept apart from the upstream tests to ease rebases.
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { execFileSync } from 'node:child_process'
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { runInNewContext } from 'node:vm'
import { transformFileSync, transformSync } from '@swc/core'
import { convert, convertTsConfig } from '../dist/index.js'

const $schema = 'https://swc.rs/schema.json'
// the JSON written to a .swcrc: undefined values disappear, key order is kept
const json = (value) => JSON.stringify(value, null, 2)
const swcOptions = {
	filename: 'input.ts',
	sourceMaps: false,
	swcrc: false,
	configFile: false,
}

describe('cleaner convert', { concurrency: true }, () => {
	it('leaves out options equal to the swc defaults', () => {
		const config = convertTsConfig({
			target: 'es2022',
			module: 'commonjs',
			esModuleInterop: true,
			experimentalDecorators: true,
			sourceMap: true,
		})
		strictEqual(
			json(config),
			json({
				$schema,
				jsc: {
					target: 'es2022',
					experimental: { keepImportAttributes: true },
					parser: {
						syntax: 'typescript',
						decorators: true,
						dynamicImport: true,
					},
					transform: { legacyDecorator: true },
					keepClassNames: true,
				},
				module: { type: 'commonjs' },
				sourceMaps: true,
			}),
		)
	})

	it('writes the options that differ from the swc defaults', () => {
		const config = convertTsConfig({
			target: 'es5',
			module: 'commonjs',
			esModuleInterop: false,
			noImplicitUseStrict: true,
			importHelpers: true,
			emitDecoratorMetadata: true,
			verbatimModuleSyntax: true,
			rewriteRelativeImportExtensions: true,
			inlineSourceMap: true,
		})
		strictEqual(
			json(config),
			json({
				$schema,
				jsc: {
					externalHelpers: true,
					target: 'es5',
					experimental: { keepImportAttributes: true },
					parser: {
						syntax: 'typescript',
						decorators: true,
						dynamicImport: true,
					},
					transform: {
						decoratorVersion: '2023-11',
						decoratorMetadata: true,
						useDefineForClassFields: false,
						verbatimModuleSyntax: true,
					},
					rewriteRelativeImportExtensions: true,
				},
				module: { type: 'commonjs', strictMode: false, noInterop: true },
				sourceMaps: 'inline',
			}),
		)
	})

	it('writes source maps only when tsconfig asks for them', () => {
		for (const [tsOptions, expected] of [
			[{}, undefined],
			[{ sourceMap: false }, undefined],
			[{ sourceMap: true }, true],
			[{ inlineSourceMap: true }, 'inline'],
			[{ sourceMap: false, inlineSourceMap: true }, 'inline'],
		]) {
			strictEqual(
				convertTsConfig(tsOptions).sourceMaps,
				expected,
				JSON.stringify(tsOptions),
			)
		}
	})

	it('never writes ignoreDynamic for CommonJS output of node modules', () => {
		for (const module of ['node16', 'node18', 'node20', 'nodenext']) {
			const config = convertTsConfig({ module, target: 'es2022' })
			deepStrictEqual(
				JSON.parse(json(config.module)),
				{ type: 'commonjs' },
				module,
			)
		}
	})

	it('writes useDefineForClassFields only to opt out of defined class fields', () => {
		for (const [target, useDefineForClassFields, expected] of [
			['es2018', undefined, false],
			['es2021', false, false],
			['es2021', true, undefined],
			['es2022', undefined, undefined],
			['es2022', false, false],
			['esnext', undefined, undefined],
		]) {
			strictEqual(
				convertTsConfig({ target, useDefineForClassFields }).jsc.transform
					.useDefineForClassFields,
				expected,
				`${target} with useDefineForClassFields: ${useDefineForClassFields}`,
			)
		}
	})

	it('relies on swc defining class fields for every target when useDefineForClassFields is left out', () => {
		// the setter runs for assigned class fields, not for defined ones
		const source = `
			let calls = 0;
			class Base {}
			Object.defineProperty(Base.prototype, 'value', { set(v) { calls++; } });
			class Child extends Base { value = 1; }
			new Child();
			console.log(calls);
		`
		for (const target of ['es2018', 'es2022']) {
			const { code } = transformSync(source, {
				...swcOptions,
				jsc: { target, parser: { syntax: 'typescript' } },
			})
			const logs = []
			runInNewContext(code, { console: { log: (value) => logs.push(value) } })
			deepStrictEqual(logs, [0], target)
		}
	})

	it('writes the react options only when jsx is set', () => {
		const react = (tsOptions) =>
			JSON.parse(json(convertTsConfig(tsOptions).jsc.transform.react ?? null))
		strictEqual(react({ jsxFactory: 'h', jsxImportSource: 'preact' }), null)
		deepStrictEqual(react({ jsx: 'react' }), { throwIfNamespace: false })
		deepStrictEqual(
			react({ jsx: 'react', jsxFactory: 'h', jsxFragmentFactory: 'Fragment' }),
			{ throwIfNamespace: false, pragma: 'h', pragmaFrag: 'Fragment' },
		)
		deepStrictEqual(react({ jsx: 'react-jsxdev', jsxImportSource: 'preact' }), {
			throwIfNamespace: false,
			development: true,
			importSource: 'preact',
			runtime: 'automatic',
		})
		deepStrictEqual(react({ jsx: 'preserve' }), {
			throwIfNamespace: false,
			runtime: 'preserve',
		})
	})

	it('parses TSX only when jsx is set', () => {
		strictEqual(convertTsConfig({ jsx: 'react-jsx' }).jsc.parser.tsx, true)
		const config = convertTsConfig({ target: 'es2022', module: 'es2022' })
		strictEqual(config.jsc.parser.tsx, undefined)
		// valid TypeScript, but not valid TSX
		const source =
			'export const value = <number>JSON.parse("1"); export const id = <T>(value: T) => value;'
		for (const filename of ['input.ts', 'input.mts', 'input.cts', undefined]) {
			const { code } = transformSync(source, {
				...config,
				...swcOptions,
				filename,
			})
			strictEqual(
				runInNewContext(`${code.replace(/export /g, '')}; id(value)`),
				1,
				String(filename),
			)
		}
	})

	it('writes overrides as given, even when they equal the swc defaults', () => {
		const config = convertTsConfig(
			{ target: 'es2022' },
			{ jsc: { externalHelpers: false, keepClassNames: false } },
		)
		strictEqual(config.jsc.externalHelpers, false)
		strictEqual(config.jsc.keepClassNames, false)
	})
})

describe('portable .swcrc', { concurrency: true }, () => {
	const cli = resolve('dist/cli.js')
	// writes the given files (objects as JSON) into a new temporary directory
	const project = (t, files) => {
		const root = mkdtempSync(join(tmpdir(), 't2s-mod-'))
		t.after(() => rmSync(root, { recursive: true, force: true }))
		for (const [file, content] of Object.entries(files)) {
			mkdirSync(dirname(join(root, file)), { recursive: true })
			writeFileSync(
				join(root, file),
				typeof content === 'string' ? content : JSON.stringify(content),
			)
		}
		return root
	}
	// runs the CLI like the lint-staged hook: `-o` plus the staged tsconfig appended as a positional
	const generate = (cwd, args, output = '.swcrc') => {
		execFileSync(
			process.execPath,
			[cli, ...args, '-o', output, join(cwd, 'tsconfig.json')],
			{ cwd },
		)
		const text = readFileSync(resolve(cwd, output), 'utf8')
		return { text, swcrc: JSON.parse(text) }
	}
	const assertPortable = (root, text) => {
		ok(!text.includes(root), text)
		const strings = []
		JSON.parse(text, (_key, value) => {
			if (typeof value === 'string') strings.push(value)
			return value
		})
		for (const value of strings) ok(!isAbsolute(value), value)
	}

	it('writes baseUrl relative to the tsconfig, in the form tsconfig normalizes it to', (t) => {
		const root = project(t, {
			'app/tsconfig.json': {
				compilerOptions: {
					baseUrl: 'src/',
					paths: { '~common/*': ['../../common/src/*'] },
				},
			},
		})
		const { text, swcrc } = generate(join(root, 'app'), [])
		assertPortable(root, text)
		strictEqual(swcrc.jsc.baseUrl, './src')
		deepStrictEqual(swcrc.jsc.paths, { '~common/*': ['../../common/src/*'] })
	})

	it('writes baseUrl "./" when tsconfig has paths only, and keeps the paths as written', (t) => {
		const paths = {
			'~lib': ['../lib/src/'],
			'~lib/*': ['../lib/src/*'],
			'*': ['./src/*'],
		}
		const root = project(t, {
			'app/tsconfig.json': { compilerOptions: { paths } },
		})
		const { text, swcrc } = generate(join(root, 'app'), [])
		assertPortable(root, text)
		strictEqual(swcrc.jsc.baseUrl, './')
		deepStrictEqual(swcrc.jsc.paths, paths)
	})

	it('writes no baseUrl when tsconfig has neither baseUrl nor paths', (t) => {
		const root = project(t, {
			'app/tsconfig.json': { compilerOptions: { target: 'es2022' } },
		})
		const { swcrc } = generate(join(root, 'app'), [])
		strictEqual('baseUrl' in swcrc.jsc, false)
		strictEqual('paths' in swcrc.jsc, false)
	})

	it('rebases inherited paths and paths expanded from the configDir variable onto relative ones', (t) => {
		const root = project(t, {
			'base/tsconfig.json': {
				compilerOptions: {
					paths: { '@/*': ['./src/*'], '@lib': ['./lib/'] },
				},
			},
			'app/tsconfig.json': { extends: '../base/tsconfig.json' },
			'shared/tsconfig.json': {
				// biome-ignore lint/suspicious/noTemplateCurlyInString: the tsconfig variable, not a template
				compilerOptions: { paths: { '#/*': ['${configDir}/src/*'] } },
			},
			'app-configdir/tsconfig.json': {
				extends: '../shared/tsconfig.json',
			},
			'app-baseurl/tsconfig.json': {
				extends: '../shared/tsconfig.json',
				compilerOptions: { baseUrl: './src' },
			},
		})
		const inherited = generate(join(root, 'app'), [])
		assertPortable(root, inherited.text)
		strictEqual(inherited.swcrc.jsc.baseUrl, './')
		deepStrictEqual(inherited.swcrc.jsc.paths, {
			'@/*': ['../base/src/*'],
			'@lib': ['../base/lib/'],
		})
		const configDir = generate(join(root, 'app-configdir'), [])
		assertPortable(root, configDir.text)
		strictEqual(configDir.swcrc.jsc.baseUrl, './')
		deepStrictEqual(configDir.swcrc.jsc.paths, { '#/*': ['./src/*'] })
		const baseUrl = generate(join(root, 'app-baseurl'), [])
		assertPortable(root, baseUrl.text)
		strictEqual(baseUrl.swcrc.jsc.baseUrl, './src')
		deepStrictEqual(baseUrl.swcrc.jsc.paths, { '#/*': ['./*'] })
	})

	it('writes baseUrl relative to the output file, where swc resolves it from', (t) => {
		const root = project(t, {
			'app/tsconfig.json': {
				compilerOptions: { module: 'commonjs', paths: { '@/*': ['./src/*'] } },
			},
			'app/src/value.ts': 'export default 1;',
			'app/src/input.ts': 'import value from "@/value"; console.log(value);',
			'out/.gitkeep': '',
		})
		const { text, swcrc } = generate(join(root, 'app'), [], '../out/.swcrc')
		assertPortable(root, text)
		strictEqual(swcrc.jsc.baseUrl, '../app')
		const { code } = transformFileSync(join(root, 'app/src/input.ts'), {
			configFile: join(root, 'out/.swcrc'),
			sourceMaps: false,
		})
		ok(code.includes('require("./value")'), code)
	})

	it('turns aliased import() of node16 CommonJS output into require() of the rewritten path', (t) => {
		const root = project(t, {
			'app/package.json': {},
			'app/tsconfig.json': {
				compilerOptions: {
					module: 'node16',
					target: 'es2022',
					baseUrl: './src',
					paths: { '~lib/*': ['../lib/*'] },
				},
			},
			'app/src/entry.ts':
				'export const load = async () => [(await import("modules/search/Search")).Search, (await import("~lib/data.json")).default.value];',
			'app/src/modules/search/Search.ts': 'export const Search = 42;',
			'app/lib/data.json': '{ "value": 43 }',
		})
		const app = join(root, 'app')
		generate(app, [])
		for (const file of ['entry', 'modules/search/Search']) {
			const { code } = transformFileSync(join(app, 'src', `${file}.ts`), {
				configFile: join(app, '.swcrc'),
				sourceMaps: false,
			})
			mkdirSync(dirname(join(app, 'out', file)), { recursive: true })
			writeFileSync(join(app, 'out', `${file}.js`), code)
		}
		const entry = readFileSync(join(app, 'out/entry.js'), 'utf8')
		ok(entry.includes('require("./modules/search/Search")'), entry)
		ok(entry.includes('require("../lib/data.json")'), entry)
		const stdout = execFileSync(
			process.execPath,
			[
				'-e',
				'require("./out/entry.js").load().then((values) => console.log(JSON.stringify(values)))',
			],
			{ cwd: app, encoding: 'utf8' },
		)
		strictEqual(stdout.trim(), '[42,43]')
	})

	it('writes a baseUrl given with --set as it is', (t) => {
		const root = project(t, {
			'app/tsconfig.json': {
				compilerOptions: { baseUrl: './src', paths: { '@/*': ['./*'] } },
			},
		})
		for (const baseUrl of ['./', 'src', '/abs/src']) {
			const { swcrc } = generate(join(root, 'app'), [
				'-s',
				`jsc.baseUrl=${baseUrl}`,
			])
			strictEqual(swcrc.jsc.baseUrl, baseUrl)
			deepStrictEqual(swcrc.jsc.paths, { '@/*': ['./*'] })
		}
	})
})

// 2.8.0-mod.0 carried "fix: node16/nodenext must not be transpiled to es6", upstream covers it since 2.8.1
it('compiles node16 and nodenext to CommonJS unless package.json has type module', (t) => {
	const root = mkdtempSync(join(tmpdir(), 't2s-mod-'))
	t.after(() => rmSync(root, { recursive: true, force: true }))
	for (const [packageJson, expected, pattern] of [
		[{}, 'commonjs', /defineProperty\(exports, "value"/],
		[{ type: 'commonjs' }, 'commonjs', /defineProperty\(exports, "value"/],
		[{ type: 'module' }, 'nodenext', /export const value = /],
	]) {
		for (const module of ['node16', 'nodenext']) {
			const dir = mkdtempSync(join(root, 'package-'))
			writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson))
			writeFileSync(
				join(dir, 'tsconfig.json'),
				JSON.stringify({ compilerOptions: { module, target: 'es2022' } }),
			)
			const config = convert('tsconfig.json', dir)
			strictEqual(
				config.module?.type,
				expected,
				`${module} in ${packageJson.type}`,
			)
			const { code } = transformSync('export const value = 1;', {
				...config,
				...swcOptions,
				filename: join(dir, 'input.ts'),
			})
			ok(pattern.test(code), code)
		}
	}
})
