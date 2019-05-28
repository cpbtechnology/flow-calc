const _ = require('lodash')
const { decorate, observable, computed, runInAction, autorun, toJS } = require('mobx')
const { fromPromise } = require('mobx-utils')
const { getValueAtPath, expandObject } = require('./object-path-utils')
const transformFns = require('./transform-fns')


/**
 * Supports using "*" to return an array of items.
 *
 * "path.to.array.*" => <items of collection>
 * "path.to.array.*.path.in.item" => <extract value from each item in collection>
 *
 * @param {*} obj
 * @param {*} path
 */
const getValueAtPathWithArraySupport = (obj, path) => {
	let result

	if (path.includes('*')) {
		// this regex supports "before.*.after", "before.*" and "*.after", with the caveat
		// that we have to remove dots by hand to get usable paths.
		const matches = path.match(/^(.+\.)?\*(\..+)?$/)
		if (matches && matches.length === 3) {
			// remove dots where needed ...
			const pathToArray = matches[1] ? matches[1].substring(0, matches[1].length - 1) : ''
			const pathAfterArray = matches[2] ? matches[2].substring(1) : ''

			// if pathToArray is empty, the obj itself is the array
			let array = pathToArray.length ? getValueAtPath(obj, pathToArray) : obj

			// TODO: not sure why/where/how an object with prop '*' is being created. work this out.
			if (_.isObject(array) && _.isArray(array['*'])) {
				array = array['*']
			}

			if (!_.isArray(array)) {
				// console.log('---')
				// console.log({ path, pathToArray, obj, array })
				// console.log('---')
				throw new Error(`getValueAtPathWithArraySupport: Value at '${pathToArray}' is not an array. Passed path '${path}', obj ${obj}`)
			}
			else {
				result = array.map((item) => {
					if (pathAfterArray.length) {
						return getValueAtPath(item, pathAfterArray)
					}
					return item
				})
			}
		}
		else {
			throw new Error(`Unsupported array syntax in path '${path}'. Only a single array ".*." can be iterated over.`)
		}
	}
	else {
		result = getValueAtPath(obj, path)
	}
	return result
}

/**
 * Base class for DNodes. Construct with the graph in which the node
 * participates, and the node's definition.
 */
class DNode {
	constructor(dGraph, nodeDef) {
		this.name = nodeDef.name
		this.originalNodeDef = _.cloneDeep(nodeDef)
		this.dGraph = dGraph
		this.srcFromPath = this.dGraph.srcFromPath
		this.undefinedDependencies = [];
		this.comments = this.originalNodeDef.comments && this.originalNodeDef.comments.length ? this.originalNodeDef.comments : null
	}

	get value() {
		return undefined
	}

	log(...args) {
		this.dGraph.log(...args)
	}


	getGraphValueAt(srcPath) {
		let nodeId; let
valuePath

		if (_.isObject(srcPath)) {
			nodeId = srcPath.nodeId
			valuePath = srcPath.valuePath
		}
		else if (_.isString(srcPath)) {
			const src = this.srcFromPath(srcPath)
			nodeId = src.nodeId
			valuePath = src.valuePath
		}

		const dNode = this.dGraph.getDNode(nodeId)
		if (!dNode) {
			this.log(`No dNode with id '${nodeId}' found in in graph '${this.dGraph.name}' (value path '${valuePath}'). Requesting node: '${this.name}'.`)
		}

		let nodeValue = dNode.get ? dNode.get() : dNode.value

		// note check for not being an array.
		nodeValue = (nodeValue && nodeValue.get && !_.isArray(nodeValue)) ? nodeValue.get() : nodeValue

		let result = !_.isUndefined(nodeValue) ? toJS(nodeValue) : undefined

		if (!_.isUndefined(result) && !_.isUndefined(valuePath)) {
			result = getValueAtPathWithArraySupport(result, valuePath)
		}

		return result
	}

	get className() {
		return this.constructor.name
	}

	get type() {
		return this.originalNodeDef.type
	}

	get isVisibleInGraphState() {
		let result = true

		result = result && (!this.name.startsWith('#') || this.dGraph.options.echoIntermediates)
		result = result && (!(this instanceof InputsDNode) || this.dGraph.options.echoInputs) // eslint-disable-line no-use-before-define
		result = result && !this.originalNodeDef.isHidden

		return result
	}

	/**
	 * Properties on the nodeDef that should be treated like paths
	 * to values in the graph. Allows checking for the existence of
	 * dependent nodes and inferring whether a property value is a
	 * path to a node or a literal value.
	 *
	 * Return an object with keys that are property names and values
	 * that describe how the property names should be handled/interpreted.
	 * Currently the only such option is hasSubproperties, which is used
	 * to help describe edge i/o. This is a wee messy.
	 */
	static getPathProps() {
		return {}
	}

}

/**
 * Initial value is its forever value.
 *
 * Usage:
 *
 * { name: <node name>, type: "static", value: <any JS value> }
 */
class StaticDNode extends DNode {
	constructor(dGraph, nodeDef) {
		super(dGraph, nodeDef)
		this.originalValue = nodeDef.value
	}

	get value() {
		return this.originalValue
	}
}

decorate(StaticDNode, { value: computed })


class CommentsDNode extends DNode {
	get value() {
		return this.comments
	}
}

/**
 * Provide an alias name for a path to a value. Usage:
 *
 * { name: <node name>, type: "alias", mirror: "path.to.other.value" }
 */
class AliasDNode extends DNode {
	constructor(dGraph, nodeDef) {
		super(dGraph, nodeDef)
		// mirror prop will have been normalized to { name: path }
		this.mirrorSrcPath = _.values(nodeDef.mirror)[0]
	}

	get value() {
		return this.getGraphValueAt(this.mirrorSrcPath)
	}

	static getPathProps() {
		return { mirror: {} }
	}
}

decorate(AliasDNode, { value: computed })


/**
 * Echos to output state an input node with the same name as this node.
 * Normally, inputs cannot have names that conflict with node names. The
 * echo node is an exception to this.
 *
 * An `inputName` prop is optional but if the input name is different
 * you could probably use an alias node instead.
 */
class EchoDNode extends DNode {
	constructor(dGraph, nodeDef) {
		super(dGraph, nodeDef)
		this.inputName = nodeDef.inputName ? nodeDef.inputName : this.name
	}

	get value() {
		return this.getGraphValueAt(`inputs.${this.inputName}`)
	}

	static getPathProps() {
		return { inputName: {} }
	}
}

decorate(EchoDNode, { value: computed })

/**
 * Dereference a property using a dynamic value path.
 *
 * Usage:
 *
 * {
 *   name: <node name>,
 *   type: "dereference",
 *   objectPath: <path to `object` value to dereference>,
 *   propNamePath: <path to `propName`, a string value>
 * }
 *
 * The value of the node will be the value of object[propName].
 */
class DereferenceDNode extends DNode {
	constructor(dGraph, nodeDef) {
		super(dGraph, nodeDef)
		// normalization will have made these { name: path } pairs ... kinda silly.
		this.objectSrcPath = _.values(nodeDef.objectPath)[0]
		this.propNameSrcPath = _.values(nodeDef.propNamePath)[0]
	}

	get value() {
		const objectNodeId = this.srcFromPath(this.objectSrcPath).nodeId
		const propNameNodeId = this.srcFromPath(this.propNameSrcPath).nodeId
		if (!this.dGraph.getDNode(objectNodeId)) {
			throw new Error(`No object node '${objectNodeId}' found in graph ${this.dGraph.name}. Requesting node: ${this.name}.`)
		}
		if (!this.dGraph.getDNode(propNameNodeId)) {
			throw new Error(`No propName node '${propNameNodeId}' found in graph ${this.dGraph.name}. Requesting node: ${this.name}.`)
		}
		const object = this.getGraphValueAt(this.objectSrcPath)
		const propName = this.getGraphValueAt(this.propNameSrcPath)
		if (!_.isUndefined(object) && !_.isUndefined(propName)) {
			// note: if the object and propName are not undefined--that is, those nodes have
			// resolved--but the attempt to dereference itself fails, we set the value for this
			// node to `null` instead of `undefined` so that this node does not appear to be
			// unresolved. use a `ternary` transform node to distinguish this case and provide a
			// default value.
			return object[propName] ? object[propName] : null
		}
		return undefined
	}

	static getPathProps() {
		return {
			objectPath: {},
			propNamePath: {}
		}
		// return ['objectPath', 'propNamePath']
	}
}

decorate(DereferenceDNode, { value: computed })

/**
 * Take the values of n input nodes and output a value based on
 * one of several predefined functions.
 *
 * Usage:
 *
 * {
 *   name: <node name>,
 *   type: "transform",
 *   fn: <fn name, a function exported from transform-fns.js>
 *   params: {
 *     <...list of params, depending on fn>
 *   }
 * }
 *
 */
class TransformDNode extends DNode {
	constructor(dGraph, nodeDef) {
		super(dGraph, nodeDef)
		this.fn = transformFns[nodeDef.fn]
		if (!_.isFunction(this.fn)) {
			throw new Error(`No transform function '${nodeDef.fn}' is defined.`)
		}
		if (!nodeDef.params) {
			throw new Error(`No \`params\` defined on transform node ${nodeDef.name}.`)
		}
		this.paramSrcPaths = dGraph.normalizePathDef(nodeDef.params)
	}

	get value() {
		const args = _.mapValues(this.paramSrcPaths, srcPath => this.getGraphValueAt(srcPath))
		this.undefinedDependencies = this.dGraph.getUndefinedPaths(args)

		// helpful debugging for when there are mystery undefined nodes:
		//
		// if (this.name === 'nonDayrateDiscounts') {
		// 	console.log('nonDayrateDiscounts', args, undefinedArgs)
		// }

		return this.undefinedDependencies.length === 0 ? this.fn(args) : undefined
	}

	static getPathProps() {
		return {
			params: { hasSubproperties: true }
		}
		// return ['params']
	}
}

decorate(TransformDNode, { value: computed })

/**
 * Used internally to automatically create an `inputs` node.
 */
class InputsDNode extends DNode {
	constructor(dGraph, nodeDef) {
		super(dGraph, nodeDef)
		this._value = observable.object({})
	}

	get value() {
		return this._value
	}

	setValue(key, value) {
		runInAction(() => {
			this._value[key] = value
		})
	}
}

decorate(InputsDNode, { value: computed })

/**
 * Node with an async value. Really only used for testing, since this
 * node would not be serializable.
 */
class AsyncDNode extends DNode {
	constructor(dGraph, nodeDef) {
		super(dGraph, nodeDef)
		this.promise = fromPromise(nodeDef.promise)
	}

	get value() {
		return this.promise.value
	}
}

decorate(AsyncDNode, {
	value: computed,
	promise: observable
})

/**
 * Acts like a switch statement for other graph values, depending
 * on the value of passed `test` value as compared to elements of the
 * passed `cases` array.
 *
 * Expects a one-to-one mapping from `cases` to `nodeNames`.
 *
 * A `_default_` case can be included (& hopefully no one would ever
 * need a legit value to be "_default_").
 */
class BranchDNode extends DNode {
	constructor(dGraph, nodeDef) {
		super(dGraph, nodeDef)
		this.cases = _.cloneDeep(nodeDef.cases)
		this.test = _.cloneDeep(nodeDef.test)
		this.nodeNames = _.cloneDeep(nodeDef.nodeNames)
	}

	_switch(test, cases, values) {
		const defaultIdx = cases.findIndex('_default_')
		let result
		_.forEach(cases, (_case, i) => {
			if (test === _case) {
				result = values[i]
			}
			else if (defaultIdx !== -1) {
				result = values[defaultIdx]
			}
		})
		return result
	}

	get value() {
		const nodeName = this._switch(this.test, this.cases, this.nodeNames)
		return this.getGraphValueAt(nodeName)
	}

	static getPathProps() {
		return {
			nodeNames: {}
		}
		// return ['nodeNames']
	}
}

decorate(BranchDNode, {
	value: computed
})


let DGraph

/**
 * Create a subgraph node. The value of this node can depend on some of its
 * supergraph's nodes and its supergraph's nodes can depend on the value
 * of this node. Just be sure those are two separate sets of nodes: circular
 * dependencies will prevent the graph from ever fulfilling.
 *
 * You can supply explicit inputs with an `inputs` property. Otherwise, the
 * subgraph will attempt to find its required inputs automatically
 * from its supergraph's nodes OR, barring that, from properties on its
 * supergraph's `inputs` node.
 *
 * Usage:
 *
 * {
 *   name: <node name>,
 *   type: "graph",
 *   graphDef: <graph definition, aka an array of node definitions>
 *   [inputs]: <inputs definition (optional)>
 * }
 *
 */
class GraphDNode extends DNode {
	constructor(dGraph, nodeDef) {
		super(dGraph, nodeDef)
		if (!DGraph) {
			DGraph = require('./index') // eslint-disable-line global-require
		}

		this.collectionMode = nodeDef.collectionMode

		if (nodeDef.isTemplate) {
			this._value = `Template Node ${this.name}`
			this.isTemplate = true
		}
		else {
			// support copying another graph node's graphDef.
			if (_.isString(nodeDef.graphDef)) {
				this.dGraph.isConstructed.then(() => {

					// search up the tree.
					const templateDNode = this.dGraph.getDNode(nodeDef.graphDef, true)
					if (!templateDNode) {
						throw new Error(`Subgraph node ${this.name} cannot find graphDef template at path ${nodeDef.graphDef}.`)
					}
					this.buildWithGraphDef(nodeDef, templateDNode.originalNodeDef.graphDef)
				})
			}
			else {
				this.buildWithGraphDef(nodeDef, nodeDef.graphDef)
			}
		}
	}

	buildWithGraphDef(nodeDef, graphDef) {
		if (nodeDef.inputs) {
			const explicitInputs = this.dGraph.normalizePathDef(nodeDef.inputs)
			this.hasExplicitInputs = true
			this.inputSrcs = _.mapValues(explicitInputs, this.srcFromPath)
		}
		else {
			const expectedInputPaths = DGraph.collectExpectedInputPaths(graphDef)
			const paths = this.dGraph.normalizePathDef(expectedInputPaths)
			this.inputSrcs = _.mapValues(paths, this.srcFromPath)
		}

		// defer actually building the subgraph until time to run.
		this.graphDef = _.cloneDeep(graphDef)

		this.promise = fromPromise(new Promise((resolve, reject) => {
			this.resolveNode = (resultValue) => {
				runInAction(() => {
					this._value = resultValue
					resolve(this._value)
				})
			}
			this.rejectNode = reject
		}))

		this._value = undefined

		this.dGraph.rootGraph.isConnected.then(this.waitForFulfillment.bind(this))
	}

	/**
	 * Don't we all ... don't we all.
	 */
	waitForFulfillment() {
		let dispose
		dispose = autorun(() => { // eslint-disable-line prefer-const
			const args = this.getInputs()
			this.undefinedDependencies = this.dGraph.getUndefinedPaths(args)
			if (this.undefinedDependencies.length === 0) {
				if (this.collectionMode === 'map') {
					if (args.collection && _.isArray(args.collection)) {
						this._runAsMap(args, dispose)
					}
					else {
						throw new Error(`Graph node ${this.name}: if collectionMode is set to map, an input named \`collection\` must resolve to a single array. Passed: ${args.collection}`)
					}
				}
				// TODO: collectionMode === 'reduce' ?
				else {
					this._runOnObj(args, dispose)
				}
			}
			else if (this.dGraph.options.logUndefinedPaths) {
				this.dGraph.logUndefinedPaths(this.undefinedDependencies.map(p => `${this.name}.${p}`))
			}
		})
	}

	_runOnObj(args, dispose) {
		this.subgraph = new DGraph(
			this.graphDef,
			`${this.dGraph.name}.${this.name}`,
			this.dGraph,
			{
				...this.dGraph.options,
				depth: this.dGraph.options.depth + 1
			}
		)
		this.subgraph.run(args).then((result) => {
			if (this.dGraph.options.logUndefinedPaths) {
				this.log(`[log-undefined-paths] Subgraph '${this.name}' resolved.`)
			}
			this.resolveNode(result)
			if (dispose) {
				dispose()
			}
		}, (error) => {
			runInAction(() => {
				this.rejectNode(error)
			})
			if (dispose) {
				dispose()
			}
		})
	}

	/**
	 * Conventions for mapping a template graph over a collection of items:
	 *
	 * - The mapping node must provide an `collection` property in the graph's `inputs`.
	 * - Each item in the collection will be passed to the graph that is applied to each item as `item`.
	 * - Remaining properties in `inputs` will be available as named.
	 *
	 * So in the supergraph definition:
	 * ```
	 * {
	 *   "name": "mappingNodeName",
	 *   "type": "graph",
	 *   "collectionMode": "map",
	 *   "graphDef": "graphToBeAppliedToEachItem"
	 *   "inputs": {
	 *     "collection": "nodeThatResolvesToArrayOfObjects",
	 *     "otherArg": "someOtherArgsGoHere"
	 *   }
	 * }
	 * ```
	 *
	 * Let's say the `nodeThatResolvesToArrayOfObjects` resolves to `[{ value: 5 }, { value: 20 }]`
	 * and `someOtherArgsGoHere` resolves to the number `3`.
	 *
	 * Then `graphToBeAppliedToEachItem` could be defined as, for example:
	 *
	 * ```
	 * [{
	 *   "name": "result",
	 *   "type": "transform",
	 *   "fn": "mult",
	 *   "params": {
	 *     "amt": "inputs.item.value",
	 *     "factor": "inputs.otherArg"
	 *   }
	 * }]
	 * ```
	 *
	 * Then `mappingNodeName` should resolve to an array like `[{ result: 15 }, { result: 60 }]`.
	 *
	 * @param {*} args
	 * @param {*} dispose
	 */
	_runAsMap(args, dispose) {
		const { collection, ...itemArgs } = args
		if (!_.isArray(collection)) {
			throw new Error(`A \`collectionMode: map\` node must define a \`collection\` input that resolves to an array. Passed: ${collection}`)
		}
		this.subgraphs = []
		const promises = []
		collection.forEach((item, i) => {
			const subgraph = new DGraph(
				this.graphDef,
				`${this.dGraph.name}.${this.name}[${i}]`,
				this.dGraph,
				{
					...this.dGraph.options,
					depth: this.dGraph.options.depth + 1
				}
			)
			this.subgraphs.push(subgraph)
			promises.push(subgraph.run({ item, ...itemArgs }))
		})

		Promise.all(promises).then((results) => {
			if (this.dGraph.options.logUndefinedPaths) {
				this.log(`[log-undefined-paths] Subgraph '${this.name}' resolved.`)
			}
			this.resolveNode(results)
			if (dispose) {
				dispose()
			}
		}, (error) => {
			runInAction(() => {
				this.rejectNode(error)
			})
			if (dispose) {
				dispose()
			}
		})
	}

	getInputs() {
		let inputs
		if (this.hasExplicitInputs) {
			inputs = _.mapValues(this.inputSrcs, src => this.getGraphValueAt(src))
		}
		else {

			// No explicit inputs were provided in the graph def, so we're going to
			// try to find our inputs automatically in the supergraph.

			const args = _.mapValues(this.inputSrcs, (src) => {
				let result
				if (!this.dGraph.getDNode(src.nodeId)) {

					// Supergraph doesn't have the node named nodeId.
					// Let's try the supergraph's inputs node, reinterpreting this source's
					// nodeId as a top level property name on the supergraph's inputs.
					// This allows for pass-through of the supergraph's `inputs`.

					const valuePath = src.valuePath && src.valuePath.length ? `${src.nodeId}.${src.valuePath}` : src.nodeId

					// try the immediate supergraph
					let superGraphInputs = toJS(this.dGraph.getDNode('inputs').value)

					if (!superGraphInputs || _.isEmpty(superGraphInputs)) {
						// no inputs? try the root graph.
						superGraphInputs = toJS(this.dGraph.rootGraph.getDNode('inputs').value)
					}

					if (!_.has(superGraphInputs, src.nodeId)) {

						// If we did not find a node in the supergraph named src.nodeId,
						// and we did not find a top-level property in the supergraph's inputs
						// named src.nodeId, we are out of luck.

						throw new Error(`Subgraph '${this.name}' could not find a node or pass-through input from supergraph for expected input '${valuePath}'.`)

						// Note that we do these checks to differentiate between an undefined value
						// for an actual path versus the lack of that path completely. A path can
						// legitimately have an undefined value if some value in its dependency tree
						// is async and has not yet fultilled. We don't want to error out in the
						// latter situation, but we do want to error out in the former, because the value
						// can never be fulfilled.
					}

					result = this.getGraphValueAt(`inputs.${valuePath}`)
				}
				else {
					result = this.getGraphValueAt(src)
				}
				return result
			})

			inputs = expandObject(toJS(args))
		}
		return inputs
	}

	get value() {
		// console.log(`'${this.name}' getter returning`, this._value)
		return this._value
		// return this.promise ? toJS(this.promise.value) : undefined
	}

	get isVisibleInGraphState() {
		let result = super.isVisibleInGraphState
		result = result && (!this.isTemplate || this.dGraph.options.echoTemplates)
		return result
	}

	static getPathProps() {
		return {
			inputs: { hasSubproperties: true }
		}
		// return ['inputs']
	}

}

decorate(GraphDNode, {
	value: computed,
	_value: observable,
	promise: observable
})


module.exports = {
	static: StaticDNode,
	comments: CommentsDNode,
	alias: AliasDNode,
	echo: EchoDNode,
	dereference: DereferenceDNode,
	transform: TransformDNode,
	inputs: InputsDNode,
	async: AsyncDNode,
	branch: BranchDNode,
	graph: GraphDNode
}
