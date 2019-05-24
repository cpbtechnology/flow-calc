/* eslint-disable */
const DGraph = require('../../src/index')

const testGraph = [
	{ name: 'staticNode', type: 'static', value: 'hi there' },
	{ name: 'aliasNode', type: 'alias', mirror: 'inputs.something' },
	{ name: 'transformNode', type: 'transform', fn: 'mult', inputs: { amt: 4, factor: 3 }},
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
			like: 20,
			and: 7.5
		}
	}
}