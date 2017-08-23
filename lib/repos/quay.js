const Promise = require('promise'),
  request = require('request');

const Quay = function(config) {
  this.url = config.url;
  this.auth = config.auth;
}

Quay.prototype.isExists = function(tag) {
  return new Promise((resolve, reject) => {
    const query = {
      url: `${this.url}/tag/${tag}/images`,
      headers: {
        'Authorization': `Bearer ${this.auth}`
      }
    };

    request.get(query, (err, resp, body) => {
      if (err) return reject(err);

      if (resp.statusCode == 401) return reject(new Error('authentication failure'));

      if (resp.statusCode === 200) return resolve(true);
      const e = new Error('Unable to find tagged image in quay');
      e.response = resp;
      reject(e);
    });
  });
}

module.exports = Quay;
