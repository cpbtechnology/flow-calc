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
	let result = items
	if (_.isObject(items)) {
		result = _.flattenDeep(_.values(items))
	}
	if (_.isArray(items)) {
		result = _.flattenDeep(items)
	}
	return result
}

// yuck :(
const vectorOpFnArgs = (fn, a, b) => {
	let result = { a, b }
	if (['addFactor', 'subFactor', 'mult'].includes(fn)) {
		result = { amt: a, factor: b }
	}
	else if (fn === 'div') {
		result = { num: a, dem: b }
	}
	return result
}


// optionally accept a value; if undefined assume `true`
const _filterFn = ({ path, value }) => (item => !!(getValueAtPath(item, path) === (_.isUndefined(value) ? true : value)))
const _filterNotFn = ({ path, value }) => (item => !(getValueAtPath(item, path) === (_.isUndefined(value) ? true : value)))

const addN = items => extractNItems(items).reduce((t, a) => t + a, 0)
const andN = items => extractNItems(items).reduce((t, v) => !!t && !!v, true)
const orN = items => extractNItems(items).reduce((t, v) => t || v, false)
const concat = items => extractNItems(items).reduce((t, a) => t + a, '')
const concatArrays = items => extractNItems(items).reduce((t, a) => t.concat(a), [])
const filter = ({ collection, path, value }) => extractNItems(collection).filter(_filterFn({ path, value }))
const filterNot = ({ collection, path, value }) => extractNItems(collection).filter(_filterNotFn({ path, value }))
// TODO: When a node running find returns null it should not break the flow.
const find = ({ collection, propName, propValue }) => extractNItems(collection).find(item => item[propName] === propValue)

const not = ({ item }) => _.isBoolean(item) && !item

const ternary = ({ test, pass, fail }) => (test ? pass : fail)


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
	try { r = Number(amt.toFixed(2)) } catch (error) { console.log(`unable to round ${amt}`) } // eslint-disable-line no-console
	return r
}
const includes = ({ item, isIncludedIn }) => isIncludedIn.includes(item)
const isNonEmptyString = ({ item }) => !!item && _.isString(item) && item.trim().length > 0
const isNull = ({ item }) => _.isNull(item)

const map = ({ collection, fn, params }) => collection.map((item) => {
	const args = _.mapValues(params, localPath => getValueAtPath(item, localPath))
	return module.exports[fn](args)
})

const vectorOp = ({ collectionA, collectionB, op }) => {
	const result = []
	const cA = extractNItems(collectionA)
	const cB = extractNItems(collectionB)
	if (cA.length !== cB.length) {
		throw new Error(`vectorOp error: collections must be equal in length. Got a: ${cA.length}, b: ${cB.length}.`)
	}
	if (!(op in module.exports)) {
		throw new Error(`vectorOp error: op '${op}' not found`)
	}
	cA.forEach((a, i) => {
		const b = cB[i]
		const args = vectorOpFnArgs(op, a, b)
		result.push(module.exports[op](args))
	})
	return result
}

const pick = ({ src, propNames }) => _.pick(src, propNames)
const omit = ({ src, propNames }) => _.omit(src, propNames)
const merge = ({ a, b }) => _.merge({}, a, b)
const box = ({ value, propName }) => ({ [propName]: value })

// note currently can't get path values for a nested array of paths, so can only add one prop at a time.
const addProp = ({ src, propName, propValue }) => _.merge({}, src, { [propName]: propValue })

/** Applies a given list of discounts discounts to a given borrowerDayrate. */
const applyDiscounts = ({ discounts = [], borrowerDayrate, lenderDayrate }) => {
  let appliedBorrowerDiscountAmount = 0
  let appliedLenderReductionAmount = 0
  const appliedDiscounts = []
  let newBorrowerDayRate = borrowerDayrate
  let newLenderDayRate = lenderDayrate

  if (!_.isArray(discounts)) throw new Error('"discounts" must be a an array.')
  if (!_.isNumber(borrowerDayrate)) throw new Error('"borrowerDayrate" must be a number.')
  if (!_.isNumber(lenderDayrate)) throw new Error('"lenderDayrate" must be a number.')

  // if the borrowerDayrate or the lenderDayrate are already 0 we can't apply discounts.
  if (borrowerDayrate <= 0 || lenderDayrate <= 0) {
    return { appliedBorrowerDiscountAmount, appliedLenderReductionAmount, appliedDiscounts, newBorrowerDayRate, newLenderDayRate }
  }

	for (let i = 0; i < discounts.length; i++) {
		const discount = discounts[i];
		const newBorrowerDayratePostDiscount = newBorrowerDayRate - discount.amount

		// Compute the amount absorbed by by the lender. If the absorption amount is 1, the entire discount is absorbed by the lender.
		// TODO: Currently this is only working in the borrower context but it should be bidirectional.
		// In other words this will not work for promotions where the targetParty is the lender.
		const lenderReductionAmount =		discount.amount * discount.amtAbsorbedByOtherParty
		const newLenderDayRatePostDiscount = newLenderDayRate - lenderReductionAmount

    if (newBorrowerDayratePostDiscount >= 0 && newLenderDayRatePostDiscount >= 0) {
      appliedDiscounts.push(discount)
      appliedBorrowerDiscountAmount += discount.amount
			appliedLenderReductionAmount += lenderReductionAmount
      newBorrowerDayRate = newBorrowerDayratePostDiscount
			newLenderDayRate = newLenderDayRatePostDiscount
      if (newBorrowerDayratePostDiscount === 0 || newLenderDayRatePostDiscount === 0) {
        break
      }
    } else {
			/*
			// TODO: There might be some edge cases when applying a discount partially. So we'll add this in a next iteration.
      // If we get a negative value after deducting the discount then we want to apply the discount partially until it gets to zero
      // and update the discount object item in the applied discount list to reflect the actual applied amount deducted.
      appliedDiscounts.push({ ...discount, amount: newBorrowerDayRate })
      appliedBorrowerDiscountAmount += newBorrowerDayRate
			appliedLenderReductionAmount += newLenderDayRate
			newBorrowerDayRate = newBorrowerDayratePostDiscount < 0 ? 0 : newBorrowerDayratePostDiscount
			newLenderDayRate = newLenderDayRatePostDiscount < 0 ? 0 : newLenderDayRatePostDiscount
			*/
      break
    }
	}

	return { appliedBorrowerDiscountAmount, appliedLenderReductionAmount, appliedDiscounts, newBorrowerDayRate, newLenderDayRate }
}

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
	isNull,
	ternary,
	isNonEmptyString,
	concat,
	concatArrays,
	filter,
	filterNot,
	find,
	map,
	vectorOp,
	pick,
	omit,
	merge,
	box,
	addProp,
	applyDiscounts
}
