var Promise = require('promise'),
  request = require('request');

var Quay = function(url, auth) {
  this.url = url;
  this.auth = auth;
}

Quay.prototype.isExists = function(tag) {
  var quay = this;
  return new Promise(function(resolve, reject) {
    var query = {
      url: quay.url + '/tag/' + tag + '/images',
      headers: {
        'Authorization': 'Bearer ' + quay.auth
      }
    };

    request.get(query, function(err, resp, body) {
      if (err) return reject(err);

      if (resp.statusCode == 401) return reject(new Error('authentication failure'));

      if (resp.statusCode === 200) return resolve(true);
      var e = new Error('Unable to find tagged image in quay');
      e.response = resp;
      reject(e);
    });
  });
}

module.exports = Quay;
