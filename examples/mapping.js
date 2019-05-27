const DGraph = require('../src/index')

const graphDef = [
	{
		name: 'mapItem',
		type: 'graph',
		isTemplate: true,
		graphDef: [
			{
				name: 'foo',
				type: 'transform',
				fn: 'mult',
				params: {
					amt: 'inputs.bar',
					factor: 5
				}
			}
		]
	},
	{
		name: 'result',
		type: 'graph',
		graphDef: 'mapItem',
		collectionMode: 'map',
		inputs: 'inputs.itemsToBeMapped.*'
	}
]

const dGraph = new DGraph(graphDef)
dGraph.run({
	itemsToBeMapped: [
		{ bar: 2 },
		{ bar: 3 },
		{ bar: 5 }
	]
}).then((result) => {
	console.log(result) // eslint-disable-line no-console
})
