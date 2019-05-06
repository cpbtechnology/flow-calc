/* eslint-disable no-console */
const DGraph = require('../lib')

const graphDefinition = [
	{ name: 'staticNode', type: 'static', value: 'hello, ' },
	{ name: 'aliasNode', type: 'alias', mirror: 'inputs.stringValue' },
	{ name: 'concatExample', type: 'transform', fn: 'concatN', inputs: ['staticNode', 'inputs.stringValue'] },
	{ name: 'multiplyExample', type: 'transform', fn: 'mult', inputs: { amt: 'inputs.numberValue', factor: 3 } }
]

const inputs = {
	stringValue: new Promise(r => setTimeout(() => r('world'), 500)),
	numberValue: 4
}

const dGraph = new DGraph(graphDefinition)
dGraph.run(inputs).then(result => {
	console.log(JSON.stringify(result, null, 4))
})
