const _ = require('lodash')
const { getValueAtPath } = require('./object-path-utils')

/**
 * Try to extract an array of values from arguments to the
 * xxxN functions. 
 * 
 * Bit cheesy to accept all these variants. 
 * 
 * @param {*} items 
 */
const extractNItems = (items) => {
	if (_.isObject(items)) {
		return _.flattenDeep(_.values(items))
	}
	else if (_.isArray(items)) {
		return _.flattenDeep(items)
	}
}

const addN = (items) => extractNItems(items).reduce((t, a) => t + a, 0)
const andN = (items) => extractNItems(items).reduce((t, v) => !!t && !!v, true)
const orN = (items) => extractNItems(items).reduce((t, v) => t || v, false)
const concatN = (items) => extractNItems(items).reduce((t, a) => t + a, '')
const filterN = ({ collection, path }) => extractNItems(collection).filter(item => !!getValueAtPath(item, path))
const filterNotN = ({ collection, path }) => extractNItems(collection).filter(item => !getValueAtPath(item, path))

const not = ({item}) => _.isBoolean(item) && !item

const ternary = ({ test, pass, fail }) => test ? pass : fail

const add = ({ a, b }) => a + b
const sub = ({ a, b }) => a - b
const addFactor = ({ amt, factor }) => amt + (amt * factor)
const subFactor = ({ amt, factor }) => amt - (amt * factor)
const mult = ({ amt, factor }) => amt * factor
const div = ({ num, dem }) => num / dem
const round = ({ amt }) => Math.round(amt)
const ceil = ({ amt }) => Math.ceil(amt)
const floor = ({ amt }) => Math.floor(amt)
const roundCurrency = ({ amt }) => {
	let r = amt
	try { r = Number(amt.toFixed(2)) } catch (error) { console.log(`unable to round ${amt}`) }
	return r
}
const includes = ({ item, isIncludedIn }) => isIncludedIn.includes(item)
const isNonEmptyString = ({item}) => item && _.isString(item) && item.trim().length > 0

const map = ({ collection, fn, params }) => collection.map(item => {
	const args = _.mapValues(params, localPath => getValueAtPath(item, localPath))
	return module.exports[fn](args)
})

module.exports = {
	addN,
	addFactor,
	subFactor,
	mult,
	div,
	round,
	ceil,
	floor,
	roundCurrency,
	add,
	sub,
	includes,
	andN,
	orN,
	not,
	ternary,
	isNonEmptyString,
	concatN,
	filterN,
	filterNotN,
	map
}
