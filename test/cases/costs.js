const DGraph = require('../../src/index')

const effectiveBorrowerDayrate = [
	{ name: 'result', type: 'transform', }
]

const testGraph = [
	{ name: 'terms', type: 'alias', mirror: 'inputs.terms' },
	{ name: 'usage', type: 'alias', mirror: 'inputs.usage' },

	{ name: 'advertisedDayrate', type: 'transform', fn: 'addFactor', inputs: {
		amt: 'terms.tierDayrate',
		factor: 'terms.dayrateAdjustmentFactor'
	} },
	{ name: 'borrowerCommissionPerDay', type: 'transform', fn: 'mult', inputs: {
		amt: 'advertisedDayrate',
		factor: 'terms.borrowerCommissionRate'
	} },
	{ name: 'effectiveBorrowerDayrate', type: 'graph', graphDef: effectiveBorrowerDayrate, inputs: { terms: 'terms' } },
	{ name: 'aliasNode', type: 'alias', mirror: 'inputs.something' },
	{ name: 'transformNode', type: 'transform', fn: 'mult', inputs: { amt: 4, factor: 3 }}
]

const g = new DGraph(testGraph, 'testGraph')
g.run({
	something: 5
}).then(result => {
	console.log('done')
	console.log(result)
})