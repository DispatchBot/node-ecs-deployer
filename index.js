var AWS = require('aws-sdk'),
  Promise = require('promise'),
  Service = require('./lib/service'),
  EventEmitter = require('events').EventEmitter,
  util = require('util'),
  Quay = require('./lib/repos/quay');

// TODO: This needs to be in a config
AWS.config.update({region: 'us-east-1'});



var Deployer = function(app) {
  EventEmitter.call(this);
  this.app = app;

  this.services = [];
  var service;
  for (var i = 0; i < app.services.length; i++) {
    this.services.push(new Service(app.services[i], this));
  }
}

util.inherits(Deployer, EventEmitter);

/**
 * Determine if the app deployment is valid.
 */
Deployer.prototype._isValid = function() {
  var d = this;
  return new Promise(function(resolve, reject) {
    if (!d.app) {
      reject(new Error('No application object defined for deployment'));
      return;
    }

    if (!d.services) {
      reject(new Error('No services defined for deployment'));
      return;
    }

    if (!d.app.docker) {
      reject(new Error('No docker repo defined for deployment'));
      return;
    }

    resolve();
  })
};

Deployer.prototype.isReady = function(version) {
  var deployer = this;

  // TODO: Support multiple repo types
  var quay = new Quay(this.app.docker.url, this.app.docker.auth);

  var quayDeferred = quay.isExists(version);
  quayDeferred.then(function() {
    deployer.emit('progress', { msg: 'Found tagged docker image', service: { name: 'quay' }});
  })

  // TODO: Optionally check git too

  var deferreds = [ quayDeferred ];
  for (var i = 0; i < this.services.length; i++) {
    deferreds.push(this.services[i].isReady(version));
  }

  return Promise.all(deferreds);
};

Deployer.prototype.deploy = function(version) {
  var d = this;

  return this._isValid().then(function() {
    return d.isReady(version).then(function() {
      console.log('Everything exists') // TODO: Emit event

      var deferreds = [];
      for (var i = 0; i < d.services.length; i++) {
        deferreds.push(d.services[i].deploy(version));
      }

      return Promise.all(deferreds).then(function() {
        d.emit('deployed');
      })
    });
  });
}

Deployer.Service = Service;

module.exports = Deployer
