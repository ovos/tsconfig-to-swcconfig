import type { Options } from '@swc/core'
import {
	type CompilerOptions,
	convert,
	convertTsConfig,
} from '../../../dist/index.js'

const options: CompilerOptions = {
	target: 'ES2025',
	lib: ['ES2025'],
	module: 'node20',
	ignoreDeprecations: '6.0',
	erasableSyntaxOnly: true,
	rewriteRelativeImportExtensions: true,
	verbatimModuleSyntax: true,
}

export const fromFile: Options = convert('tsconfig.json', '.', {
	sourceMaps: false,
})
export const fromObject: Options = convertTsConfig(options)
