const { observable, autorun, toJS } = require('mobx')
const graphlib = require('graphlib')
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
 */
class DGraph {
	constructor (graphDefinition, name, options) {

		if (!graphDefinition) {
			throw new Error('No graph definition was supplied.')
		}

		this.graphDefinition = graphDefinition
		this.name = name || `Unnamed-DGraph-${nGraphs++}`
		this._graph = null
		this.isConstructed = Promise.resolve(false)
		this.options = _.defaults({}, options, {
			echoInputs: false,
			depth: 0
		})

		this.normalizeInputDef = DGraph.normalizeInputDef

		this._build()
	}

	log (...args) {
		let indent = ''
		for (let i = 0; i < this.options.depth; i++) {
			indent += '  '
		}
		console.log(indent, ...args)
	}

	_preprocessGraphDef (graphDef) {

		// let's not modify the original
		let def = _.cloneDeep(graphDef)
		
		// populate alias definitions if any
		for (let dNode of def) {
			let aliases = dNode.aliases
			if (aliases) {
				if (!_.isArray(aliases)) {
					aliases = [aliases]
				}
				aliases.forEach(a => def.push({ name: a, type: 'alias', mirror: dNode.name }))
			}
		}
		
		// create an inputs node
		def.push({ name: 'inputs', type: 'inputs', value: {} })

		// for nodes with inputs, work out if there are any
		// literals in the def. if so, create new static nodes for 
		// those values.
		const nodeNames = def.map(n => n.name)
		const nodesWithInputs = def.filter(n => !!n.inputs)
		nodesWithInputs.forEach(n => {
			const normalizedInputDef = this.normalizeInputDef(n.inputs)
			const keys = _.keys(normalizedInputDef)
			keys.forEach(key => {
				const value = normalizedInputDef[key]
				const valueIsString = _.isString(value)
				let possibleNodeName = valueIsString ? value : ''
				if (valueIsString) {
					possibleNodeName = value.includes('.') ? value.split('.')[0] : value
				}
				if (!valueIsString || !nodeNames.includes(possibleNodeName)) {
					const newNodeName = `#${n.name}#input-alias#${key}`
					def.push({ name: newNodeName, type: 'static', value })
					normalizedInputDef[key] = newNodeName
				}
			})
			n.inputs = normalizedInputDef
		})

		return def
	}

	_build () {
		this._graph = new graphlib.Graph({
			directed: true,
			multigraph: true
		})
		let resolveGraphIsConstructed

		this.isConstructed = new Promise((resolve, reject) => {
			resolveGraphIsConstructed = resolve
		})

		const graphDef = this._preprocessGraphDef(this.graphDefinition)

		const dNodes = graphDef.map(nodeDef => {
			const DNodeClass = dNodeClasses[nodeDef.type]
			if (!DNodeClass) {
				throw new Error(`Unknown node type: ${nodeDef.type}.`)
			}
			return new DNodeClass(this, nodeDef)
		})

		for (let dNode of dNodes) {
			// this.log(`creating node ${dNode.name}`)
			this._graph.setNode(dNode.name, dNode)
		}

		// todo: wire up graph edges ... not that we're using them at the moment.

		this.resolutionError = null
		this.isSettled = observable.box(false)
		this.isSettledPromise = null

		// this.log(`[${this.name}] is constructed`)
		resolveGraphIsConstructed()
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

		// this.log(`[${this.name}] running with inputs`, inputs)

		this.setInputs(inputs)
		
		let dispose
		return new Promise((resolve, reject) => {
			dispose = autorun(() => {
				const nodeValues = {}
				try {
					this._graph.nodes().forEach(nodeId => {
						const dNode = this._graph.node(nodeId)
						const name = dNode.name
						let value = dNode.value
						if (!name.startsWith('#') && (!name.startsWith('inputs.') || this.options.echoInputs)) {
							nodeValues[name] = toJS(value)
						}
					})
					if (!_.values(nodeValues).some(_.isUndefined)) {
						resolve(nodeValues)
						if (dispose) {
							dispose()
						}
					}
				}
				catch (error) {
					this.log(`Error caught reading nodes from [${this.name}] ${error}.`)
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

	getDNode (name) {
		return this._graph.node(name)
	}

	/**
	 * 
	 * @param {*} inputs a plain object. values can be either promises or plain values.
	 */
	setInputs (inputs) {
		const dNode = this._graph.node('inputs')
		for (const k in inputs) {
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

DGraph.normalizeInputDef = (inputDef) => {
	let srcPaths = [], inputNames = []
	if (_.isArray(inputDef)) {
		srcPaths = _.clone(inputDef)
		inputNames = _.clone(inputDef)
	}
	else if (_.isString(inputDef)) {
		srcPaths = [inputDef]
		inputNames = [inputDef]
	}
	else {
		srcPaths = _.values(inputDef)
		inputNames = _.keys(inputDef)
	}
	return _.zipObject(inputNames, srcPaths)
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
 */
DGraph.collectExpectedInputPaths = (graphDef) => {
	let result = []
	for (let nodeDef of graphDef) {
		if (nodeDef.inputs || nodeDef.mirror) {
			const normalizedInputs = DGraph.normalizeInputDef(nodeDef.inputs || nodeDef.mirror)
			const inputPaths = _.values(normalizedInputs).filter(value => _.isString(value) && value.startsWith('inputs.'))
			result = result.concat(inputPaths.map(path => path.split('.').slice(1).join('.')))
		}
	}
	return result
}

module.exports = DGraph