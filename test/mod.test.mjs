// Tests for the behaviour of the @ovos-media fork, kept apart from the upstream tests to ease rebases.
import { deepStrictEqual, strictEqual } from 'node:assert'
import { describe, it } from 'node:test'
import { runInNewContext } from 'node:vm'
import { transformSync } from '@swc/core'
import { convertTsConfig } from '../dist/index.js'

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
						tsx: true,
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
						tsx: true,
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

	it('keeps dynamic imports of node module modes', () => {
		const config = convertTsConfig({ module: 'node16', target: 'es2022' })
		deepStrictEqual(JSON.parse(json(config.module)), {
			type: 'commonjs',
			ignoreDynamic: true,
		})
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

	it('writes overrides as given, even when they equal the swc defaults', () => {
		const config = convertTsConfig(
			{ target: 'es2022' },
			{ jsc: { externalHelpers: false, keepClassNames: false } },
		)
		strictEqual(config.jsc.externalHelpers, false)
		strictEqual(config.jsc.keepClassNames, false)
	})
})
