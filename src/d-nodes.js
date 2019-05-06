const _ = require('lodash')
const { decorate, observable, computed, runInAction, autorun, toJS } = require('mobx')
const { fromPromise } = require('mobx-utils')
const { getValueAtPath } = require('./object-path-utils')
const transformFns = require('./transform-fns')

const parseSrcPath = (srcPath) => {
	const bits = srcPath.split('.')
	let result = {
		nodeId: srcPath,
		valuePath: undefined
	}
	if (bits.length > 1) {
		result.nodeId = bits.slice(0, 1)
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
		const rawGraph = this.dGraph._graph
		const dNode = rawGraph.node(nodeId)
		if (!dNode) {
			this.log(`undefined dNode for id ${nodeId} in graph ${this.dGraph.name} (path ${valuePath})`)
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
		const inputs = dGraph.normalizeInputDef(nodeDef.inputs)
		this.inputs = _.mapValues(inputs, parseSrcPath)
		this.subgraph = new DGraph(nodeDef.graphDef, `${dGraph.name}.${this.name}`, { depth: dGraph.options.depth + 1 })
		this.promise = fromPromise(new Promise((resolve, reject) => {
			this.resolveNode = resolve
			this.rejectNode = reject
		}))

		this.dGraph.isConstructed.then(() => {
			let dispose
			dispose = autorun(() => {
				const args = _.mapValues(this.inputs, src => {
					return this.getGraphValueAt(src.nodeId, src.valuePath)
				})
				if (!_.values(args).some(_.isUndefined)) {
					this.subgraph.run(toJS(args)).then(result => {
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
	transform: TransformDNode,
	inputs: InputsDNode,
	async: AsyncDNode,
	graph: GraphDNode
}