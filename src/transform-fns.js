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

// optionally accept a value; if undefined assume `true`
const _filterFn = ({ path, value }) => ((item) => !!(getValueAtPath(item, path) === (_.isUndefined(value) ? true : value)))
const _filterNotFn = ({ path, value }) => ((item) => !(getValueAtPath(item, path) === (_.isUndefined(value) ? true : value)))

const addN = (items) => extractNItems(items).reduce((t, a) => t + a, 0)
const andN = (items) => extractNItems(items).reduce((t, v) => !!t && !!v, true)
const orN = (items) => extractNItems(items).reduce((t, v) => t || v, false)
const concat = (items) => extractNItems(items).reduce((t, a) => t + a, '')
const filter = ({ collection, path, value }) => extractNItems(collection).filter(_filterFn({ path, value }))
const filterNot = ({ collection, path, value }) => extractNItems(collection).filter(_filterNotFn({ path, value }))
const find = ({ collection, propName, propValue }) => extractNItems(collection).find(item => item[propName] === propValue)

const not = ({item}) => _.isBoolean(item) && !item

const ternary = ({ test, pass, fail }) => !!test ? pass : fail



const add = ({ a, b }) => a + b
const sub = ({ a, b }) => a - b
const addFactor = ({ amt, factor }) => amt + (amt * factor)
const subFactor = ({ amt, factor }) => amt - (amt * factor)
const mult = ({ amt, factor }) => amt * factor
const div = ({ num, dem }) => num / dem
const round = ({ amt }) => Math.round(amt)
const ceil = ({ amt }) => Math.ceil(amt)
const floor = ({ amt }) => Math.floor(amt)
const max = ({ a, b }) => Math.max(a, b)
const min = ({ a, b }) => Math.min(a, b)
const gt = ({ a, b }) => !!(a > b)
const lt = ({ a, b }) => !!(a < b)
const gte = ({ a, b }) => !!(a >= b)
const lte = ({ a, b }) => !!(a <= b)
const eq = ({ a, b }) => !!(a === b)
const clamp = ({ amt, min, max }) => Math.max(min, Math.min(max, amt))
const roundCurrency = ({ amt }) => {
	let r = amt
	try { r = Number(amt.toFixed(2)) } catch (error) { console.log(`unable to round ${amt}`) }
	return r
}
const includes = ({ item, isIncludedIn }) => isIncludedIn.includes(item)
const isNonEmptyString = ({item}) => !!item && _.isString(item) && item.trim().length > 0

const map = ({ collection, fn, params }) => collection.map(item => {
	const args = _.mapValues(params, localPath => getValueAtPath(item, localPath))
	return module.exports[fn](args)
})

const pick = ({ src, propNames }) => _.pick(src, propNames)
const omit = ({ src, propNames }) => _.omit(src, propNames)
const merge = ({ a, b }) => _.merge({}, a, b)
const box = ({ value, propName }) => ({ [propName]: value })

// note currently can't get path values for a nested array of paths, so can only add one prop at a time.
const addProp = ({ src, propName, propValue }) => _.merge({}, src, { [propName]: propValue })

module.exports = {
	addN,
	addFactor,
	subFactor,
	mult,
	div,
	round,
	ceil,
	floor,
	max,
	min,
	gt,
	lt,
	gte,
	lte,
	eq,
	clamp,
	roundCurrency,
	add,
	sub,
	includes,
	andN,
	orN,
	not,
	ternary,
	isNonEmptyString,
	concat,
	filter,
	filterNot,
	find,
	map,
	pick,
	omit,
	merge,
	box,
	addProp
}
