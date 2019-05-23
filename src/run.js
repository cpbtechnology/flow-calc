const DGraph = require('./index')
const yargs = require('yargs')

const args = yargs.option('graph-definitions', {
	alias: 'g',
	array: true,
	describe: 'Paths to json files describing your graph. The first graph in this list will be treated as the top-level graph. Other graph definitions will be appended as `graph` nodes and their filenames will be used as the node names. Currently only subgraphs one level deep are supported.'
}).option('inputs', {
	alias: 'i',
	describe: 'Path to json file defining a plain object as input to the graph definition.'
}).option('templates', {
	alias: 't',
	array: true,
	describe: 'Paths to json files describing template subgraphs. Treated identically to `graph-definitions` graphs but marked as templates.'
}).option('log-undefined-paths', {
	describe: '(Useful for debugging.) Log undefined paths as the graph evaluates. When no undefined paths remain, the graph should be fulfilled.',
	boolean: true
}).option('log-literals', {
	describe: '(Useful for debugging.) If the input string to a transform or subgraph cannot be resolved as a node name, it will be interpreted as a string literal. \
When this option is set, a log will be emitted for all such literals. This can help catch misspelled node names.',
	boolean: true
}).option('echo-inputs', {
	describe: 'Include input values in the fulfilled graph value.',
	boolean: true
}).option('echo-templates', {
	describe: 'Include templates in the fulfilled graph value.',
	boolean: true
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
			catch (e) {}  // eslint-disable-line no-empty
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
	const subgraphDef = { 
		name: subgraphName, 
		type: 'graph', 
		graphDef
	}
	fullGraphDef.push(subgraphDef)
})

if (args['templates']) {
	args['templates'].forEach(path => {
		const graphDef = tryToLoad(path)
		const fileName = getFilename(path)
		if (Object.values(graphDef).includes(fileName)) {
			throw new Error(`Multiple graph definitions found named ${fileName}.`)
		}
		const subgraphDef = { 
			name: fileName, 
			type: 'graph', 
			isTemplate: true,
			graphDef
		}
		fullGraphDef.push(subgraphDef)
	})
}


const inputs = tryToLoad(args['inputs'])

const options = {
	logUndefinedPaths: !!args['log-undefined-paths'],
	echoInputs: !!args['echo-inputs'],
	logLiterals: !!args['log-literals'],
	echoTemplates: !!args['echo-templates']
}

// console.log(fullGraphDef.filter(d => d.type === 'graph'))
const g = new DGraph(fullGraphDef, mainGraphName, options)
g.run(inputs).then(results => {
	console.log(` --- graph fulfilled --- `) // eslint-disable-line no-console
	console.log(JSON.stringify(results, null, 4)) // eslint-disable-line no-console
})