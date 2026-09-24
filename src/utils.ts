import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { getTsconfig, type TsConfigJson } from 'get-tsconfig'

export function getTSOptions(
	filename = 'tsconfig.json',
	cwd: string = process.cwd(),
): TsConfigJson.CompilerOptions | null {
	const result = getTsconfig(cwd, filename)
	if (!result) {
		return null
	}
	const { config } = result
	return config.compilerOptions ?? null
}

export function getPackageJson(cwd: string = process.cwd()) {
	const result = findUpSync('package.json', { cwd })
	if (!result) {
		return null
	}

	const packageJson = JSON.parse(fs.readFileSync(result, 'utf-8'))
	return packageJson
}

/**
 * Makes paths in generated configs independent of the machine they were generated on.
 * The result has the form tsconfig paths are written in: forward slashes, "./src" or "../lib", and "./" for `from` itself.
 */
export function relativePath(from: string, to: string): string {
	const relative = path.relative(from, to).split(path.sep).join('/')
	// a path on another Windows drive has no relative form
	if (path.isAbsolute(relative)) {
		return relative
	}
	return relative === '..' || relative.startsWith('../')
		? relative
		: `./${relative}`
}

// the following code is copied from https://github.com/sindresorhus/find-up-simple/blob/ec263e63e3198ce3cdadd49decb9940ac9997bf3/index.js#L32C1-L53C2

const toPath = (urlOrPath?: string | URL) =>
	urlOrPath instanceof URL ? fileURLToPath(urlOrPath) : urlOrPath

export function findUpSync(
	name: string,
	{
		cwd = process.cwd(),
		type = 'file',
		stopAt,
	}: {
		cwd?: string
		type?: 'file' | 'directory'
		stopAt?: string
	},
) {
	let directory = path.resolve(toPath(cwd) ?? '')
	const { root } = path.parse(directory)
	stopAt = path.resolve(directory, toPath(stopAt) ?? root)

	while (directory && directory !== stopAt && directory !== root) {
		const filePath = path.isAbsolute(name) ? name : path.join(directory, name)

		try {
			const stats = fs.statSync(filePath, { throwIfNoEntry: false })
			if (
				(type === 'file' && stats?.isFile()) ||
				(type === 'directory' && stats?.isDirectory())
			) {
				return filePath
			}
		} catch {}

		directory = path.dirname(directory)
	}
}
