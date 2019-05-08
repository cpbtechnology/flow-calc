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
			catch (e) {}
		}
	}
	if (!result) {
		throw new Error(`Could not load ${path}. There may be a JSON syntax error.`)
	}
	return result
}

let graphDefs = {}

function getFilename (path) {
	return path.split('/').pop().split('.').slice(0, -1).join('.')
}

let mainGraph, mainGraphName
args['graph-definitions'].forEach((path, i) => {
	const graphDef = tryToLoad(path)
	const fileName = getFilename(path)
	if (Object.values(graphDef).includes(fileName)) {
		throw new Error(`Multiple graph definitions found named ${fileName}.`)
	}
	graphDefs[fileName] = graphDef
	if (i === 0) {
		mainGraph = graphDef
		mainGraphName = fileName
	}
})

let fullGraphDef = [
	...mainGraph
]
Object.keys(graphDefs).filter(name => name !== mainGraphName).forEach(subgraphName => {
	const graphDef = graphDefs[subgraphName]
	const inputNames = DGraph.collectExpectedInputNames(graphDef)
	const subgraphDef = { 
		name: subgraphName, 
		type: 'graph', 
		graphDef,
		inputs: mainGraph.map(node => node.name).filter(name => {
			// pass-through inputs
			if (name.startsWith('inputs.')) {
				name = name.slice('inputs.'.length)
			}
			console.log(`is ${name} included in`, inputNames)
			return inputNames.includes(name) 
		})
	}
	fullGraphDef.push(subgraphDef)
})

const inputs = tryToLoad(args['inputs'])

const g = new DGraph(fullGraphDef, mainGraphName)
g.run(inputs).then(results => {
	console.log(JSON.stringify(results, null, 4))
})