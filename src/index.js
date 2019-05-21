const { observable, autorun, toJS } = require('mobx')
const graphlib = require('graphlib')
const { flattenObject } = require('./object-path-utils')
const _ = require('lodash')
const dNodeClasses = require('./d-nodes')

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
class DGraph {
	constructor (graphDefinition, name, supergraph, options) {

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
			options = supergraph
		}

		this._graph = null
		this.isConstructed = Promise.resolve(false)
		this.options = _.defaults({}, options, {
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

	log (...args) {
		let indent = ''
		for (let i = 0; i < this.options.depth; i++) {
			indent += '  '
		}
		console.log(indent, ...args)
	}

	get rootGraph ()  {
		let supergraph = this.supergraph ? this.supergraph : this
		while (supergraph.supergraph) {
			supergraph = supergraph.supergraph
		}
		return supergraph
	}

	_preprocessGraphDef (graphDef) {

		// let's not modify the original
		let def = _.cloneDeep(graphDef)
		
		// populate alias definitions if any
		for (let nodeDef of def) {
			let aliases = nodeDef.aliases
			if (aliases) {
				if (!_.isArray(aliases)) {
					aliases = [aliases]
				}
				aliases.forEach(a => def.push({ name: a, type: 'alias', mirror: nodeDef.name }))
			}
		}
		
		// create an inputs node
		def.push({ name: 'inputs', type: 'inputs', value: {} })

		// for nodes with inputs or params, work out if there are any literals in the def.
		// if so, create new static nodes for those values.
		const nodeNames = def.map(n => n.name)
		const literalNodes = []
		for (let nodeDef of def) {
			const pathPropertyNames = dNodeClasses[nodeDef.type].getNodeDefPathPropertyNames()
			for (let pathPropertyName of pathPropertyNames) {
				const pathPropertyValue = nodeDef[pathPropertyName]
				if (pathPropertyValue) {
					const normalizedPathDefs = this.normalizePathDef(pathPropertyValue)
					const keys = _.keys(normalizedPathDefs)
					for (let key of keys) {
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

	_build () {
		this._graph = new graphlib.Graph({
			directed: true,
			multigraph: true
		})
		let resolveGraphIsConstructed
		let resolveGraphIsConnected

		this.isConstructed = new Promise((resolve, reject) => {
			resolveGraphIsConstructed = resolve
		})
		this.isConnected = new Promise((resolve, reject) => {
			resolveGraphIsConnected = resolve
		})

		const graphDef = this._preprocessGraphDef(this.graphDefinition)

		const dNodes = graphDef.map(nodeDef => {
			const DNodeClass = dNodeClasses[nodeDef.type]
			if (!DNodeClass) {
				throw new Error(`Unknown node type: ${nodeDef.type}.`)
			}
			return new DNodeClass(this, nodeDef)
		})

		let subgraphsConstructedPromises = []

		for (let dNode of dNodes) {
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

		Promise.all(subgraphsConstructedPromises).then(() => {
			// TODO: this seems not to be doing quite the right thing yet.
			for (let dNode of dNodes) {
				const dependentNodeIds = _.uniq(DGraph.collectDependeeNodeIds(dNode))
				for (let nodeId of dependentNodeIds) {
					this._graph.setEdge(nodeId, dNode.name)
				}
			}
			resolveGraphIsConnected()
		})
	}

	getUndefinedPaths (obj = null) {
		const collectUndefinedPathsInObject = obj => {
			const flattened = flattenObject(obj)
			return _.keys(flattened).filter(k => _.isUndefined(flattened[k]) || _.isNaN(flattened[k]))
		}
		return obj ? collectUndefinedPathsInObject(obj) : collectUndefinedPathsInObject(this.getState())
	}

	shouldIncludeNodeValue (dNode) {
		let result = !name.startsWith('#') && (!(dNode instanceof dNodeClasses.inputs) || this.options.echoInputs)
		result = result && dNode.echoTo
		return result
	}

	getState () {
		const nodeValues = {}
		try {
			this._graph.nodes().forEach(nodeId => {
				const dNode = this._graph.node(nodeId)
				const name = dNode.name
				let value = dNode.value
				if (dNode.isVisibleInGraphState) {
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

	run (inputs) {
		const expectedInputNames = _.uniq(DGraph.collectExpectedInputNames(this.graphDefinition))
		const actualInputNames = _.keys(inputs)
		const missingInputs = []
		for (let expectedInputName of expectedInputNames) {
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
						if (dispose) {
							dispose()
						}
					}
					else {
						if (this.options.logUndefinedPaths) {
							this.logUndefinedPaths(undefinedPaths)
						}
					}
				}
				catch (error) {
					this.log(`Error caught reading nodes from [${this.name}]. ${error}.`)
					this.log(error.stack)
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

	logUndefinedPaths (undefinedPaths) {
		// let sortedNodeIds = graphlib.alg.topsort(this._graph)
		// sortedNodeIds = sortedNodeIds.filter(id => undefinedPaths.includes(id))
		this.log(`[log-undefined-paths] Undefined paths in '${this.name}':`)
		for (let nodeId of undefinedPaths) {
			// const predecessors = this._graph.predecessors(nodeId)
			this.log(`    '${nodeId}'`)
			// if (predecessors && predecessors.length) {
			// 	this.log(`     <- ${predecessors.join(', ')}`)
			// }
			
		}
	}

	getDNode (name, searchAncestors = false) {
		let node = this._graph.node(name)
		if (!node && searchAncestors && this.supergraph) {
			return this.supergraph.getDNode(name, searchAncestors)
		}
		return node
	}

	/**
	 * 
	 * @param {*} inputs a plain object. values can be either promises or plain values.
	 */
	setInputs (inputs) {
		const dNode = this._graph.node('inputs')
		for (const k in inputs) {
			const existingNode = this._graph.node(k)
			if (existingNode && existingNode.type !== 'echo') {
				throw new Error(`Input name '${k}' conflicts with existing node '${k}' in graph '${this.name}'.`)
			}
			const value = inputs[k]
			if (value && _.isFunction(value.then)) {
				value.then(result => {
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
	let result = {
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
	let paths = [], propNames = []

	// make keys not look like paths.
	const mangleKeyPath = p => p//.replace('.', '$')

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
DGraph.collectExpectedInputNames = (graphDef) => {
	return DGraph.collectExpectedInputPaths(graphDef).map(path => path.split('.')[0])
}

/**
 * Traverse nodes and if any node depends on the `inputs` node,
 * collect the full path of that dependency, except for `inputs.` at the 
 * beginning of the path (that part is assumed).
 * 
 * Relies on DNode class advertising their property names that will refer
 * to other nodes in `getNodeDefPathPropertyNames`.
 */
DGraph.collectExpectedInputPaths = (graphDef) => {
	let result = []
	for (let nodeDef of graphDef) {
		const pathPropertyNames = dNodeClasses[nodeDef.type].getNodeDefPathPropertyNames()
		pathPropertyNames.forEach(propName => {
			// prop name on node def
			const normalizedPaths = DGraph.normalizePathDef(nodeDef[propName])
			const inputPaths = _.values(normalizedPaths).filter(value => _.isString(value) && value.startsWith('inputs.'))
			result = result.concat(inputPaths.map(path => path.split('.').slice(1).join('.')))
		})
	}
	return result
}

/**
 * Collect names of nodes that this node refers to; ie, that it depends upon.
 * 
 * TODO: possibly not yet working correctly.
 */
DGraph.collectDependeeNodeIds = (dNode) => {
	let result = []
	const pathPropertyNames = dNodeClasses[dNode.type].getNodeDefPathPropertyNames()
	for (let propName of pathPropertyNames) {
		const normalizedPaths = DGraph.normalizePathDef(dNode.originalNodeDef[propName])
		const pairs = _.values(normalizedPaths).map(DGraph.srcFromPath)
		result = result.concat(pairs.map(p => p.nodeId))
	}
	result = _.uniq(result)
	// console.log(`dependent node ids of ${dNode.name}`, result)
	return result
}

class SyncRunTimeout extends Error {}
DGraph.SyncRunTimeout = SyncRunTimeout

module.exports = DGraph