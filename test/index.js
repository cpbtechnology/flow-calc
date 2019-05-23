/* eslint-disable */

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
