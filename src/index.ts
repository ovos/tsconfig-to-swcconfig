import path from 'node:path'
import Deepmerge from '@fastify/deepmerge'
import type * as swcType from '@swc/types'
import {
	createPathsMatcher,
	getTsconfig,
	type TsConfigJson,
} from 'get-tsconfig'
import { getPackageJson } from './utils'

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
	if (tsOptions.paths && !tsOptions.baseUrl && matchPaths) {
		tsOptions.paths = Object.fromEntries(
			Object.keys(tsOptions.paths).map((alias) => [
				alias,
				matchPaths(alias).map((value) => path.relative(configDir, value)),
			]),
		)
	}

	return convertTsConfig(tsOptions, swcOptions, configDir)
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
		sourceMap = 'inline', // notice here we default it to 'inline' instead of false
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

	const jsx = _jsx?.toLowerCase()
	const jsxRuntime: swcType.ReactConfig['runtime'] =
		jsx === 'preserve' || jsx === 'react-native'
			? 'preserve'
			: jsx === 'react-jsx' || jsx === 'react-jsxdev'
				? 'automatic'
				: undefined
	const jsxDevelopment: swcType.ReactConfig['development'] =
		jsx === 'react-jsxdev' ? true : undefined
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
		moduleConfig.strictMode = alwaysStrict || !noImplicitUseStrict
		moduleConfig.noInterop = !esModuleInterop
		moduleConfig.ignoreDynamic = nodeModules.includes(
			module?.toLowerCase() ?? '',
		)
	}

	const jsc = {
		externalHelpers: importHelpers,
		target: targetType(target),
		experimental: {
			// SWC rejects supplying both this option and its keepImportAssertions alias.
			keepImportAttributes:
				swcOptions.jsc?.experimental?.keepImportAssertions === undefined
					? true
					: undefined,
		},
		parser: {
			syntax: 'typescript',
			tsx: true,
			decorators: true,
			dynamicImport: true,
		},
		transform: {
			legacyDecorator: experimentalDecorators,
			decoratorVersion: experimentalDecorators ? '2021-12' : '2023-11',
			decoratorMetadata: emitDecoratorMetadata,
			useDefineForClassFields,
			verbatimModuleSyntax,
			react: {
				throwIfNamespace: false,
				development: jsxDevelopment,
				useBuiltins: false,
				pragma: jsxFactory,
				pragmaFrag: jsxFragmentFactory,
				importSource: jsxImportSource,
				runtime: jsxRuntime,
			},
		},
		keepClassNames: !['es3', 'es5', 'es6', 'es2015'].includes(
			target.toLowerCase(),
		),
		paths,
		baseUrl: baseUrl || paths ? path.resolve(cwd, baseUrl ?? '.') : undefined,
		rewriteRelativeImportExtensions,
	} satisfies swcType.JscConfig & {
		// Supported by SWC 1.16.2, not yet declared in @swc/types.
		rewriteRelativeImportExtensions?: boolean
	}

	const transformedOptions = deepmerge(
		{
			sourceMaps: inlineSourceMap ? 'inline' : sourceMap,
			module: moduleConfig,
			jsc,
		} satisfies swcType.Options,
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
