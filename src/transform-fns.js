const _ = require('lodash')

const addN = (items) => _.values(items).reduce((t, a) => t + a, 0)
const andN = (items) => _.values(items).reduce((t, v) => !!t && !!v, true)
const orN = (items) => _.values(items).reduce((t, v) => t || v, false)
const concatN = (items) => _.values(items).reduce((t, a) => t + a, '')

const not = ({item}) => _.isBoolean(item) && !item

const add = ({ a, b }) => a + b
const sub = ({ a, b }) => a - b
const addFactor = ({ amt, factor }) => amt + (amt * factor)
const mult = ({ amt, factor }) => amt * factor
const includes = ({ item, isIncludedIn }) => isIncludedIn.includes(item)
const isNonEmptyString = ({item}) => item && _.isString(item) && item.trim().length > 0


module.exports = {
	addN,
	addFactor,
	mult,
	add,
	sub,
	includes,
	andN,
	orN,
	not,
	isNonEmptyString,
	concatN
}
