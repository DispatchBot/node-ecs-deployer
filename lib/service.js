var AWS = require('aws-sdk'),
  Promise = require('promise');

/** How long to wait when checking if the service has been deployed. Millis */
var DEPLOY_WAIT_INTERVAL = 15000;

/**
 * @scope private
 * Utility method for parsing a URL into the key/object parts needed for S3.
 *
 * @param [String] url An S3 URL to deconstruct.
 * @return [Object] Object containing properties bucket and key.
 */
var _parseS3Url = function(url) {
  url = url.replace(/s3:\/\//i, '')
  var urlParts = url.split('/');
  return { bucket: urlParts.shift(), key: urlParts.join('/') };
}

/**
 * @scope private
 * Update an image string with the given version number.
 *
 * @param [String] image A docker image string. Usually looks like 'repo/image:tag'
 * @param [String] version The version number to update the image to.
 * @return [String] A new image string with the right version.
 */
var _updateImageVersion = function(image, version) {
  var imageParts = image.split(':');
  return [imageParts[0], version].join(':');
}

/**
 * @scope private
 * Polls for the deployment to be complete until it is. Deploy is complete when
 * all desired instances are running and all previous version instances have stopped.
 *
 * @param [String] taskArn The AWS ARN to the task we want deployed.
 * @param [Service] service The service object we are deploying for.
 * @param [Function] resolve The success callback.
 * @param [Function] reject The error callback.
 * @param [Integer] retries The number of times we should retry polling.
 */
var _pollDeployment = function(taskArn, service, resolve, reject, retries) {
  if (retries-- == 0) {
    return reject(new Error('Timed out when waiting for service to deploy'))
  }

  service.fetchEcsService().then(function(ecsService) {
    var myDeploy = null;
    var otherReleaseVersions = 0;
    var deployments = ecsService.deployments;
    for (var i = 0; i < deployments.length; i++) {
      if (deployments[i].taskDefinition == taskArn) {
        myDeploy = deployments[i];
      } else {
        otherReleaseVersions += deployments[i].runningCount;
      }
    }

    if (myDeploy.status != 'PRIMARY') {
      reject(new Error('This deploy is no longer the primary deploy. Another deploy has taken precedence.'))
      return;
    }

    if (myDeploy.desiredCount == myDeploy.runningCount) {
      service._logProgress('New version is running');
      if (otherReleaseVersions == 0) {
        service._logProgress('Old versions are no longer running')
        resolve();
      } else {
        service.deployer.emit('waiting', { waiting: DEPLOY_WAIT_INTERVAL, status: 'RAMPING_DOWN_OLD_VERSION', service: service })
        //service._logProgress('Old versions are still running, waiting ' + (DEPLOY_WAIT_INTERVAL / 1000) + ' seconds...')
        setTimeout(function() {
          _pollDeployment(taskArn, service, resolve, reject, retries);
        }, DEPLOY_WAIT_INTERVAL);
      }
    } else {
      service.deployer.emit('waiting', { waiting: DEPLOY_WAIT_INTERVAL, status: 'DEPLOYING_NEW_VERSION', service: service })
      //service._logProgress('Its not deployed yet, waiting ' + (DEPLOY_WAIT_INTERVAL / 1000) + ' seconds...')
      setTimeout(function() {
        _pollDeployment(taskArn, service, resolve, reject, retries);
      }, DEPLOY_WAIT_INTERVAL);
    }
  });
}

/**
 * Constructor function to create a new service.
 *
 * @param [Object] service The service definition. JSON.
 * @param [Deployer] deployer The deployer that is responsible for deploying this service.
 */
function Service(service, deployer) {
  this.service = service;
  this.ecs = new AWS.ECS();
  this.autoScaling = new AWS.AutoScaling();
  this.deployer = deployer;

  this.name = service.name;
}

/**
 * @scope private
 * Log/emit some progress message as we deploy.
 *
 * @param [String] msg The message to log/emit.
 */
Service.prototype._logProgress = function(msg) {
  console.log(msg);
  this.deployer.emit('progress', {
    msg: msg,
    service: this
  });
}

/**
 * Download and parse the task definition from S3.
 * TODO: It would be nice if we supported more storage solutions than just S3.
 *
 * @param [String] url The S3 URL to the task definition json file. E.g., s3://key/my/task-definition.json
 * @return [Object] The task definition as a JSON object.
 */
Service.prototype.fetchTaskDefinition = function(location) {
  if (location.url) {
    location = _parseS3Url(location);
  }

  var s = this;
  return new Promise(function(resolve, reject) {
    var ep = null;
    if (location.host) {
      ep = location.host
    }

    new AWS.Endpoint(location.host);
    var s3 = new AWS.S3({endpoint: ep});

    s3.getObject({
      Bucket: location.bucket,
      Key: location.key
    }, function(err, data) {
      if(err) {
        reject(err);
        return;
      }

      var taskDef;
      try {
        taskDef = JSON.parse(data.Body);
      } catch(err) {
        reject(err);
      }

      s._logProgress('Task definition fetched from S3')
      resolve(taskDef);
    });
  });
}

/**
 * Register the task definition with ECS. Bump the version to the given version
 * in the meantime.
 *
 * @param [String] version The version of the docker image to use for the task definition.
 * @return [Promise]
 */
Service.prototype.registerTaskDefinition = function(version) {
  var s = this;
  return this.fetchTaskDefinition(this.service.taskDefinition).then(function(taskDef) {
    return new Promise(function(resolve, reject) {
      // TODO: There is a big assumption here that all def's are ones we want to update.
      for (var i = 0; i < taskDef.containerDefinitions.length; i++) {
        // Update the image version number.
        taskDef.containerDefinitions[i].image = _updateImageVersion(taskDef.containerDefinitions[i].image, version)
      }

      s.ecs.registerTaskDefinition(taskDef, function(err, response) {
        if (err) {
          reject(err);
          return;
        }

        s._logProgress('Registered task def in ECS');
        resolve(response.taskDefinition.taskDefinitionArn);
      });
    });
  });
};

/**
 * Update the ECS service to use the given task ARN. This registers our deploy with AWS/ECS.
 *
 * @param [String] taskArn The AWS ARN of the task definition to deploy.
 * @return [Promise]
 */
Service.prototype.updateEcsService = function(taskArn) {
  var s = this;
  return new Promise(function(resolve, reject) {
    s.ecs.updateService({
      service: s.name,
      cluster: s.service.cluster,
      taskDefinition: taskArn
    }, function(err, data) {
      if (err) {
        reject(err);
        return;
      }

      s._logProgress('Updated service with new task def');
      resolve();
    });
  });
};

/**
 * Scale the ECS cluster of EC2's up so that we have enough capacity for our deploy.
 *
 * @return [Promise]
 */
Service.prototype.scaleUp = function() {
  var s = this;
  return new Promise(function(resolve, reject) {
    s.fetchAutoScalingGroup().then(function(asg) {

      s.previousCapacity = asg.DesiredCapacity;
      var capacity = s.previousCapacity * 2;
      s.autoScaling.setDesiredCapacity({
        AutoScalingGroupName: s.service.autoScaling.name,
        DesiredCapacity: capacity
      }, function(err, data) {
        if (err) {
          reject(err);
          return;
        }

        s._logProgress('Increased EC2 capacity to support deploy (cluster size = ' + capacity + ').')
        resolve();
      });
    });
  });
};

/**
 * Wait for the deploy to complete. Deploy is complete when the new version is
 * running and all previous versions are not running.
 *
 * @param [String] taskArn The AWS ARN of the task we are deploying.
 * @param [Integer] maxAttempts The number of times we should check if the version is deployed.
 * @return [Promise]
 */
Service.prototype.waitForDeploy = function(taskArn, maxAttempts) {
  var service = this;
  if (!maxAttempts) maxAttempts = 100;
  return new Promise(function(resolve, reject) {
    _pollDeployment(taskArn, service, resolve, reject, maxAttempts);
  });
}

/**
 * After deployment, scale the cluster back down.
 *
 * @return [Promise]
 */
Service.prototype.scaleDown = function() {
  // Scale down auto scaling groups
  var s = this;
  return new Promise(function(resolve, reject) {
    s.autoScaling.setDesiredCapacity({
      AutoScalingGroupName: s.service.autoScaling.name,
      DesiredCapacity: s.previousCapacity
    }, function(err, data) {
      if (err) {
        reject(err);
        return;
      }

      s._logProgress('Scaled cluster back down (cluster size = ' + s.previousCapacity + ')');
      resolve();
    });
  });
}

Service.prototype.isReady = function(version) {
  var deferreds = [
    this.fetchTaskDefinition(this.service.taskDefinition),
    this.fetchEcsService()
  ];

  if (this.service.autoScaling && this.service.autoScaling.name) {
    deferreds.push(this.fetchAutoScalingGroup());
  }

  return Promise.all(deferreds);
}

Service.prototype.fetchEcsService = function() {
  var s = this;
  return new Promise(function(resolve, reject) {
    s.ecs.describeServices({
      cluster: s.service.cluster,
      services: [ s.name ]
    }, function(err, data) {
      if (err) {
        reject(err);
        return;
      }

      if (data.services.length != 1) {
        reject(new Error('Unable to find ECS service'));
        return;
      }

      resolve(data.services[0]);
    });
  });
}

Service.prototype.fetchAutoScalingGroup = function() {
  var s = this;
  return new Promise(function(resolve, reject) {
    s.autoScaling.describeAutoScalingGroups({
      AutoScalingGroupNames: [ s.service.autoScaling.name ],
      MaxRecords: 1
    }, function(err, data) {
      if (err) {
        reject(err);
        return;
      }

      if (data.AutoScalingGroups.length == 0) {
        reject(new Error('Unable to find auto scaling group'));
        return;
      }

      resolve(data.AutoScalingGroups[0]);
    });
  });
}

/**
 * Deploy the given version of this service.
 *
 * @param [String] version The version to deploy.
 * @return [Promise]
 */
Service.prototype.deploy = function(version) {
  var service = this;
  return service.registerTaskDefinition(version).then(function(taskArn) {
    return service.updateEcsService(taskArn).then(function() {
      if (service.service.autoScaling && service.service.autoScaling.name) {
        return service.scaleUp().then(function() {
          return service.waitForDeploy(taskArn).then(function() {
            return service.scaleDown().then(function() {
              return service;
            })
          })
        })
      } else {
        return service.waitForDeploy(taskArn);
      }
    })
  })
}

module.exports = Service;
