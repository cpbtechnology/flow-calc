const DGraph = require('./index')
const yargs = require('yargs')

const args = yargs.option('graph-definition', {
	alias: 'g',
	describe: 'Path to json file describing your graph. A JSON array of nodes.'
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

const graphDef = tryToLoad(args['graph-definition'])
const inputs = tryToLoad(args['inputs'])


const g = new DGraph(graphDef)
g.run(inputs).then(results => {
	console.log(JSON.stringify(results, null, 4))
})