var Promise = require('promise'),
  request = require('request');

// Dummy service, which does not perform any checks
// Can also be used as a skeleton for new checks
var None = function(config) {
}

None.prototype.isExists = function(tag) {
  var quay = this;
  return new Promise(function(resolve, reject) {
    return resolve(true);
  });
}

module.exports = None;
