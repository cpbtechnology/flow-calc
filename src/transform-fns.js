const _ = require('lodash')

const addN = (items) => _.values(items).reduce((t, a) => t + a, 0)
const andN = (items) => _.values(items).reduce((t, v) => !!t && !!v, true)
const orN = (items) => _.values(items).reduce((t, v) => t || v, false)
const concatN = (items) => _.values(items).reduce((t, a) => t + a, '')

const not = ({item}) => _.isBoolean(item) && !item

const ternary = ({ test, pass, fail }) => test ? pass : fail

const add = ({ a, b }) => a + b
const sub = ({ a, b }) => a - b
const addFactor = ({ amt, factor }) => amt + (amt * factor)
const subFactor = ({ amt, factor }) => amt - (amt * factor)
const mult = ({ amt, factor }) => amt * factor
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


module.exports = {
	addN,
	addFactor,
	subFactor,
	mult,
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
	concatN
}
