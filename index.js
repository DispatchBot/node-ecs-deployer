var AWS = require('aws-sdk'),
  Promise = require('promise'),
  Service = require('./lib/service'),
  EventEmitter = require('events').EventEmitter,
  util = require('util'),
  Quay = require('./lib/repos/quay');

if (!AWS.config.region) {
  AWS.config.update({region: process.env.AWS_REGION});
}

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

  // TODO: Support multiple repo types (e.g., docker hub)
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
      d.emit('ready')

      var deferreds = [];
      for (var i = 0; i < d.services.length; i++) {
        deferreds.push(d.services[i].deploy(version));
      }

      // Number of services that have completed their deploys
      var completed = 0;

      return Promise.all(deferreds).then(function(completedServices) {
        for (var i = 0; i < completedServices.length; i++) {
          d.emit('deployed', completedServices[i]);
        }

        completed += completedServices.length;

        if (completed >= d.app.services.length) {
          d.emit('end');
        }
      }, function(err) {
        d.emit('failure', err);

        completed += err.length;
        if (completed >= d.app.services.length) {
          d.emit('end');
        }
      })
    });
  });
}

Deployer.Service = Service;

module.exports = Deployer
