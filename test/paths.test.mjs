import { match, strictEqual } from 'node:assert'
import { execFileSync } from 'node:child_process'
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { it } from 'node:test'
import { transformFileSync } from '@swc/core'
import { convert, convertTsConfig } from '../dist/index.js'

it('resolves inherited paths for the API and keeps generated .swcrc files portable', (t) => {
	const temporary = mkdtempSync(join(tmpdir(), 't2s-paths-'))
	t.after(() => rmSync(temporary, { recursive: true, force: true }))
	const project = join(temporary, 'project')
	const moved = join(temporary, 'moved')
	mkdirSync(join(project, 'base/src'), { recursive: true })
	mkdirSync(join(project, 'app/src'), { recursive: true })
	writeFileSync(join(project, 'base/src/value.ts'), 'export default 1;')
	writeFileSync(
		join(project, 'app/src/input.ts'),
		'import value from "@/value"; console.log(value);',
	)
	const tsconfig = join(project, 'app/tsconfig.json')
	writeFileSync(tsconfig, JSON.stringify({ extends: '../base/tsconfig.json' }))
	const filename = join(project, 'app/src/input.ts')

	for (const baseUrl of [undefined, './src']) {
		writeFileSync(
			join(project, 'base/tsconfig.json'),
			JSON.stringify({
				compilerOptions: {
					module: 'esnext',
					target: 'es2025',
					baseUrl,
					paths: { '@/*': [baseUrl ? './*' : './src/*'] },
				},
			}),
		)
		const config = convert(tsconfig, project, { filename, sourceMaps: false })
		const { code } = transformFileSync(filename, config)
		match(code, /from "\.\.\/\.\.\/base\/src\/value"/)

		execFileSync(process.execPath, [
			resolve('dist/cli.js'),
			'--filename',
			tsconfig,
			'--cwd',
			project,
			'--output',
			join(project, '.swcrc'),
		])
		const swcrc = JSON.parse(readFileSync(join(project, '.swcrc'), 'utf8'))
		strictEqual(swcrc.jsc.baseUrl, baseUrl ? './base/src' : './app')
		cpSync(project, moved, { recursive: true })
		const relocated = transformFileSync(join(moved, 'app/src/input.ts'), {
			configFile: join(moved, '.swcrc'),
			sourceMaps: false,
		})
		strictEqual(relocated.code, code)
	}

	const direct = convertTsConfig(
		{
			module: 'esnext',
			target: 'es2025',
			baseUrl: 'base/src',
			paths: { '@/*': ['./*'] },
		},
		{ filename, sourceMaps: false },
		project,
	)
	match(
		transformFileSync(filename, direct).code,
		/from "\.\.\/\.\.\/base\/src\/value"/,
	)
})
