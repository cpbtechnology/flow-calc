const DGraph = require('./index')
const yargs = require('yargs')

const args = yargs.option('graph-definitions', {
	alias: 'g',
	array: true,
	describe: 'Paths to json files describing your graph. The first graph in this list will be treated as the top-level graph. Other graph definitions will be appended as `graph` nodes and their filenames will be used as the node names. Currently only subgraphs one level deep are supported.'
}).option('inputs', {
	alias: 'i',
	describe: 'Path to json file defining a plain object as input to the graph definition.'
}).demandOption(
	['graph-definitions', 'inputs'], 
	'Please provide both graph-definitions and inputs.'
).help().argv

function tryToLoad(path) {
	let result
	const prefixes = [__dirname, process.cwd(), '']
	for (let prefix of prefixes) {
		if (!result) {
			try {
				result = require(`${prefix}/${path}`)
			}
			catch (e) { }
		}
	}
	if (!result) {
		throw new Error(`Could not find ${path}.`)
	}
	return result
}

let graphDefs = {}

function getFilename (path) {
	return path.split('/').pop().split('.').slice(0, -1).join('.')
}

let mainGraph
args['graph-definitions'].forEach((path, i) => {
	const graphDef = tryToLoad(path)
	const fileName = getFilename(path)
	if (Object.values(graphDef).includes(fileName)) {
		throw new Error(`Multiple graph definitions found named ${fileName}.`)
	}
	graphDefs[fileName] = graphDef
	if (i === 0) {
		mainGraph = graphDef
	}
})

let fullGraphDef = [
	...mainGraph
]
Object.keys(graphDefs).filter(name => name !== 'main').forEach(subgraphName => {
	const graphDef = graphDefs[subgraphName]
	const inputNames = DGraph.collectExpectedInputNames(graphDef)
	fullGraphDef.push({ 
		name: subgraphName, 
		type: 'graph', 
		graphDef,
		inputs: mainGraph.map(node => node.name).filter(name => inputNames.includes(name))
	})
})

const inputs = tryToLoad(args['inputs'])

const g = new DGraph(fullGraphDef, 'main')
g.run(inputs).then(results => {
	console.log(JSON.stringify(results, null, 4))
})