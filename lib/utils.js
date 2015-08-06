'use strict';

var chainlib = require('chainlib');
var utils = chainlib.utils;

/**
 * Bitcore's API does not implement toJSON in the standard way.
 * This causes issues when doing a JSON.stringify on an object
 * which contains Bitcore objects. This custom implmentation
 * of stringify accounts for Bitcore objects.
 * @param  {Object} obj
 * @return {String} json
 */
utils.stringify = function(obj) {
  return JSON.stringify(utils.expandObject(obj));
}

utils.expandObject = function(obj) {
  if(Array.isArray(obj)) {
    var expandedArray = [];
    for(var i = 0; i < obj.length; i++) {
      expandedArray.push(utils.expandObject(obj[i]));
    }

    return expandedArray;
  } else if(typeof obj === 'function' || typeof obj === 'object') {
    if(obj.toObject) {
      return obj.toObject();
    } else if(obj.toJSON) {
      return obj.toJSON();
    } else {
      var expandedObj = {};

      for(var key in obj) {
        expandedObj[key] = utils.expandObject(obj[key]);
      }

      return expandedObj;
    }
  } else {
    return obj;
  }
};

module.exports = utils;