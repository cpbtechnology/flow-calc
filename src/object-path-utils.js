const _ = require('lodash')

module.exports = {

	setValueAtPath: function setValueAtPath(obj, path, value) {
		let bits = _.toPath(path)
		let v = obj
		let p = bits.shift()
		while (bits.length) {
			if (_.has(v, p)) {
				v = v[p]
				p = bits.shift()
			} else {
				throw new Error(`No property ${p} in ${JSON.stringify(v)}.`)
			}
		}
		v[p] = value
		return obj
	},

	getValueAtPath: function getValueAtPath(obj, path) {
		let bits = _.toPath(path)
		let v = obj
		let p = bits.shift()
		while (bits.length) {
			if (_.has(v, p)) {
				v = v[p]
				p = bits.shift()
			} else {
				return undefined
			}
		}
		return v[p]
	},

	/**
	 * Traverses passed object depth-first and collects all object's
	 * own paths recursively.
	 *
	 * @param {Object} obj The object to traverse.
	 * @param {String} parent Parent property name, if any.
	 * @return {Array<String>} Array of paths.
	 */
	collectObjectPaths: function collectObjectPaths(obj, parent) {
		let result = []
		if (_.isArray(obj)) {
			_.forEach(obj, (v, i) => {
				result = result.concat(collectObjectPaths(v, i.toString()))
			})
		} else if (_.isObject(obj)) {
			_.forOwn(obj, (v, k) => {
				if (_.isObject(v) || _.isArray(v)) {
					result = result.concat(collectObjectPaths(v, k))
				} else {
					result.push(k)
				}
			})
		} else {
			// leaf
			return parent
		}
		// console.log('output', { parent }, parent ? result.map(p => `${parent}.${p}`) : result)
		return parent ? result.map(p => `${parent}.${p}`) : result
	},

	/**
	 * Flattens an deep object tree (arrays and objects) into a single
	 * non-tree object whose keys are the paths of nested properties
	 * with matching values.
	 *
	 * Not super-speedy. :)
	 *
	 * @param {Object} obj Object to flatten.
	 * @param {path => Boolean} filterFn Optionally filter which paths are included.
	 */
	flattenObject: function flattenObject(obj, filterFn) {
		let result = {}
		let paths = collectObjectPaths(obj)
		if (filterFn) {
			paths = paths.filter(filterFn)
		}
		paths.forEach(p => {
			result[p] = getValueAtPath(obj, p)
		})
		return result
	},

	/**
	 * Expands an object flattened by `flattenObject`.
	 *
	 * @param {Object} obj Object to expand
	 * @param {path => Boolean} filterFn Optionally filter which paths get expanded.
	 */
	expandObject: function expandObject(obj, filterFn) {
		let result = {}
		_.forOwn(obj, (v, k) => {
			if (!filterFn || filterFn(k)) {
				pathValueToObject(k, v, result)
			}
		})
		return result
	},

	/**
	 * Create minimal nested objects/arrays following `path` all the way
	 * down to the last item in `path`, then set the value of that property.
	 *
	 * Not particularly well-tested.
	 *
	 * @param {String} path A path like `"path.to.3.property"`.
	 * @param {Any} value Value to set.
	 * @param {Object} obj If defined, create the path in this object or use object's existing path.
	 */
	pathValueToObject: function pathValueToObject(path, value, oObj = null) {
		let bits = _.toPath(path)
		if (!bits.length) {
			return {}
		}
		let pathSoFar = []
		let done = false
		let result = oObj ? oObj : undefined
		while (!done) {
			const currentBit = bits[0]
			const nextIsArray = !_.isNaN(parseInt(currentBit, 10))
			if (!result) {
				result = nextIsArray ? [] : {}
			} else if (bits.length) {
				// if the container already exists, don't do anything
				let existing = getValueAtPath(result, pathSoFar.join('.'))
				existing = existing && nextIsArray ? _.isArray(existing) : _.isObject(existing)
				if (!existing) {
					// otherwise, create it
					setValueAtPath(result, pathSoFar.join('.'), nextIsArray ? [] : {})
				}
			} else {
				setValueAtPath(result, pathSoFar.join('.'), value)
				done = true
			}
			if (!done) {
				bits.shift()
				pathSoFar.push(currentBit)
			}
		}
		return result
	}
}
