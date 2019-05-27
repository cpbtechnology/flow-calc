const _ = require('lodash')

module.exports = {

	setValueAtPath: function setValueAtPath(obj, path, value) {
		const bits = _.toPath(path)
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
		const bits = _.toPath(path)
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

	pathDotEscapeSeq: '_$dot$_',
	pathDotUnescapeRegex: /_\$dot\$_/g,

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
				result = result.concat(module.exports.collectObjectPaths(v, i.toString()))
			})
		} else if (_.isObject(obj)) {
			_.forOwn(obj, (v, k) => {
				const escapedKey = k.replace(/\./g, module.exports.pathDotEscapeSeq)
				if (_.isObject(v) || _.isArray(v)) {
					result = result.concat(module.exports.collectObjectPaths(v, escapedKey))
				} else {
					result.push(escapedKey)
				}
			})
		} else {
			// leaf
			return parent
		}
		// console.log('output', { parent }, parent ? result.map(p => `${parent}.${p}`) : result)
		return parent ? result.map(p => `${parent}.${p}`) : result
	},

	escapeObjectPaths: function escapeObjectPaths(obj) {
		let result = obj
		if (_.isObject(obj) && !_.isArray(obj)) {
			result = {}
			_.forOwn(obj, (v, k) => {
				const escapedKey = k.replace(/\./g, module.exports.pathDotEscapeSeq)
				result[escapedKey] = v
			})
		}
		else if (_.isArray(obj)) {
			result = obj.map(entry => escapeObjectPaths(entry))
		}
		return result
	},

	/**
	 * Flattens a deep object tree (arrays and objects) into a single
	 * non-tree object whose keys are the paths of nested properties
	 * with matching values.
	 *
	 * Properties with dots in their names should be preserved.
	 *
	 * Not super-speedy. :)
	 *
	 * @param {Object} obj Object to flatten.
	 * @param {path => Boolean} filterFn Optionally filter which paths are included.
	 */
	flattenObject: function flattenObject(obj, filterFn) {
		const result = {}
		const unescapePath = p => p.replace(module.exports.pathDotUnescapeRegex, '.')
		const escapedObject = module.exports.escapeObjectPaths(obj)
		let escapedPaths = module.exports.collectObjectPaths(escapedObject)
		if (filterFn) {
			escapedPaths = escapedPaths.filter(p => filterFn(unescapePath(p)))
		}
		escapedPaths.forEach((p) => {
			result[unescapePath(p)] = module.exports.getValueAtPath(escapedObject, p)
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
		const result = {}
		_.forOwn(obj, (v, k) => {
			if (!filterFn || filterFn(k)) {
				module.exports.pathValueToObject(k, v, result)
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
		const bits = _.toPath(path)
		if (!bits.length) {
			return {}
		}
		const pathSoFar = []
		let done = false
		let result = oObj || undefined
		while (!done) {
			const currentBit = bits[0]
			const nextIsArray = !_.isNaN(parseInt(currentBit, 10))
			if (!result) {
				result = nextIsArray ? [] : {}
			} else if (bits.length) {
				// if the container already exists, don't do anything
				let existing = module.exports.getValueAtPath(result, pathSoFar.join('.'))
				existing = existing && nextIsArray ? _.isArray(existing) : _.isObject(existing)
				if (!existing && pathSoFar.length) {
					// otherwise, create it
					module.exports.setValueAtPath(result, pathSoFar.join('.'), nextIsArray ? [] : {})
				}
			} else {
				module.exports.setValueAtPath(result, pathSoFar.join('.'), value)
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
