# flow-calc

Serialize and run complex business logic or calculations using a dependency graph/flow programming.

# Example

```
const DGraph = require('flow-calc')

const graphDefinition = [
	{ name: 'staticNode', type: 'static', value: 'hello, ' },
	{ name: 'aliasNode', type: 'alias', mirror: 'inputs.stringValue' },
	{ name: 'concatExample', type: 'transform', fn: 'concat', inputs: ['staticNode', 'inputs.stringValue'] },
	{ name: 'multiplyExample', type: 'transform', fn: 'mult', inputs: { amt: 'inputs.numberValue', factor: 3 } }
]

const inputs = {
	stringValue: new Promise(r => setTimeout(() => r('world'), 500)),
	numberValue: 4
}

const dGraph = new DGraph(graphDefinition)
dGraph.run(inputs).then(result => {
	console.log(JSON.stringify(result, null, 4))
})
```

Output:

```
{
    "staticNode": "hello, ",
    "aliasNode": "world",
    "concatExample": "hello, world",
    "multiplyExample": 12,
    "inputs": {
        "numberValue": 4,
        "stringValue": "world"
    }
}

```

# Features

- Inputs can be promises.
- Nodes in graph can be graphs themselves, allowing for easier composability.

# Caveats

This package was put together using [npm-module-boilerplate](https://github.com/flexdinesh/npm-module-boilerplate) and, as of this writing, minimal effort to follow best practices. The commands below may or may not do the right thing ...

# Commands
- `npm run clean` - Remove `lib/` directory
- `npm test` - Run tests with linting and coverage results.
- `npm test:only` - Run tests without linting or coverage.
- `npm test:watch` - You can even re-run tests on file changes!
- `npm test:prod` - Run tests with minified code.
- `npm run test:examples` - Test written examples on pure JS for better understanding module usage.
- `npm run lint` - Run ESlint with airbnb-config
- `npm run cover` - Get coverage report for your code.
- `npm run build` - Babel will transpile ES6 => ES5 and minify the code.
- `npm run prepublish` - Hook for npm. Do all the checks before publishing your module.

# Installation


# License

MIT
