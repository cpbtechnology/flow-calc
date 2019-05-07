const DGraph = require('./index')
const yargs = require('yargs')

const args = yargs.option('graph-definition', {
	alias: 'g',
	array: true,
	describe: 'Paths to json files describing your graph. The top-level graph should be called `main.json`. Other graph definitions will be appended as `graph` nodes and their filenames will be used as the node names.'
}).option('inputs', {
	alias: 'i',
	describe: 'Path to json file providing inputs to run against the graph definition.'
}).demandOption(
	['graph-definition', 'inputs'], 
	'Please provide both graph-definition and inputs.'
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

args['graph-definition'].forEach(path => {
	const graphDef = tryToLoad(path)
	const fileName = getFilename(path)
	if (Object.values(graphDef).includes(fileName)) {
		throw new Error(`Multiple graph definitions found named ${fileName}.`)
	}
	graphDefs[fileName] = graphDef
})

let mainGraph
if (!Object.keys(graphDefs).includes('main')) {
	throw new Error('At least one graph definition must be named `main`. It will be treated as the top-level graph.')
}
else {
	mainGraph = graphDefs.main
}

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