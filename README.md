# flow-calc

Serialize and run complex business logic or calculations using a dependency graph/flow programming. Very work-in-progress, used internally on a project. Uses [mobx](https://github.com/mobxjs/mobx/) and [graphlib](https://github.com/dagrejs/graphlib/).

**Very work-in-progress. Use at your own peril, no support is currently offered, etc.**

# Overview

Motivation is to: 

-   Express business logic in a serializable format that can be attached to objects in an application as a kind of contract. Like "here's the numbers we came up with, _and_ here's how we came up with them." 

-   Allow for visibility into the calculation flow. Graphs are visualizable, editable, etc. Lots of projects use flow programming.

-   Allow for decoupling of transaction records from the app code that generated them. That code inevitably evolves, making the old calculations difficult to re-generate if needed.

-   Allow for easier composability in situations with complicated dependencies. For example: integrating various tax laws from different locales into a cost calculation. Settle on a convention of inputs and outputs and you could compose the tax calculations in code in any number of sound ways—functions, hierarchies, etc. The issue with using actual coded functions is that sometimes the taxes affect different parts of the overall calculation spreadsheet, and so getting the I/O conventions and dependencies right can lead to spaghetti. Particularly as the code evolves, and support for old ways must continue as new ways are built. If on the other hand we use a graph, a given node should have access to any dependencies it needs just by building an edge, and subsequent parts of the calculation will likewise have access to the tax results, as long as there is no _logical_ circular dependency. (If there is, the calculation is not possible to begin with.)

Yeah so the overall idea idea here is to let the machine figure out the dependencies! And serialize the calculation. As long as the resulting graph, no matter how complicated, is _logically_ acyclic, there should be a topological sort, allowing for a solution.

TODO: readme is out of date. Shocking!

# Example

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

Output:

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

# Usage

TODO: fill this out.

Some nomenclature. A _graph definition_, often shortened to `graphDef` is a JSON array describing nodes and values, transforms on values, and dependencies among nodes/node values. A _graph_ is an in-memory representation of a graph definition, with:

-   live dependency tracking and updating, courtesy of [mobx](https://github.com/mobxjs/mobx/)
-   nodes and edges in an instance of a [graphlib Graph](https://github.com/dagrejs/graphlib/wiki/API-Reference)

Nodes have a name. And/or an id. The code is currently prettly sloppy about this. They're the same thing and the name/id must be unique within the graph.

Nodes also have a _value_. The value is `undefined` until all of its dependencies have been resolved. Once resolved, the value can be anything: an atomic built-in, an object, or an array.

All graphs accept _inputs_. All _transform_ nodes accept _params_. Other note types will have specific properties, depending. For example an `alias` node expects a `mirror` property. For now the best documentation is the source.

Every graph has a special `inputs` node wherein you can find the inputs passed to the graph, either from the first argument to the `run` function or as pass-throughs or nodes from supergraphs. 

_Paths_ are dot-separated paths to nodes and/or node values (once the node has resolved to, for example, an object). 

The wildcard `*` character can be used in a path for simple property mapping on a collection. For example, given:

        {
            things: [
                { name: 'foo', amount: 4 },
                { name: 'bar', amount: 2 }
            ]
        }

The path `things.*.amount` would resolve to the array `[4, 2]`. Only one wildcard per path is supported. Also see caveat below re: mapping over collections in the `inputs` node (you can't, at the moment).

# Features

-   Inputs can be promises (or any then-able).
-   Nodes in a graph can be graphs themselves.
-   Nodes can find their `inputs` (for graphs) or `params` (for transforms) by name implicitly when the supplied paths resolve to nodes in the current graph, nodes in the supergraph, or inputs to the supergraph. If you supply a string value as a param or input and it does not resolve to a node name, the graph will interpret it as a literal value.
-   A template subgraph (`isTemplate: true`) can be used multiple times by explicitly supplying different `inputs` to each instance.
-   Set `collectionMode` on a subgraph and pass a path to a `collection` that resolves to an array. Currently only `map` is supported: the subgraph will be applied to every item in the collection and the node's value will be the resulting mapped array.
-   Set `isHidden: true` on a node to hide its value from the output of `DGraph.run` and `DGraph.getState`.

# Caveats

-   Diagnostics are really pretty bad right now. There is no checking for cycles. Passing the option `{ logUndefinedPaths: true }` to the `run` function will at least log which nodes remain unresolved as the graph runs. But the dependencies among those nodes is not apparent, so you have to either figure it out in your head or do some trial and error debugging. 
-   Currently subgraphs resolve as a whole unit with respect to the containing graph. Individual nodes within the subgraph will not be visible until the entire subgraph resolves. This means that a subgraph `A`'s nodes can depend on a sibling subgraph `B`'s nodes _as long as_ there is not any dependency back from `B.someNode` to `A.someOtherNode`. This is true even if there is no _logical_ circular dependency among those nodes. You can use an `alias` node in the shared parent supergraph to get around this limitation.
-   Nodes currently can't map over arrays (with the wildcard `*`) in the `inputs` node of a graph. In other words a path like `inputs.someCollection.*.property` will fail. You can make an alias of the array path and then map over that. In this case the alias node's `mirror` value would be `inputs.someCollection` and the original node could then refer to the alias: `aliasOfInputsCollection.*.property`.
-   Paths to array indices (eg `some.collection.45`) probably works but hasn't been tested.
-   This package was put together using [nod](https://github.com/diegohaz/nod#install) and, as of this writing, minimal effort to follow best practices or testing. The commands in the Commands section may or may not do the right thing ...

## `run` command line util

Enables running graph compositions from command line.

# Node Types

-   `static`: A hard-coded value. Can be atomic or object, array, etc.
-   `comments`: Comments node; a no-op in the graph. Every node type also supports a `comments` property.
-   `alias`: Aliases any path as a different path.
-   `echo`: Echos an input node to the output.
-   `dereference`: Dereference a property of one node based on the value of another node. Like `variable[propName]` in straight JS.
-   `transform`: Apply any of several functions on the passed `params` paths. Similar to stream operators in stream/Rx libraries.
-   `inputs`: Generated automatically in each graph.
-   `async`: A node that resolves asynchronously ... no particular use case for it really.
-   `branch`: Similar to a `switch` statement, this node resolves to the value of one of several other nodes, depending on the result of a `test` value as compared to a list of `cases`.
-   `graph`: A subgraph. Inputs to the graph can be implicit unless using `isTemplate: true`.

# Transform Functions

Refer to `src/transform-fns.js`

# TODO

So much! Better diagnostics are a big one. Correctly converting mobx edges into graphlib edges is another.

## Commands

```sh
$ npm test # run tests with Jest
$ npm run coverage # run tests with coverage and open it on browser
$ npm run lint # lint code
$ npm run docs # generate docs
$ npm run build # generate docs and transpile code
```

## API Warning

Note that API below is auto-generated and at this time is not checked for accuracy or usefulness.

## API

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

#### Table of Contents

-   [getValueAtPathWithArraySupport](#getvalueatpathwitharraysupport)
    -   [Parameters](#parameters)
-   [DNode](#dnode)
    -   [Parameters](#parameters-1)
    -   [getPathProps](#getpathprops)
-   [StaticDNode](#staticdnode)
    -   [Parameters](#parameters-2)
-   [AliasDNode](#aliasdnode)
    -   [Parameters](#parameters-3)
-   [EchoDNode](#echodnode)
    -   [Parameters](#parameters-4)
-   [DereferenceDNode](#dereferencednode)
    -   [Parameters](#parameters-5)
-   [TransformDNode](#transformdnode)
    -   [Parameters](#parameters-6)
-   [InputsDNode](#inputsdnode)
    -   [Parameters](#parameters-7)
-   [AsyncDNode](#asyncdnode)
    -   [Parameters](#parameters-8)
-   [BranchDNode](#branchdnode)
    -   [Parameters](#parameters-9)
-   [GraphDNode](#graphdnode)
    -   [Parameters](#parameters-10)
    -   [waitForFulfillment](#waitforfulfillment)
    -   [\_runAsMap](#_runasmap)
        -   [Parameters](#parameters-11)
-   [DGraph](#dgraph)
    -   [Parameters](#parameters-12)
    -   [getDNode](#getdnode)
        -   [Parameters](#parameters-13)
    -   [getDNodes](#getdnodes)
    -   [getDEdges](#getdedges)
    -   [setInputs](#setinputs)
        -   [Parameters](#parameters-14)
    -   [srcFromPath](#srcfrompath)
        -   [Parameters](#parameters-15)
    -   [normalizePathDef](#normalizepathdef)
        -   [Parameters](#parameters-16)
    -   [collectExpectedInputNames](#collectexpectedinputnames)
        -   [Parameters](#parameters-17)
    -   [collectExpectedInputPaths](#collectexpectedinputpaths)
        -   [Parameters](#parameters-18)
    -   [collectEdgeDefs](#collectedgedefs)
        -   [Parameters](#parameters-19)
-   [collectObjectPaths](#collectobjectpaths)
    -   [Parameters](#parameters-20)
-   [flattenObject](#flattenobject)
    -   [Parameters](#parameters-21)
-   [expandObject](#expandobject)
    -   [Parameters](#parameters-22)
-   [pathValueToObject](#pathvaluetoobject)
    -   [Parameters](#parameters-23)
-   [extractNItems](#extractnitems)
    -   [Parameters](#parameters-24)
-   [applyDiscounts](#applydiscounts)
    -   [Parameters](#parameters-25)

### getValueAtPathWithArraySupport

Supports using "\*" to return an array of items.

"path.to.array._" => <items of collection>
"path.to.array._.path.in.item" => <extract value from each item in collection>

#### Parameters

-   `obj` **any** 
-   `path` **any** 

### DNode

Base class for DNodes. Construct with the graph in which the node
participates, and the node's definition.

#### Parameters

-   `dGraph`  
-   `nodeDef`  

#### getPathProps

Properties on the nodeDef that should be treated like paths
to values in the graph. Allows checking for the existence of
dependent nodes and inferring whether a property value is a
path to a node or a literal value.

Return an object with keys that are property names and values
that describe how the property names should be handled/interpreted.
Currently the only such option is hasSubproperties, which is used
to help describe edge i/o. This is a wee messy.

### StaticDNode

**Extends DNode**

Initial value is its forever value.

Usage:

{ name: <node name>, type: "static", value: <any JS value> }

#### Parameters

-   `dGraph`  
-   `nodeDef`  

### AliasDNode

**Extends DNode**

Provide an alias name for a path to a value. Usage:

{ name: <node name>, type: "alias", mirror: "path.to.other.value" }

#### Parameters

-   `dGraph`  
-   `nodeDef`  

### EchoDNode

**Extends DNode**

Echos to output state an input node with the same name as this node.
Normally, inputs cannot have names that conflict with node names. The
echo node is an exception to this.

An `inputName` prop is optional but if the input name is different
you could probably use an alias node instead.

#### Parameters

-   `dGraph`  
-   `nodeDef`  

### DereferenceDNode

**Extends DNode**

Dereference a property using a dynamic value path.

Usage:

{
  name: <node name>,
  type: "dereference",
  objectPath: &lt;path to `object` value to dereference>,
  propNamePath: &lt;path to `propName`, a string value>
}

The value of the node will be the value of object[propName].

#### Parameters

-   `dGraph`  
-   `nodeDef`  

### TransformDNode

**Extends DNode**

Take the values of n input nodes and output a value based on
one of several predefined functions.

Usage:

{
  name: <node name>,
  type: "transform",
  fn: &lt;fn name, a function exported from transform-fns.js>
  params: {
    &lt;...list of params, depending on fn>
  }
}

#### Parameters

-   `dGraph`  
-   `nodeDef`  

### InputsDNode

**Extends DNode**

Used internally to automatically create an `inputs` node.

#### Parameters

-   `dGraph`  
-   `nodeDef`  

### AsyncDNode

**Extends DNode**

Node with an async value. Really only used for testing, since this
node would not be serializable.

#### Parameters

-   `dGraph`  
-   `nodeDef`  

### BranchDNode

**Extends DNode**

Acts like a switch statement for other graph nodes, depending
on the value of passed `test` value as compared to elements of the
passed `cases` array.

Note at this time only the `test` value can be dynamic (ie, be
a path to a node the value of which is resolved at runtime).

Expects a one-to-one mapping from `cases` to `nodeNames`.

A `_default_` case can be included (& hopefully no one would ever
need a legit value to be called "_default_").

#### Parameters

-   `dGraph`  
-   `nodeDef`  

### GraphDNode

**Extends DNode**

Create a subgraph node. The value of this node can depend on some of its
supergraph's nodes and its supergraph's nodes can depend on the value
of this node. Just be sure those are two separate sets of nodes: circular
dependencies will prevent the graph from ever fulfilling.

You can supply explicit inputs with an `inputs` property. Otherwise, the
subgraph will attempt to find its required inputs automatically
from its supergraph's nodes OR, barring that, from properties on its
supergraph's `inputs` node.

Usage:

{
  name: <node name>,
  type: "graph",
  graphDef: &lt;graph definition, aka an array of node definitions>

[inputs]: <inputs definition (optional)>

}

#### Parameters

-   `dGraph`  
-   `nodeDef`  

#### waitForFulfillment

Don't we all ... don't we all.

#### \_runAsMap

Conventions for mapping a template graph over a collection of items:

-   The mapping node must provide an `collection` property in the graph's `inputs`.
-   Each item in the collection will be passed to the graph that is applied to each item as `item`.
-   Remaining properties in `inputs` will be available as named.

So in the supergraph definition:

    {
      "name": "mappingNodeName",
      "type": "graph",
      "collectionMode": "map",
      "graphDef": "graphToBeAppliedToEachItem"
      "inputs": {
        "collection": "nodeThatResolvesToArrayOfObjects",
        "otherArg": "someOtherArgsGoHere"
      }
    }

Let's say the `nodeThatResolvesToArrayOfObjects` resolves to `[{ value: 5 }, { value: 20 }]`
and `someOtherArgsGoHere` resolves to the number `3`.

Then `graphToBeAppliedToEachItem` could be defined as, for example:

    [{
      "name": "result",
      "type": "transform",
      "fn": "mult",
      "params": {
        "amt": "inputs.item.value",
        "factor": "inputs.otherArg"
      }
    }]

Then `mappingNodeName` should resolve to an array like `[{ result: 15 }, { result: 60 }]`.

##### Parameters

-   `args` **any** 
-   `dispose` **any** 

### DGraph

**Extends EventEmitter**

DGraph: Dependency Graph

DGraph allows you to calculate values using dependency graphs
(<https://en.wikipedia.org/wiki/Dependency_graph>), using a few built-in
node types and built-in operations.

All operations and nodes available can be found in dNodes.js, but the
basic operations (called "transforms" in the code) are things like
AND, OR, ADD, MULTIPLY, and so on. From a handful of primitive operations
and topologically-sorted evalutation trees, you can build up complicated
business logic which can be serialized and composed.

It uses reactive programming and works more or less like a spreadsheet,
where dependent cells are automatically re-evaluated when their inputs change.

Basic use:

1.  define a graph, `graphDef`, using JSON
2.  build an in-memory graph via `const g = new DGraph(graphDef)`
3.  run the graph by passing in your inputs: `g.run({ vehicle: {...}, user: {...} })`
4.  `run` returns a promise which will fulfill with the calculated values,
    derived from the inputs

For now refer to the /scripts/d-graph/tests files to see examples of building
and running a DGraph. One note: when you run a DGraph, it automatically creates
an `inputs` node that will contain all the values you provide. Refer to those
values via a path, just like you would to any other node: `inputs.user.name.first`,
etc. This obviously means that you shouldn't name a node `inputs` in the graph
definition itself.

Two features make DGraph particularly useful for us:

1.  Inputs can be promises. When the promise fulfills, the graph updates all
    dependent values.
2.  There is a `graph` node type, with which you can define subgraphs. The
    subgraph can run asynchronously and its evaluated results can be referred to
    just like any other value in the graph.

\#1 means that we can use queries or other asynchronous operations as direct
inputs to the graph. For example:

    g.run({
      user: User.findOne({ _id: userId }).exec()
    })

\#2 means that we can compose graphs and business logic. If, for example, the
only difference between two state's cost calculations is whether mileage is
taxed or not, we should be able to build a mostly re-usable cost graph and just
plug in the tax calculation subgraph for each state.

NB Current limitations:

-   Diagnostics are not very helpful. When things go wrong the graph can often
    just stall in an unresolved state with little clue as to what didn't work out.

-   Subgraph nodes can depend on interior nodes of other subgraphs, BUT ONLY if there
    no resulting cycle between the _subgraph_ nodes themselves. In other words if
    A and B are subgraphs, A.nodeInA can depend on B.nodeInB, or vice-versa, but
    if you have dependencies in _both_ directions, the graph will never resolve, even
    if there is no logical cycle among individual nodes (that is, if they were all
    together in a single big graph). You can work around for now this by defining
    an alias of one of the values in the root graph and then referring to that.

#### Parameters

-   `graphDefinition` **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)** A list of nodes describing this graph.
-   `name` **[String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)?** The name of the graph.
-   `supergraph` **[DGraph](#dgraph)?** This graph's supergraph (used by graph nodes).
-   `options` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)?** Options object.

#### getDNode

Return the DNode identified by `name` in this graph.

If `searchAncestors` is true, also search in supergraphs.

##### Parameters

-   `name` **[String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** 
-   `searchAncestors` **[Boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)**  (optional, default `false`)

#### getDNodes

A list of all DNodes in this graph.

#### getDEdges

A list of all edges in this graph. An edge is shaped like:

    {
      srcNodeId: <source node name>,
      srcPropName: <dependent property name in source>,
      dstNodeId: <dest node name>,
      dstValuePath: <path to depended-upon value in dest>
    }

`dstValuePath` may be undefined if the dest node value is atomic.

#### setInputs

##### Parameters

-   `inputs` **any** a plain object. values can be either promises or plain values.

#### srcFromPath

Returns a pair with the nodeId split
out from the rest of the path:

{
  nodeId: <node id>,
  valuePath: &lt;rest of the path, if any>
}

##### Parameters

-   `srcPath`  

#### normalizePathDef

Accept a few ways to specify paths to other values
in the graph. In all cases return an object with keys
that are property names and values that are paths.

##### Parameters

-   `pathDef`  

#### collectExpectedInputNames

Traverse nodes and if any node depends on the `inputs` node,
collect the top-level property name required.

##### Parameters

-   `graphDef`  

#### collectExpectedInputPaths

Traverse nodes and if any node depends on the `inputs` node,
collect the full path of that dependency, except for `inputs.` at the
beginning of the path (that part is assumed).

Relies on DNode class advertising their property names that will refer
to other nodes in `getPathProps`.

Pass `recursive` to include subgraph inputs in result. This will not
currently include template subgraph inputs.

##### Parameters

-   `graphDef`  
-   `recursive`   (optional, default `false`)

#### collectEdgeDefs

Collect edges, v -> w, read _v depends upon w_. Resulting edges are shaped:

{
  srcNodeId,
  srcPropName,
  dstNodeId,
  dstValuePath
}

Precondition for running this is that the graph and all subgraphs are _constructed_.

##### Parameters

-   `dNode`  

### collectObjectPaths

Traverses passed object depth-first and collects all object's
own paths recursively.

#### Parameters

-   `obj` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** The object to traverse.
-   `parent` **[String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** Parent property name, if any.

Returns **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)&lt;[String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)>** Array of paths.

### flattenObject

Flattens a deep object tree (arrays and objects) into a single
non-tree object whose keys are the paths of nested properties
with matching values.

Properties with dots in their names should be preserved.

Not super-speedy. :)

#### Parameters

-   `obj` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** Object to flatten.
-   `filterFn`  

### expandObject

Expands an object flattened by `flattenObject`.

#### Parameters

-   `obj` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** Object to expand
-   `filterFn`  

### pathValueToObject

Create minimal nested objects/arrays following `path` all the way
down to the last item in `path`, then set the value of that property.

Not particularly well-tested.

#### Parameters

-   `path` **[String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** A path like `"path.to.3.property"`.
-   `value` **Any** Value to set.
-   `oObj`   (optional, default `null`)
-   `obj` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** If defined, create the path in this object or use object's existing path.

### extractNItems

Try to extract an array of values from arguments to the
xxxN functions.

Bit cheesy to accept all these variants.

#### Parameters

-   `items` **any** 

### applyDiscounts

Applies a given list of discounts discounts to a given borrowerDayrate.

#### Parameters

-   `$0` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)** 
    -   `$0.discounts`   (optional, default `[]`)
    -   `$0.borrowerDayrate`  
    -   `$0.lenderDayrate`  

## License

MIT © [Diego Haz](https://github.com/diegohaz)
