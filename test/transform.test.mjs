import { deepStrictEqual, doesNotMatch, match, strictEqual } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { it } from 'node:test'
import { runInNewContext } from 'node:vm'
import { transformSync } from '@swc/core'
import { convertTsConfig } from '../dist/index.js'

const swcOptions = {
	filename: 'input.tsx',
	sourceMaps: false,
	swcrc: false,
	configFile: false,
}

it('preserves mixed ESM and CommonJS syntax with module:preserve', () => {
	const config = convertTsConfig(
		{ module: 'preserve', target: 'es2025' },
		swcOptions,
	)
	const { code } = transformSync(
		'import { x } from "./esm.js"; import y = require("./cjs.cjs"); export const value = x + y;',
		config,
	)
	match(code, /import \{ x \} from/)
	match(code, /const y = require\(/)
	match(code, /export const value/)
	const assignment = transformSync(
		'import x = require("./dep.cjs"); export = x;',
		config,
	)
	match(assignment.code, /module.exports = x/)
	doesNotMatch(assignment.code, /export \{/)
})

it('compiles ES modules and SystemJS with valid SWC options', () => {
	for (const [module, pattern] of [
		['esnext', /export const value/],
		['system', /System.register/],
	]) {
		const { code } = transformSync(
			'export const value = 1;',
			convertTsConfig({ module, target: 'es2022' }, swcOptions),
		)
		match(code, pattern)
	}
})

it('preserves Node dynamic imports and implicit CommonJS interop', (t) => {
	const cwd = mkdtempSync(join(tmpdir(), 't2s-node-'))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	writeFileSync(
		join(cwd, 'dep.mjs'),
		'await Promise.resolve(); export const value = 42;',
	)
	writeFileSync(join(cwd, 'dep.cjs'), 'module.exports = { offset: 1 };')
	for (const module of ['node16', 'node18', 'node20', 'nodenext']) {
		const { code } = transformSync(
			'import dep from "./dep.cjs"; import assigned = require("./dep.cjs"); export const load = async () => ({ value: (await import("./dep.mjs")).value + dep.offset + assigned.offset });',
			convertTsConfig(
				{ module, target: 'es2022', rewriteRelativeImportExtensions: true },
				swcOptions,
				cwd,
			),
		)
		writeFileSync(join(cwd, 'entry.cjs'), code)
		const stdout = execFileSync(
			process.execPath,
			['-e', 'require("./entry.cjs").load().then(m => console.log(m.value))'],
			{ cwd, encoding: 'utf8' },
		)
		strictEqual(stdout.trim(), '44')
	}
})

it('preserves JSON import attributes and honors explicit overrides', (t) => {
	const cwd = mkdtempSync(join(tmpdir(), 't2s-json-'))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	writeFileSync(join(cwd, 'data.json'), '{"value":42}')
	const source =
		'import data from "./data.json" with { type: "json" }; console.log(data.value);'
	const options = { ...swcOptions, filename: join(cwd, 'input.mts') }
	for (const module of ['node18', 'node20', 'nodenext', 'esnext', 'preserve']) {
		const { code } = transformSync(
			source,
			convertTsConfig({ module, target: 'es2025' }, options),
		)
		const output = join(cwd, 'input.mjs')
		writeFileSync(output, code)
		strictEqual(
			execFileSync(process.execPath, [output], { encoding: 'utf8' }).trim(),
			'42',
		)
	}
	for (const key of ['keepImportAttributes', 'keepImportAssertions']) {
		const { code } = transformSync(
			source,
			convertTsConfig(
				{ module: 'nodenext', target: 'es2025' },
				{ ...options, jsc: { experimental: { [key]: false } } },
			),
		)
		doesNotMatch(code, /with\s*\{/)
	}
})

it('uses source extensions and the nearest package for Node module formats', () => {
	const esm = resolve(
		import.meta.dirname,
		'fixtures/tsconfig-with-package-json',
	)
	for (const module of ['node16', 'node18', 'node20', 'nodenext']) {
		for (const [filename, pattern] of [
			[join(esm, 'input.cts'), /exports/],
			[join(esm, 'input.ts'), /export const/],
			[resolve(import.meta.dirname, 'input.mts'), /export const/],
		]) {
			const { code } = transformSync(
				'export const value = 1;',
				convertTsConfig(
					{ module, target: 'es2022' },
					{ ...swcOptions, filename },
				),
			)
			match(code, pattern)
		}
	}
	const { code } = transformSync(
		'import fs = require("node:fs"); export { fs };',
		convertTsConfig(
			{ module: 'nodenext', target: 'es2022' },
			{
				...swcOptions,
				filename: join(esm, 'input.mts'),
			},
		),
	)
	match(code, /createRequire/)
})

it('honors class field assignment and definition semantics', () => {
	const source = `
		let calls = 0;
		class Base {}
		Object.defineProperty(Base.prototype, 'value', { set(v) { calls++; } });
		class Child extends Base { value = 1; }
		new Child();
		console.log(calls);
	`
	for (const [target, useDefineForClassFields, expected] of [
		['es2022', false, 1],
		['es2018', undefined, 1],
		['es2018', true, 0],
	]) {
		const { code } = transformSync(
			source,
			convertTsConfig(
				{ module: 'commonjs', target, useDefineForClassFields },
				swcOptions,
			),
		)
		const logs = []
		runInNewContext(code, { console: { log: (value) => logs.push(value) } })
		deepStrictEqual(logs, [expected])
	}
})

it('retains side-effectful imports with verbatimModuleSyntax', () => {
	const { code } = transformSync(
		'import { setup } from "./setup.js"; import { type X } from "./types.js"; export const value = 1;',
		convertTsConfig(
			{ module: 'esnext', target: 'es2022', verbatimModuleSyntax: true },
			swcOptions,
		),
	)
	match(code, /from "\.\/setup.js"/)
	match(code, /import "\.\/types.js"/)
})

it('preserves JSX or selects the requested React runtime', () => {
	for (const [jsx, pattern] of [
		['preserve', /<div\/>/],
		['react-native', /<div\/>/],
		['react', /React.createElement/],
		['react-jsx', /react\/jsx-runtime/],
		['react-jsxdev', /react\/jsx-dev-runtime/],
	]) {
		const { code } = transformSync(
			'export const view = <div />;',
			convertTsConfig({ module: 'esnext', target: 'es2022', jsx }, swcOptions),
		)
		match(code, pattern)
	}
})

it('retains legacy decorators and emitted metadata when explicitly enabled', () => {
	const { code } = transformSync(
		'function decorate(...args: any[]) {} class C { @decorate method(value: number) {} }',
		convertTsConfig(
			{
				target: 'es2022',
				experimentalDecorators: true,
				emitDecoratorMetadata: true,
			},
			swcOptions,
		),
	)
	const metadata = []
	runInNewContext(code, {
		Reflect: {
			metadata: (key) => () => {
				metadata.push(key)
			},
		},
	})
	deepStrictEqual(metadata, [
		'design:returntype',
		'design:paramtypes',
		'design:type',
	])
})

it('honors inline source maps and explicit SWC overrides', () => {
	const { code } = transformSync(
		'const value = 1;',
		convertTsConfig(
			{ sourceMap: false, inlineSourceMap: true },
			{ filename: 'input.ts' },
		),
	)
	match(code, /sourceMappingURL=data:/)
	const config = convertTsConfig(
		{ module: 'preserve', jsx: 'preserve', useDefineForClassFields: false },
		{
			...swcOptions,
			module: { type: 'commonjs' },
			jsc: {
				transform: {
					react: { runtime: 'automatic' },
					useDefineForClassFields: true,
				},
			},
		},
	)
	const output = transformSync('export const view = <div />;', config)
	match(output.code, /require\("react\/jsx-runtime"\)/)
	strictEqual(config.jsc.transform.useDefineForClassFields, true)
})
