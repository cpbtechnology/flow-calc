/* eslint-disable */
const DGraph = require('../src/index')

const sayHello = (name = "Haz") => `Hello, ${name}!`;

test("sayHello", () => {
  expect(sayHello()).toBe("Hello, Haz!");
  expect(sayHello("foo")).toBe("Hello, foo!");
});


test('edges', () => {
  const graphDefinition = [
    { name: 'staticNode', type: 'static', value: 'hello, ' },
    { name: 'aliasNode', type: 'alias', mirror: 'inputs.stringValue' },
    { name: 'concatExample', type: 'transform', fn: 'concat', params: ['staticNode', 'inputs.stringValue'] },
    { name: 'multiplyExample', type: 'transform', fn: 'mult', params: { amt: 'inputs.numberValue', factor: 3 } }
  ]
  
  const inputs = {
    stringValue: new Promise(r => setTimeout(() => r('world'), 500)),
    numberValue: 4
  }
  
  const dGraph = new DGraph(graphDefinition)
  console.log(dGraph.getDEdges())
  return dGraph.run(inputs).then(result => {
    console.log('edges', dGraph.getDEdges())
    console.log(result)
  })

})
// TODO: actual tests ...

/*
import { expect } from 'chai'
import basic from './cases/basic'
import paths from './cases/paths'
import async from './cases/async'


describe('Use case tests.', () => {

  it('should fulfill to expected values  (basic)', function() {
    return basic.dGraph.run(basic.inputs).then(results => {
      expect(results).to.have.property('staticNode', 'hi there')
      expect(results).to.have.property('aliasNode', 5)
      expect(results).to.have.property('transformNode', 12)
      expect(results).to.have.property('inputs').with.property('something', 5)
    })
  })

  it('should fulfill to expected values (paths)', function() {
    return paths.dGraph.run(paths.inputs).then(results => {
      expect(results).to.have.property('staticNode', 'hi there')
      expect(results).to.have.property('aliasNode', 5)
      expect(results).to.have.property('transformNode', 12)
      expect(results).to.have.property('nestedInputTransform', 150)
      expect(results).to.have.property('inputs').with.property('something', 5)
      expect(results).to.have.property('inputs').with.property('nested').with.property('here', 'are')
      expect(results).to.have.property('inputs').with.property('nested').with.property('some', 'values')
      expect(results).to.have.property('inputs').with.property('nested').with.property('like', 20)
      expect(results).to.have.property('inputs').with.property('nested').with.property('and', 7.5)
    })
  })

  it('should fulfill some things but not others', function() {
    return async.dGraph.run(async.inputs).then(results => {
      expect(results).to.have.property('staticNode', 'hi there')
      expect(results).to.have.property('asyncNode', 'async inline node, yo')
      expect(results).to.have.property('transformNode', 12)
      expect(results).to.have.property('nestedInputTransform')
      expect(results.nestedInputTransform).to.be.NaN
      expect(results).to.have.property('inputs').with.property('something', 5)
      expect(results).to.have.property('inputs').with.property('nested')
    })
  });

});
*/