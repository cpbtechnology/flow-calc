# flow-calc

Serialize and run complex business logic or calculations using a dependency graph/flow programming. Very work-in-progress, used internally on a project. Uses mobx and graphlib.

**Very work-in-progress. Use at your own peril, no support is currently offered, etc.**

# Overview

Motivation is to: 

- Express business logic in a serializable format that can be attached to objects in an application as a kind of contract. Like "here's the numbers we came up with, _and_ here's how we came up with them." 

- Allow for visibility into the calculation flow. Graphs are visualizable, editable, etc. Lots of projects use flow programming.

- Allow for decoupling of transaction records from the app code that generated them. That code inevitably evolves, making the old calculations difficult to re-generate if needed.

- Allow for easier composability in situations with complicated dependencies. For example: integrating various tax laws from different locales into a cost calculation. Settle on a convention of inputs and outputs and you could compose the tax calculations in code in any number of sound ways—functions, hierarchies, etc. The issue with using actual coded functions is that sometimes the taxes affect different parts of the overall calculation spreadsheet, and so getting the I/O conventions and dependencies right can lead to spaghetti. Particularly as the code evolves, and support for old ways must continue as new ways are built. If on the other hand we use a graph, a given node should have access to any dependencies it needs just by building an edge, and subsequent parts of the calculation will likewise have access to the tax results, as long as there is no _logical_ circular dependency. (If there is, the calculation is not possible to begin with.)

Yeah so the overall idea idea here is to let the machine figure out the dependencies! And serialize the calculation. As long as the resulting graph, no matter how complicated, is _logically_ acyclic, there should be a topological sort, allowing for a solution.

TODO: readme is out of date. Shocking!

# Example

```
const DGraph = require('flow-calc')

const graphDefinition = [
	{ name: 'staticNode', type: 'static', value: 'hello, ' },
	{ name: 'aliasNode', type: 'alias', mirror: 'inputs.stringValue' },
	{ name: 'concatExample', type: 'transform', fn: 'concat', params: ['staticNode', 'inputs.stringValue'] },
	{ name: 'multiplyExample', type: 'transform', fn: 'mult', params: { amt: 'inputs.numberValue', factor: 3 } }
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

# Usage

TODO: fill this out.

"Paths" are dot-separated paths to node values. Every graph has a special `inputs` node wherein you can find inputs passed to the graph, either from the first argument to the `run` function or as pass-throughs or nodes from supergraphs.

The wildcard `*` character can be used in a path for simple property mapping on a collection. For example, given:

```
{
    things: [
        { name: 'foo', amount: 4 },
        { name: 'bar', amount: 2 }
    ]
}
```

The path `things.*.amount` would resolve to the array `[4, 2]`. Only one wildcard per path is supported.


# Features

- Inputs can be promises (or any then-able).
- Nodes in a graph can be graphs themselves.
- Nodes can find their `inputs` (for graphs) or `params` (for transforms) by name implicitly when the supplied paths resolve to nodes in the current graph, nodes in the supergraph, or inputs to the supergraph. If you supply a string value as a param or input and it does not resolve to a node name, the graph will interpret it as a literal value.
- Template subgraphs (`isTemplate: true`) can be used multiple times by explicitly supplying `inputs`.
- Set `collectionMode` on a subgraph and pass a path to a `collection` that resolves to an array. Currently only `map` is supported: the subgraph will be applied to every item in the collection and the node's value will be a mapped array.
- Set `isHidden: true` on a node to hide its value from the output of `DGraph.run`.

# Caveats

- Diagnostics are really pretty bad right now. There is no checking for cycles. Passing the option `{ logUndefinedPaths: true }` to the `run` function will at least log which nodes remain unresolved as the graph runs. But the dependencies among those nodes is not apparent, so you have to either figure it out in your head or do some trial and error debugging. 
- Currently subgraphs resolve as a whole unit with respect to the containing graph. Individual nodes within the subgraph will not be visible until the entire subgraph resolves. This means that a subgraph `A`'s nodes can depend on a sibling subgraph `B`'s nodes _as long as_ there is not any dependency back from `B.someNode` to `A.someOtherNode`. This is true even if there is no _logical_ circular dependency among those nodes. You can use an `alias` node in the shared parent supergraph to get around this limitation.
- Paths to array indices (eg `some.collection.45`) probably works but hasn't been tested.
- This package was put together using [npm-module-boilerplate](https://github.com/flexdinesh/npm-module-boilerplate) and, as of this writing, minimal effort to follow best practices or testing. The commands in the Commands section may or may not do the right thing ...

# Node Types

- `static`: A hard-coded value. Can be atomic or object, array, etc.
- `comments`: Comments node; a no-op in the graph. Every node type also supports a `comments` property.
- `alias`: Aliases any path as a different path.
- `echo`: Echos an input node to the output.
- `dereference`: Dereference a property of one node based on the value of another node. Like `variable[propName]` in straight JS.
- `transform`: Apply any of several functions on the passed `params` paths. Similar to stream operators in stream/Rx libraries.
- `inputs`: Generated automatically in each graph.
- `async`: A node that resolves asynchronously ... no particular use case for it really.
- `branch`: Similar to a `switch` statement, this node resolves to the value of one of several other nodes, depending on the result of a `test` value as compared to a list of `cases`.
- `graph`: A subgraph. Inputs to the graph can be implicit unless using `isTemplate: true`.

# Transform Functions

Refer to `src/transform-fns.js`

# TODO

So much! Better diagnostics are a big one. Correctly converting mobx edges into graphlib edges is another.

# Commands

This package was put together using [npm-module-boilerplate](https://github.com/flexdinesh/npm-module-boilerplate) and, as of this writing, minimal effort to follow best practices or testing. These commands may or may not do the right thing ...

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
