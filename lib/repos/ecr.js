const Promise = require('promise'),
  AWS = require('aws-sdk');

const Ecr = function(config) {
  this.repository = config.repository;
}

const ecr = new AWS.ECR();

Ecr.prototype.isExists = function(tag) {
  return new Promise((resolve, reject) => {
    const params = {
      repositoryName: this.repository,
      imageIds: [
        {
          imageTag: tag
        }
      ]
    };

    ecr.describeImages(params, (err, data) => {
      if (err) {
        if (err.code === 'ImageNotFoundException') {
          const e = new Error('Unable to find tagged image in ECR');
          e.response = err;
          return reject(e);
        }

        return reject(err);
      }

      resolve(true);
    });
  });
}

module.exports = Ecr;
