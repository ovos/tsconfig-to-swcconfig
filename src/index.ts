import Deepmerge from '@fastify/deepmerge'
import type swcType from '@swc/core'
import { type TsConfigJson } from 'get-tsconfig'
import { getPackageJson, getTSOptions } from './utils'

const deepmerge = Deepmerge()

export function convert(
	/** filename to tsconfig */
	filename = 'tsconfig.json',
	/** cwd */
	cwd: string = process.cwd(),
	/** swc configs to override */
	swcOptions?: swcType.Options,
): swcType.Options {
	const tsOptions = getTSOptions(filename, cwd) ?? {}
	return convertTsConfig(tsOptions, swcOptions, cwd)
}

export function convertTsConfig(
	tsOptions: TsConfigJson.CompilerOptions,
	swcOptions: swcType.Options = {},
	cwd: string = process.cwd(),
): swcType.Options {
	// https://json.schemastore.org/tsconfig
	const {
		esModuleInterop,
		sourceMap,
		importHelpers,
		experimentalDecorators,
		emitDecoratorMetadata,
		target = 'es3',
		module,
		jsx: _jsx,
		jsxFactory: _jsxFactory,
		jsxFragmentFactory: _jsxFragmentFactory,
		jsxImportSource: _jsxImportSource,
		alwaysStrict,
		noImplicitUseStrict,
		paths,
		baseUrl,
		useDefineForClassFields: _useDefineForClassFields,
	} = tsOptions

	const jsx = (_jsx as unknown as string)?.toLowerCase()
	const jsxFactory: swcType.ReactConfig['pragma'] =
		_jsxFactory !== 'React.createElement' ? _jsxFactory : undefined
	const jsxFragmentFactory: swcType.ReactConfig['pragmaFrag'] =
		_jsxFragmentFactory !== 'React.Fragment' ? _jsxFragmentFactory : undefined
	const jsxImportSource: swcType.ReactConfig['importSource'] =
		_jsxImportSource !== 'react' ? _jsxImportSource : undefined
	const jsxRuntime: swcType.ReactConfig['runtime'] =
		jsx === 'react-jsx' || jsx === 'react-jsxdev' ? 'automatic' : undefined
	const jsxDevelopment: swcType.ReactConfig['development'] =
		jsx === 'react-jsxdev' ? true : undefined
	const react =
		jsxDevelopment ||
		jsxFactory ||
		jsxFragmentFactory ||
		jsxImportSource ||
		jsxRuntime
	// https://swc.rs/docs/migrating-from-tsc#usedefineforclassfields
	const defaultUseDefineForClassFields = ![
		'es3',
		'es5',
		'es6',
		'es2015',
		'es2016',
		'es2017',
		'es2018',
		'es2019',
		'es2020',
		'es2021',
	].includes(target.toLowerCase())
	const useDefineForClassFields =
		_useDefineForClassFields !== defaultUseDefineForClassFields
			? _useDefineForClassFields
			: undefined

	const transformedOptions = deepmerge(
		{
			$schema: 'https://swc.rs/schema.json',
			jsc: {
				externalHelpers: importHelpers || undefined,
				target: targetType(target),
				parser: {
					syntax: 'typescript',
					tsx: jsx ? true : undefined,
					decorators: experimentalDecorators || undefined,
					dynamicImport: true,
				},
				transform: {
					legacyDecorator: true,
					decoratorMetadata: emitDecoratorMetadata || undefined,
					react: react
						? {
								development: jsxDevelopment,
								pragma: jsxFactory,
								pragmaFrag: jsxFragmentFactory,
								importSource: jsxImportSource,
								runtime: jsxRuntime,
						  }
						: undefined,
					useDefineForClassFields:
						useDefineForClassFields !== undefined
							? useDefineForClassFields
							: undefined,
				},
				keepClassNames:
					!['es3', 'es5', 'es6', 'es2015'].includes(
						(target as string).toLowerCase(),
					) || undefined,
				paths,
				baseUrl,
			},
			module: {
				type: moduleType(module, cwd),
				strictMode: alwaysStrict || !noImplicitUseStrict ? undefined : false,
				noInterop: esModuleInterop ? undefined : true,
			} satisfies swcType.ModuleConfig,
			sourceMaps: sourceMap || undefined,
		} satisfies swcType.Options & { $schema: string },
		swcOptions,
	)

	return transformedOptions
}

const availableModuleTypes = ['commonjs', 'amd', 'umd', 'es6'] as const
type Module = typeof availableModuleTypes[number]

function moduleType(
	m: TsConfigJson.CompilerOptions.Module | undefined,
	cwd: string = process.cwd(),
): Module {
	const module = (m as unknown as string)?.toLowerCase()
	if (availableModuleTypes.includes(module as any)) {
		return module as Module
	}

	const es6Modules = [
		'es2015',
		'es2020',
		'es2022',
		'esnext',
		'node16',
		'nodenext',
		'none',
	] as const
	if (es6Modules.includes(module as any)) {
		return 'es6'
	}

	const packageJson = getPackageJson(cwd)
	if (packageJson?.type === 'module') {
		return 'es6'
	}

	return 'commonjs'
}

function targetType(t: string): swcType.JscTarget {
	// ts: "es3" | "es5"| "es6" | "es2015"| "es2016"| "es2017"| "es2018"| "es2019"| "es2020"| "es2021"| "es2022"| "esnext";
	// @see https://www.typescriptlang.org/tsconfig#target
	// swc: "es3" | "es5" | "es2015" | "es2016" | "es2017" | "es2018" | "es2019" | "es2020" | "es2021" | "es2022" | "esnext";

	const ret = t.toLowerCase()
	return ret === 'es6' ? 'es2015' : (ret as swcType.JscTarget)
}
