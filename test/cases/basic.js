/* eslint-disable */
const DGraph = require('../../src/index')

const testGraph = [
	{ name: 'staticNode', type: 'static', value: 'hi there' },
	{ name: 'aliasNode', type: 'alias', mirror: 'inputs.something' },
	{ name: 'transformNode', type: 'transform', fn: 'mult', inputs: { amt: 4, factor: 3 }}
]

module.exports = {
	dGraph: new DGraph(testGraph, 'testGraph'),
	inputs: { something: 5 }
}