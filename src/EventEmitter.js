class EventEmitter {
	constructor() {
		this.events = {}
	}

	addListener(name, fn) {
		if ((typeof this.events[name]) !== 'object') {
			this.events[name] = []
		}
		this.events[name].push(fn)
	}

	removeListener(name, fn) {
		if ((typeof this.events[name]) === 'object') {
			const index = this.events[name].indexOf(fn)
			if (index >= 0) {
				this.events[name].splice(index, 1)
			}
		}
	}

	trigger(name, ...args) {
		if ((typeof this.events[name]) === 'object') {
			this.events[name].forEach((fn) => {
				fn.apply(this, args)
			})
		}
	}

	on(name, fn) {
		this.addListener(name, fn)
	}

	once(name, fn) {
		this.addListener(name, (...args) => {
			this.removeListener(name, fn)
			fn.apply(this, args)
		})
	}
}

module.exports = EventEmitter
