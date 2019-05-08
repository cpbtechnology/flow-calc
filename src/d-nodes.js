const _ = require('lodash')
const { decorate, observable, computed, runInAction, autorun, toJS } = require('mobx')
const { fromPromise } = require('mobx-utils')
const { getValueAtPath, expandObject } = require('./object-path-utils')
const transformFns = require('./transform-fns')

const parseSrcPath = (srcPath) => {
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

class DNode {
	constructor (dGraph, nodeDef) {
		this.name = nodeDef.name
		this.dGraph = dGraph
	}

	get value () {
		return undefined
	}

	log (...args) {
		this.dGraph.log(...args)
	}

	getGraphValueAt (nodeId, valuePath) {
		let dNode = this.dGraph.getDNode(nodeId)
		if (!dNode) {
			this.log(`No dNode with id '${nodeId}' found in in graph '${this.dGraph.name}' (value path '${valuePath}'). Requesting node: '${this.name}'.`)
		}
		let nodeValue = dNode.get ? dNode.get() : dNode.value
		nodeValue = (nodeValue && nodeValue.get) ? nodeValue.get() : nodeValue
		let result = !_.isUndefined(nodeValue) ? toJS(nodeValue) : undefined
		if (!_.isUndefined(nodeValue) && !_.isUndefined(valuePath)) {
			try {
				result = getValueAtPath(nodeValue, valuePath)
			}
			catch (error) {
				console.error(error)
			}
		}
		
		return result
	}

	get type () {
		return this.constructor.name
	}
}


class StaticDNode extends DNode {
	constructor (dGraph, nodeDef) {
		super(dGraph, nodeDef)
		this.originalValue = nodeDef.value
	}

	get value () {
		return this.originalValue
	}
}

decorate(StaticDNode, { value: computed })

class AliasDNode extends DNode {
	constructor (dGraph, nodeDef) {
		super(dGraph, nodeDef)
		this.mirror = parseSrcPath(nodeDef.mirror)
	}

	get value () {
		return this.getGraphValueAt(this.mirror.nodeId, this.mirror.valuePath)
	}
}

decorate(AliasDNode, { value: computed })

class DereferenceDNode extends DNode {
	constructor (dGraph, nodeDef) {
		super(dGraph, nodeDef)
		// const inputs = _.mapValues(dGraph.normalizeInputDef(nodeDef.inputs), parseSrcPath)
		// console.log(`dereference node inputs`, inputs)
		this.objectPath = parseSrcPath(nodeDef.inputs.objectPath)
		this.propNamePath = parseSrcPath(nodeDef.inputs.propNamePath)
	}

	get value() {
		const object = this.getGraphValueAt(this.objectPath.nodeId, this.objectPath.valuePath)
		const propName = this.getGraphValueAt(this.propNamePath.nodeId, this.propNamePath.valuePath)
		return object[propName]
	}
}

class TransformDNode extends DNode {
	constructor (dGraph, nodeDef) {
		super(dGraph, nodeDef)
		this.fn = transformFns[nodeDef.fn]
		const inputs = dGraph.normalizeInputDef(nodeDef.inputs)
		this.inputs = _.mapValues(inputs, parseSrcPath)
	}

	get value () {
		const args = _.mapValues(this.inputs, src => {
			return this.getGraphValueAt(src.nodeId, src.valuePath)
		})
		if (_.isArray(args) && !args.some(_.isUndefined)) {
			return this.fn(args)
		}
		else if (_.values(args).length && !_.values(args).some(_.isUndefined)) {
			return this.fn(args)
		}
		return undefined
	}
}

decorate(TransformDNode, { value: computed })

class InputsDNode extends DNode {
	constructor (dGraph, nodeDef) {
		super(dGraph, nodeDef)
		this._value = observable.object({})
		
	}

	get value () {
		return this._value
	}

	setValue (key, value) {
		runInAction(() => {
			this._value[key] = value
		})
	}
}

decorate(InputsDNode, { value: computed })

class AsyncDNode extends DNode {
	constructor (dGraph, nodeDef) {
		super(dGraph, nodeDef)
		this.promise = fromPromise(nodeDef.promise)
	}

	get value () {
		return this.promise.value
	}
}

decorate(AsyncDNode, { 
	value: computed,
	promise: observable
})

let DGraph

class GraphDNode extends DNode {
	constructor (dGraph, nodeDef) {
		super(dGraph, nodeDef)
		if (!DGraph) {
			DGraph = require('./index')
		}
		const expectedInputPaths = DGraph.collectExpectedInputPaths(nodeDef.graphDef)
		
		const inputs = dGraph.normalizeInputDef(expectedInputPaths)
		// const inputs = dGraph.normalizeInputDef(nodeDef.inputs)
		this.inputSrcs = _.mapValues(inputs, parseSrcPath)
		// console.log('--- this.inputSrcs begin')
		// console.log(JSON.stringify(this.inputSrcs))
		// console.log('--- this.inputSrcs end')
		this.subgraph = new DGraph(nodeDef.graphDef, `${dGraph.name}.${this.name}`, { depth: dGraph.options.depth + 1 })
		this.promise = fromPromise(new Promise((resolve, reject) => {
			this.resolveNode = resolve
			this.rejectNode = reject
		}))

		this.dGraph.isConstructed.then(() => {
			let dispose
			dispose = autorun(() => {
				let args = _.mapValues(this.inputSrcs, src => {
					let result
					if (!this.dGraph.getDNode(src.nodeId)) {
						// super doesn't have the node named nodeId. 
						// try the supergraph's inputs node, reinterpreting this source's 
						// nodeId as a top level property name on the supergraph's inputs. 
						// this allows for pass-through of the supergraph's `inputs`.
						const valuePath = src.valuePath && src.valuePath.length ? `${src.nodeId}.${src.valuePath}` : src.nodeId
						result = this.getGraphValueAt('inputs', valuePath)
					}
					else {
						result = this.getGraphValueAt(src.nodeId, src.valuePath)
					}
					return result
				})
				
				args = expandObject(toJS(args))

				if (!_.values(args).some(_.isUndefined)) {
					this.subgraph.run(args).then(result => {
						this.resolveNode(result)
						if (dispose) {
							dispose()
						}
					}, (error) => {
						this.rejectNode(error)
						if (dispose) {
							dispose()
						}
					})
				}
			})
		})
		
	}

	get value () {
		return this.promise ? toJS(this.promise.value) : undefined
	}
}

decorate(GraphDNode, { 
	value: computed,
	promise: observable
})

module.exports = {
	static: StaticDNode,
	alias: AliasDNode,
	dereference: DereferenceDNode,
	transform: TransformDNode,
	inputs: InputsDNode,
	async: AsyncDNode,
	graph: GraphDNode
}