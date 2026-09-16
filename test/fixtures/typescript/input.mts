import data from './data.json' with { type: 'json' }
import { value } from './dep.mts'

import commonjsValue = require('./dep.cjs')

let calls = 0
class Base {}
Object.defineProperty(Base.prototype, 'value', {
	set() {
		calls++
	},
})
class Child extends Base {
	value = 1
}
new Child()

if (!Symbol.metadata) {
	Object.defineProperty(Symbol, 'metadata', { value: Symbol('metadata') })
}
function tag(_value: unknown, context: ClassDecoratorContext) {
	context.metadata.tag = 'ok'
}
@tag
class Marked {}

const initialization: (string | number)[] = []
function observe(
	_value: undefined,
	context: ClassFieldDecoratorContext<Observed, number>,
) {
	context.addInitializer(function () {
		initialization.push(this.value)
	})
	return (value: number) => {
		initialization.push('init')
		return value
	}
}
class Observed {
	@observe value = 1
	after = initialization.push('after')
}
new Observed()

console.log(
	JSON.stringify([
		calls,
		Marked[Symbol.metadata]?.tag,
		value,
		data.value,
		commonjsValue,
		initialization,
	]),
)
