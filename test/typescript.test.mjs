import { strictEqual } from 'node:assert'
import { execFileSync } from 'node:child_process'
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { it } from 'node:test'
import { transformFileSync } from '@swc/core'
import { convert } from '../dist/index.js'

const require = createRequire(import.meta.url)
const fixtures = resolve(import.meta.dirname, 'fixtures/typescript')
const expected = '[1,"ok",42,43,44,["init",1,"after"]]'

it('matches TS 6 and TS 7 for decorators, JSON imports, and relative extensions', (t) => {
	const cwd = mkdtempSync(join(tmpdir(), 't2s-typescript-'))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	for (const [version, compiler] of [
		['6', require.resolve('@typescript/typescript6/bin/tsc6')],
		['7', resolve(require.resolve('typescript/package.json'), '../bin/tsc')],
	]) {
		const outDir = join(cwd, version)
		execFileSync(
			process.execPath,
			[
				compiler,
				'--project',
				join(fixtures, 'tsconfig.json'),
				'--outDir',
				outDir,
			],
			{ encoding: 'utf8', stdio: 'pipe' },
		)
		const output = execFileSync(process.execPath, [join(outDir, 'input.mjs')], {
			encoding: 'utf8',
		})
		strictEqual(output.trim(), expected)
	}

	const outDir = join(cwd, 'swc')
	mkdirSync(outDir)
	for (const [input, output] of [
		['input.mts', 'input.mjs'],
		['dep.mts', 'dep.mjs'],
		['dep.cts', 'dep.cjs'],
	]) {
		const filename = join(fixtures, input)
		const config = convert('tsconfig.json', fixtures, {
			filename,
			sourceMaps: false,
		})
		const { code } = transformFileSync(filename, config)
		writeFileSync(join(outDir, output), code)
	}
	copyFileSync(join(fixtures, 'data.json'), join(outDir, 'data.json'))
	const output = execFileSync(process.execPath, [join(outDir, 'input.mjs')], {
		encoding: 'utf8',
	})
	strictEqual(output.trim(), expected)
})
