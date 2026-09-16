import { deepStrictEqual, strictEqual } from 'node:assert'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import { getTSOptions } from '../dist/utils.js'

const fixtures = resolve(import.meta.dirname, 'fixtures', 'tsconfig')

describe('getTSOptions', { concurrency: true }, () => {
	it('should read tsconfig.json and resolve implicit options', () => {
		const result = getTSOptions('tsconfig.json', fixtures)
		strictEqual(result.target, 'esnext')
		strictEqual(result.strict, true)
		strictEqual(result.alwaysStrict, true)
	})

	it('should return null if no config is found', () => {
		strictEqual(getTSOptions('tsconfig.json', resolve('/')), null)
	})

	it('should apply child options after extends', () => {
		const result = getTSOptions('tsconfig-extends.json', fixtures)
		strictEqual(result.target, 'es2018')
		strictEqual(result.strict, true)
	})

	it('should inherit an unspecified target', () => {
		const result = getTSOptions('tsconfig-extends-no-target.json', fixtures)
		strictEqual(result.target, 'esnext')
		strictEqual(result.strict, true)
	})

	it('should handle multiple levels of extends', () => {
		const result = getTSOptions(
			'tsconfig-extends-no-target-child.json',
			fixtures,
		)
		strictEqual(result.target, 'esnext')
		strictEqual(result.strict, false)
	})

	it('should resolve an extended package', () => {
		const result = getTSOptions('tsconfig-extends-imported.json', fixtures)
		strictEqual(result.module, 'nodenext')
		strictEqual(result.target, 'es2018')
		strictEqual(result.esModuleInterop, true)
		deepStrictEqual(result.types, ['node'])
	})

	it('should merge an extends array in order', () => {
		const result = getTSOptions('tsconfig-extends-array.json', fixtures)
		strictEqual(result.module, 'nodenext')
		strictEqual(result.target, 'es2018')
		strictEqual(result.strict, true)
		strictEqual(result.allowJs, true)
	})
})
