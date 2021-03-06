const { observable, autorun, toJS } = require('mobx')
const graphlib = require('graphlib')
const _ = require('lodash')
const { flattenObject } = require('./object-path-utils')
const dNodeClasses = require('./d-nodes')
const EventEmitter = require('./EventEmitter')

let nGraphs = 0

/**
 * DGraph: Dependency Graph
 *
 * DGraph allows you to calculate values using dependency graphs
 * (https://en.wikipedia.org/wiki/Dependency_graph), using a few built-in
 * node types and built-in operations.
 *
 * All operations and nodes available can be found in dNodes.js, but the
 * basic operations (called "transforms" in the code) are things like
 * AND, OR, ADD, MULTIPLY, and so on. From a handful of primitive operations
 * and topologically-sorted evalutation trees, you can build up complicated
 * business logic which can be serialized and composed.
 *
 * It uses reactive programming and works more or less like a spreadsheet,
 * where dependent cells are automatically re-evaluated when their inputs change.
 *
 * Basic use:
 *
 * 1. define a graph, `graphDef`, using JSON
 * 2. build an in-memory graph via `const g = new DGraph(graphDef)`
 * 3. run the graph by passing in your inputs: `g.run({ vehicle: {...}, user: {...} })`
 * 4. `run` returns a promise which will fulfill with the calculated values,
 *    derived from the inputs
 *
 * For now refer to the /scripts/d-graph/tests files to see examples of building
 * and running a DGraph. One note: when you run a DGraph, it automatically creates
 * an `inputs` node that will contain all the values you provide. Refer to those
 * values via a path, just like you would to any other node: `inputs.user.name.first`,
 * etc. This obviously means that you shouldn't name a node `inputs` in the graph
 * definition itself.
 *
 * Two features make DGraph particularly useful for us:
 *
 * 1. Inputs can be promises. When the promise fulfills, the graph updates all
 *    dependent values.
 * 2. There is a `graph` node type, with which you can define subgraphs. The
 *    subgraph can run asynchronously and its evaluated results can be referred to
 *    just like any other value in the graph.
 *
 * #1 means that we can use queries or other asynchronous operations as direct
 * inputs to the graph. For example:
 *
 * ```
 * g.run({
 *   user: User.findOne({ _id: userId }).exec()
 * })
 * ```
 *
 * #2 means that we can compose graphs and business logic. If, for example, the
 * only difference between two state's cost calculations is whether mileage is
 * taxed or not, we should be able to build a mostly re-usable cost graph and just
 * plug in the tax calculation subgraph for each state.
 *
 * NB Current limitations:
 *
 * - Diagnostics are not very helpful. When things go wrong the graph can often
 *   just stall in an unresolved state with little clue as to what didn't work out.
 *
 * - Subgraph nodes can depend on interior nodes of other subgraphs, BUT ONLY if there
 *   no resulting cycle between the *subgraph* nodes themselves. In other words if
 *   A and B are subgraphs, A.nodeInA can depend on B.nodeInB, or vice-versa, but
 *   if you have dependencies in *both* directions, the graph will never resolve, even
 *   if there is no logical cycle among individual nodes (that is, if they were all
 *   together in a single big graph). You can work around for now this by defining
 *   an alias of one of the values in the root graph and then referring to that.
 *
 *
 * @param {Array} graphDefinition A list of nodes describing this graph.
 * @param {String} [name] The name of the graph.
 * @param {DGraph} [supergraph] This graph's supergraph (used by graph nodes).
 * @param {Object} [options] Options object.
 */
class DGraph extends EventEmitter {
	constructor(graphDefinition, name, supergraph, options) {
		super()
		if (!graphDefinition) {
			throw new Error('No graph definition was supplied.')
		}

		this.graphDefinition = graphDefinition
		this.name = name || `Unnamed-DGraph-${nGraphs++}`

		// supergraph argument is optional. if something is
		// passed but is not a DGraph, assume it's an options argument.
		if (supergraph && (supergraph instanceof DGraph)) {
			this.supergraph = supergraph
		}
		else {
			this.supergraph = null
			options = supergraph // eslint-disable-line no-param-reassign
		}

		this._graph = null
		this.isConstructed = Promise.resolve(false)
		this.options = _.defaults({}, options, { // eslint-disable-line no-param-reassign
			echoInputs: false,
			echoTemplates: false,
			echoIntermediates: false,
			logUndefinedPaths: false,
			depth: 0
		})

		this.normalizePathDef = DGraph.normalizePathDef
		this.srcFromPath = DGraph.srcFromPath

		this._build()
	}

	log(...args) {
		let indent = ''
		for (let i = 0; i < this.options.depth; i++) {
			indent += '  '
		}
		console.log(indent, ...args) // eslint-disable-line no-console
	}

	get rootGraph() {
		let supergraph = this.supergraph ? this.supergraph : this
		while (supergraph.supergraph) {
			supergraph = supergraph.supergraph
		}
		return supergraph
	}

	_preprocessGraphDef(graphDef) {

		// let's not modify the original
		let def = _.cloneDeep(graphDef)

		// populate alias definitions if any
		for (const nodeDef of def) {
			let { aliases } = nodeDef
			if (aliases) {
				if (!_.isArray(aliases)) {
					aliases = [aliases]
				}
				for (const a of aliases) {
					def.push({ name: a, type: 'alias', mirror: nodeDef.name })
				}
			}
		}

		// create an inputs node
		def.push({ name: 'inputs', type: 'inputs', value: {} })

		// for nodes with inputs or params, work out if there are any literals in the def.
		// if so, create new static nodes for those values.
		const nodeNames = def.map(n => n.name)
		const literalNodes = []
		for (const nodeDef of def) {
			const pathProps = dNodeClasses[nodeDef.type].getPathProps()
			const pathPropertyNames = _.keys(pathProps)
			for (const pathPropertyName of pathPropertyNames) {
				const pathPropertyValue = nodeDef[pathPropertyName]
				if (pathPropertyValue) {
					const normalizedPathDefs = this.normalizePathDef(pathPropertyValue)
					const keys = _.keys(normalizedPathDefs)
					for (const key of keys) {
						const pathOrValue = normalizedPathDefs[key]
						const pathOrValueIsString = _.isString(pathOrValue)
						let possibleNodeName = pathOrValueIsString ? pathOrValue : ''
						if (pathOrValueIsString) {
							// if it's a string, it might be a node name.
							possibleNodeName = possibleNodeName.includes('.') ? possibleNodeName.split('.')[0] : possibleNodeName
						}
						if (!pathOrValueIsString || !nodeNames.includes(possibleNodeName)) {
							if (this.options.logLiterals) {
								this.log(`Note: '${this.name}' is interpreting '${pathOrValue}' as a literal at '${nodeDef.name}.${key}'.`)
							}
							const newNodeName = `#literal#${nodeDef.name}#${key}`
							literalNodes.push({ name: newNodeName, type: 'static', value: pathOrValue })
							normalizedPathDefs[key] = newNodeName
						}
					}
					nodeDef[pathPropertyName] = normalizedPathDefs
				}
			}
		}

		def = def.concat(literalNodes)

		return def
	}

	_build() {
		this._graph = new graphlib.Graph({
			directed: true,
			multigraph: true
		})
		let resolveGraphIsConstructed
		let resolveGraphIsConnected

		this.isConstructed = new Promise((resolve) => {
			resolveGraphIsConstructed = resolve
		})
		this.isConnected = new Promise((resolve) => {
			resolveGraphIsConnected = resolve
		})

		const graphDef = this._preprocessGraphDef(this.graphDefinition)

		const dNodes = graphDef.map((nodeDef) => {
			const DNodeClass = dNodeClasses[nodeDef.type]
			if (!DNodeClass) {
				throw new Error(`Unknown node type: ${nodeDef.type}.`)
			}
			return new DNodeClass(this, nodeDef)
		})

		const subgraphsConstructedPromises = []

		for (const dNode of dNodes) {
			// this.log(`creating node ${dNode.name}`)
			this._graph.setNode(dNode.name, dNode)
			if (dNode.type === 'graph') {
				subgraphsConstructedPromises.push(dNode.isConstructed)
			}
		}

		this.resolutionError = null
		this.isSettled = observable.box(false)
		this.isSettledPromise = null

		// this.log(`[${this.name}] is constructed`)
		resolveGraphIsConstructed()
		this.trigger('constructed')

		Promise.all(subgraphsConstructedPromises).then(() => {
			// TODO: this seems not to be doing quite the right thing yet.
			for (const dNode of dNodes) {
				const edges = DGraph.collectEdgeDefs(dNode)
				for (const edge of edges) {
					this._graph.setEdge({ v: edge.srcNodeId, w: edge.dstNodeId, name: edge.label }, edge)
				}
			}
			resolveGraphIsConnected()
			this.trigger('connected')
		})
	}

	getUndefinedPaths(obj = null) {
		const collectUndefinedPathsInObject = (obj) => {
			const flattened = flattenObject(obj)
			return _.keys(flattened).filter(k => _.isUndefined(flattened[k]) || _.isNaN(flattened[k]))
		}
		return obj ? collectUndefinedPathsInObject(obj) : collectUndefinedPathsInObject(this.getState(true))
	}


	shouldIncludeNodeValue(dNode) {
		let result = !dNode.name.startsWith('#') && (!(dNode instanceof dNodeClasses.inputs) || this.options.echoInputs)
		result = result && dNode.echoTo
		return result
	}

	getState(includeInvisible = false) {
		const nodeValues = {}
		try {
			this._graph.nodes().forEach((nodeId) => {
				const dNode = this._graph.node(nodeId)
				const { name } = dNode
				const { value } = dNode
				if (dNode.isVisibleInGraphState || includeInvisible) {
					nodeValues[name] = toJS(value)
				}
			})
		}
		catch (error) {
			this.log(`Error caught reading nodes from [${this.name}]. ${error}.`)
			this.log(error.stack)
			throw error
		}
		return nodeValues
	}

	run(inputs) {
		const expectedInputNames = _.uniq(DGraph.collectExpectedInputNames(this.graphDefinition))
		const actualInputNames = _.keys(inputs)
		const missingInputs = []
		for (const expectedInputName of expectedInputNames) {
			if (!actualInputNames.includes(expectedInputName)) {
				missingInputs.push(expectedInputName)
			}
		}

		if (missingInputs.length) {
			throw new Error(`Graph ${this.name} was not passed the following expected inputs: ${_.uniq(missingInputs).join(', ')}.`)
		}

		this.setInputs(inputs)

		let dispose
		return new Promise((resolve, reject) => {
			dispose = autorun(() => {
				try {

					// getState tracks in the mobx sense.
					const state = this.getState()

					// is anything undefined?
					const undefinedPaths = this.getUndefinedPaths(state)

					if (undefinedPaths.length === 0) {
						resolve(state)
						this.trigger('resolved', state)
						if (dispose) {
							dispose()
						}
					}
					else {
						this.trigger('stepped', {
							state,
							undefinedPaths
						})
						if (this.options.logUndefinedPaths) {
							this.logUndefinedPaths(undefinedPaths)
						}
					}
				}
				catch (error) {
					this.log(`Error caught reading nodes from [${this.name}]. ${error}.`)
					this.log(error.stack)
					this.trigger('error', error)
					reject(error)
					if (dispose) {
						if (dispose) {
							dispose()
						}
					}
				}
			})
		})

	}

	logUndefinedPaths(undefinedPaths) {
		// let sortedNodeIds = graphlib.alg.topsort(this._graph)
		// sortedNodeIds = sortedNodeIds.filter(id => undefinedPaths.includes(id))
		this.log(`[log-undefined-paths] Undefined paths in '${this.name}':`)
		for (const nodeId of undefinedPaths) {
			// const predecessors = this._graph.predecessors(nodeId)
			this.log(`    '${nodeId}'`)
			// if (predecessors && predecessors.length) {
			// 	this.log(`     <- ${predecessors.join(', ')}`)
			// }

		}
	}

	/**
	 * Return the DNode identified by `name` in this graph.
	 *
	 * If `searchAncestors` is true, also search in supergraphs.
	 *
	 * @param {String} name
	 * @param {Boolean} searchAncestors
	 */
	getDNode(name, searchAncestors = false) {
		const node = this._graph.node(name)
		if (!node && searchAncestors && this.supergraph) {
			return this.supergraph.getDNode(name, searchAncestors)
		}
		return node
	}

	/**
	 * A list of all DNodes in this graph.
	 */
	getDNodes() {
		return this._graph.nodes().map(nodeId => this._graph.node(nodeId))
	}

	/**
	 * A list of all edges in this graph. An edge is shaped like:
	 *
	 * ```
	 * {
	 *   srcNodeId: <source node name>,
	 *   srcPropName: <dependent property name in source>,
	 *   dstNodeId: <dest node name>,
	 *   dstValuePath: <path to depended-upon value in dest>
	 * }
	 * ```
	 *
	 * `dstValuePath` may be undefined if the dest node value is atomic.
	 */
	getDEdges() {
		return this._graph.edges().map(edge => this._graph.edge(edge))
	}


	/**
	 *
	 * @param {*} inputs a plain object. values can be either promises or plain values.
	 */
	setInputs(inputs) {
		const dNode = this._graph.node('inputs')
		for (const k in inputs) {
			const existingNode = this._graph.node(k)
			if (existingNode && existingNode.type !== 'echo') {
				throw new Error(`Input name '${k}' conflicts with existing node '${k}' in graph '${this.name}'.`)
			}
			const value = inputs[k]
			if (value && _.isFunction(value.then)) {
				value.then((result) => {
					dNode.setValue(k, result)
				})
			}
			else {
				dNode.setValue(k, value)
			}
		}
	}

}

/**
 * Returns a pair with the nodeId split
 * out from the rest of the path:
 *
 * {
 *   nodeId: <node id>,
 *   valuePath: <rest of the path, if any>
 * }
 */
DGraph.srcFromPath = (srcPath) => {
	const bits = srcPath.split('.')
	const result = {
		nodeId: srcPath,
		valuePath: undefined
	}
	if (bits.length > 1) {
		result.nodeId = bits[0]
		result.valuePath = bits.slice(1).join('.')
	}
	return result
}

/**
 * Accept a few ways to specify paths to other values
 * in the graph. In all cases return an object with keys
 * that are property names and values that are paths.
 */
DGraph.normalizePathDef = (pathDef) => {
	let paths = []; let
propNames = []

	// make keys not look like paths.
	const mangleKeyPath = p => p// .replace('.', '$')

	if (_.isArray(pathDef)) {
		// keys and values are identical. example use case: referring to
		// another simple (non-nested) node value in this graph.
		propNames = _.clone(pathDef.map(mangleKeyPath))
		paths = _.clone(pathDef)
	}
	else if (_.isString(pathDef)) {
		// just like array situation but for a single key/value pair
		propNames = [mangleKeyPath(pathDef)]
		paths = [pathDef]
	}
	else {
		// typical case: prop names already set; just clone 'em.
		propNames = _.keys(pathDef)
		paths = _.values(pathDef)
	}
	return _.zipObject(propNames, paths)
}

/**
 * Traverse nodes and if any node depends on the `inputs` node,
 * collect the top-level property name required.
 */
DGraph.collectExpectedInputNames = graphDef => DGraph.collectExpectedInputPaths(graphDef).map(path => path.split('.')[0])

/**
 * Traverse nodes and if any node depends on the `inputs` node,
 * collect the full path of that dependency, except for `inputs.` at the
 * beginning of the path (that part is assumed).
 *
 * Relies on DNode class advertising their property names that will refer
 * to other nodes in `getPathProps`.
 *
 * Pass `recursive` to include subgraph inputs in result. This will not
 * currently include template subgraph inputs.
 */
DGraph.collectExpectedInputPaths = (graphDef, recursive = false) => {
	let result = []
	const graphNodeNames = graphDef.map(n => n.name)
	for (const nodeDef of graphDef) {
		const pathProps = dNodeClasses[nodeDef.type].getPathProps()
		const pathPropertyNames = _.keys(pathProps)
		for (const propName of pathPropertyNames) {
			const normalizedPaths = DGraph.normalizePathDef(nodeDef[propName])
			const inputPaths = _.values(normalizedPaths).filter(value => _.isString(value) && value.startsWith('inputs.'))
			result = result.concat(inputPaths.map(path => path.split('.').slice(1).join('.')))
		}

		// Note this will currently not capture inputs in templates.
		if (recursive && nodeDef.type === 'graph' && _.isArray(nodeDef.graphDef)) {
			let subgraphInputs = DGraph.collectExpectedInputPaths(nodeDef.graphDef, true)
			// a subgraph's inputs implicitly includes all nodes in the supergraph.
			// so, with respect to this graph's expected inputs, filter those subgraph
			// input names that are found as regular nodes in this graph--this graph's node
			// satisfies the input.
			subgraphInputs = subgraphInputs.filter(subgraphInput => !graphNodeNames.includes(subgraphInput))
			result = result.concat(subgraphInputs)
		}
	}
	return _.uniq(result)
}

/**
 * Collect edges, v -> w, read _v depends upon w_. Resulting edges are shaped:
 *
 * {
 *   srcNodeId,
 *   srcPropName,
 *   dstNodeId,
 *   dstValuePath
 * }
 *
 * Precondition for running this is that the graph and all subgraphs are _constructed_.
 */
DGraph.collectEdgeDefs = (dNode) => {
	const result = []
	const pathProps = dNodeClasses[dNode.type].getPathProps()
	// const pathPropertyNames = _.keys(pathProps)
	for (const propName in pathProps) {
		const { hasSubproperties } = pathProps[propName]
		const pathDef = dNode.originalNodeDef[propName]
		const normalizedPaths = DGraph.normalizePathDef(pathDef)
		const pathKeys = _.keys(normalizedPaths)
		const pathValues = _.values(normalizedPaths)

		const srcs = _.values(normalizedPaths).map(DGraph.srcFromPath)

		// TODO: will probably need to add metadata down to the level of transform function
		// itself to get this to work out right everywhere, without kludginess.
		const interpretSrcsAsList = srcs.length > 1 && (_.isArray(pathDef) || _.isEqual(pathValues, pathKeys))

		srcs.forEach((src, i) => {
			let srcPropName = interpretSrcsAsList ? `${propName}.${i}` : propName
			if (hasSubproperties) {
				srcPropName = pathKeys[i]
			}
			result.push({
				label: `${dNode.name}.${srcPropName}->${src.nodeId}.${src.valuePath}`,
				srcNodeId: dNode.name,
				srcPropName,
				dstNodeId: src.nodeId,
				dstValuePath: src.valuePath
			})
		})
	}

	return result
}

class SyncRunTimeout extends Error {}
DGraph.SyncRunTimeout = SyncRunTimeout

DGraph.version = '0.5.4'

module.exports = DGraph
