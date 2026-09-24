import path from 'node:path'
import Deepmerge from '@fastify/deepmerge'
import type * as swcType from '@swc/types'
import {
	createPathsMatcher,
	getTsconfig,
	type TsConfigJson,
} from 'get-tsconfig'
import { getPackageJson, relativePath } from './utils'

const deepmerge = Deepmerge()

// get-tsconfig's types do not yet include the TS 6/7 additions.
export type CompilerOptions = Omit<
	TsConfigJson.CompilerOptions,
	'target' | 'lib' | 'ignoreDeprecations'
> & {
	target?: TsConfigJson.CompilerOptions.Target | 'ES2025' | 'es2025'
	lib?: string[]
	ignoreDeprecations?: string
}

export function convert(
	/** filename to tsconfig */
	filename = 'tsconfig.json',
	/** cwd */
	cwd: string = process.cwd(),
	/** swc configs to override */
	swcOptions?: swcType.Options,
): swcType.Options {
	const result = getTsconfig(cwd, filename)
	const tsOptions = result?.config.compilerOptions ?? {}
	const configDir = result ? path.dirname(result.path) : cwd
	const matchPaths = result && createPathsMatcher(result)

	// Without baseUrl, inherited paths are relative to the config defining them.
	// They are rebased onto this config.
	// Paths defined in this config itself are kept as written.
	if (tsOptions.paths && !tsOptions.baseUrl && matchPaths) {
		tsOptions.paths = Object.fromEntries(
			Object.entries(tsOptions.paths).map(([alias, targets]) => [
				alias,
				matchPaths(alias).map((value, index) =>
					relativeTarget(configDir, value, targets[index]),
				),
			]),
		)
	}
	// With baseUrl, paths are relative to it, except absolute ones, e.g. expanded from `${configDir}`.
	if (tsOptions.paths && tsOptions.baseUrl) {
		const baseDir = path.resolve(configDir, tsOptions.baseUrl)
		tsOptions.paths = Object.fromEntries(
			Object.entries(tsOptions.paths).map(([alias, targets]) => [
				alias,
				targets.map((target) =>
					path.isAbsolute(target)
						? relativeTarget(baseDir, target, target)
						: target,
				),
			]),
		)
	}

	return convertTsConfig(tsOptions, swcOptions, configDir)
}

/** Keeps a paths target as written when it resolves from `dir`, otherwise makes it relative to `dir`. */
function relativeTarget(
	dir: string,
	resolved: string,
	written: string | undefined,
): string {
	if (
		written !== undefined &&
		!path.isAbsolute(written) &&
		path.resolve(dir, written) === path.resolve(resolved)
	) {
		return written
	}
	const relative = relativePath(dir, resolved)
	// e.g. "../lib/src/", resolving drops the trailing slash
	return written?.endsWith('/') && !relative.endsWith('/')
		? `${relative}/`
		: relative
}

export function convertTsConfig(
	tsOptions: CompilerOptions,
	swcOptions: swcType.Options = {},
	cwd: string = process.cwd(),
): swcType.Options {
	// https://json.schemastore.org/tsconfig
	const {
		module,
		esModuleInterop = nodeModules.includes(module?.toLowerCase() ?? ''),
		// no source maps unless tsconfig asks for them, like tsc
		sourceMap,
		inlineSourceMap = false,
		importHelpers = false,
		experimentalDecorators = false,
		emitDecoratorMetadata = false,
		target = 'es3',
		jsx: _jsx,
		jsxFactory = 'React.createElement',
		jsxFragmentFactory = 'React.Fragment',
		jsxImportSource = 'react',
		alwaysStrict = false,
		noImplicitUseStrict = false,
		paths,
		baseUrl,
		useDefineForClassFields = [
			'es2022',
			'es2023',
			'es2024',
			'es2025',
			'esnext',
		].includes(target.toLowerCase()),
		verbatimModuleSyntax,
		rewriteRelativeImportExtensions,
	} = tsOptions

	// Options equal to the swc defaults are left out (set to undefined), so the generated config only lists what matters.
	const jsx = _jsx?.toLowerCase()
	const jsxRuntime: swcType.ReactConfig['runtime'] =
		jsx === 'preserve' || jsx === 'react-native'
			? 'preserve'
			: jsx === 'react-jsx' || jsx === 'react-jsxdev'
				? 'automatic'
				: undefined
	const jsxDevelopment: swcType.ReactConfig['development'] =
		jsx === 'react-jsxdev' ? true : undefined
	// TypeScript compiles JSX only when `jsx` is set, so the react options are written only then.
	const react: swcType.ReactConfig | undefined = jsx
		? {
				// TypeScript accepts namespaced JSX tags, swc throws on them by default
				throwIfNamespace: false,
				development: jsxDevelopment,
				pragma: jsxFactory !== 'React.createElement' ? jsxFactory : undefined,
				pragmaFrag:
					jsxFragmentFactory !== 'React.Fragment'
						? jsxFragmentFactory
						: undefined,
				importSource: jsxImportSource !== 'react' ? jsxImportSource : undefined,
				runtime: jsxRuntime,
			}
		: undefined
	const type = moduleType(module, cwd, swcOptions.filename)
	const moduleConfig: swcType.ModuleConfig | undefined = type
		? { type }
		: undefined
	if (
		moduleConfig &&
		(moduleConfig.type === 'commonjs' ||
			moduleConfig.type === 'amd' ||
			moduleConfig.type === 'umd')
	) {
		moduleConfig.strictMode =
			alwaysStrict || !noImplicitUseStrict ? undefined : false
		moduleConfig.noInterop = esModuleInterop ? undefined : true
		// `ignoreDynamic` is never written, even though tsc keeps `import()` in CommonJS output of node modules:
		// swc would then also skip the `jsc.paths` and `baseUrl` rewriting in them, which breaks aliased imports at runtime.
		// Without it, swc turns `import()` into a `require()` of the rewritten path.
	}
	// The module type of the output after the overrides.
	// `--set module=undefined` leaves the swc default, ES modules.
	const outputType =
		'module' in swcOptions && !swcOptions.module
			? undefined
			: (swcOptions.module?.type ?? type)

	const jsc = {
		externalHelpers: importHelpers || undefined,
		target: targetType(target),
		// Import attributes change nothing in CommonJS output, where imports become `require()` calls.
		// SWC rejects supplying both this option and its keepImportAssertions alias.
		experimental:
			outputType !== 'commonjs' &&
			swcOptions.jsc?.experimental?.keepImportAssertions === undefined
				? { keepImportAttributes: true }
				: undefined,
		parser: {
			syntax: 'typescript',
			// swc picks TSX for .tsx files and plain TypeScript for .ts files by itself, but applies this flag to
			// .mts, .cts and extensionless input, where TSX would break `<T>value` assertions and `<T>() =>` generics
			tsx: jsx ? true : undefined,
			decorators: true,
			dynamicImport: true,
		},
		transform: {
			legacyDecorator: experimentalDecorators || undefined,
			// '2021-12' is the swc default
			decoratorVersion: experimentalDecorators ? undefined : '2023-11',
			decoratorMetadata: emitDecoratorMetadata || undefined,
			// swc defines class fields for every target, so only the opt-out has to be written
			useDefineForClassFields: useDefineForClassFields ? undefined : false,
			verbatimModuleSyntax: verbatimModuleSyntax || undefined,
			react,
		},
		keepClassNames:
			!['es3', 'es5', 'es6', 'es2015'].includes(target.toLowerCase()) ||
			undefined,
		paths,
		baseUrl: baseUrl || paths ? path.resolve(cwd, baseUrl ?? '.') : undefined,
		rewriteRelativeImportExtensions:
			rewriteRelativeImportExtensions || undefined,
	} satisfies swcType.JscConfig & {
		// Supported by SWC 1.16.2, not yet declared in @swc/types.
		rewriteRelativeImportExtensions?: boolean
	}

	const transformedOptions = deepmerge(
		// keys in the order of the 2.8.0-mod.0 output, so regenerated .swcrc files keep their layout
		{
			$schema: 'https://swc.rs/schema.json',
			jsc,
			module: moduleConfig,
			sourceMaps: (inlineSourceMap ? 'inline' : sourceMap) || undefined,
		} satisfies swcType.Options & { $schema: string },
		swcOptions,
	)

	return transformedOptions
}

const nodeModules = ['node16', 'node18', 'node20', 'nodenext']

function moduleType(
	m: TsConfigJson.CompilerOptions.Module | undefined,
	cwd: string,
	filename?: string,
): swcType.ModuleConfig['type'] | undefined {
	const module = m?.toLowerCase()
	if (module === 'preserve' || module === 'none') {
		return undefined
	}
	if (module === 'system') {
		return 'systemjs'
	}
	if (module === 'commonjs' || module === 'amd' || module === 'umd') {
		return module
	}

	const es6Modules = ['es6', 'es2015', 'es2020', 'es2022', 'esnext']
	if (es6Modules.includes(module ?? '')) {
		return 'es6'
	}

	if (nodeModules.includes(module ?? '')) {
		if (filename) {
			const extension = path.extname(filename)
			if (extension === '.mts' || extension === '.mjs') return 'nodenext'
			if (extension === '.cts' || extension === '.cjs') return 'commonjs'
			cwd = path.dirname(path.resolve(cwd, filename))
		}
		return getPackageJson(cwd)?.type === 'module' ? 'nodenext' : 'commonjs'
	}

	return 'commonjs'
}

function targetType(t: string): swcType.JscTarget {
	const ret = t.toLowerCase()
	// ES2025 adds library APIs, but no syntax beyond ES2024. SWC has no es2025 target.
	if (ret === 'es2025') return 'es2024'
	return ret === 'es6' ? 'es2015' : (ret as swcType.JscTarget)
}
