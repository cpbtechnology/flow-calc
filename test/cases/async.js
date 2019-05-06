const DGraph = require('../../src/index')

// as of now, input values can be promises, 
// but nested promises are NOT supported.

const mockPromise = (v, t) => {
	return new Promise(resolve => {
		setTimeout(() => {
			resolve(v) 
		}, t || (Math.random() * 1000))
	})
}

const testGraph = [
	{ name: 'staticNode', type: 'static', value: 'hi there' },
	{ name: 'aliasNode', type: 'alias', mirror: 'inputs.something' },

	// a node can be async, but i don't think there is a real use for this.
	{ name: 'asyncNode', type: 'async', promise: mockPromise('async inline node, yo') },

	{ name: 'transformNode', type: 'transform', fn: 'mult', inputs: { amt: 4, factor: 3 }},

	// because this depends on `inputs.nested.like` it will not compute correctly
	{ name: 'nestedInputTransform', type: 'transform', fn: 'mult', inputs: {
		amt: 'inputs.nested.like', factor: 'inputs.nested.and'
	} }
]

module.exports = {
	dGraph: new DGraph(testGraph, 'testGraph'),
	inputs: {
		something: 5, 
		nested: {
			here: 'are',
			some: 'values',
			like: mockPromise(20),	// not supported!
			and: 7.5
		},
		topLevelInputAsync: mockPromise('baby')
	}
}