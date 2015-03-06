'use strict';

var NodeStatus = {};
var node;
NodeStatus.setNode = function(aNode) {
  node = aNode;
};

NodeStatus.getStatus = function(req, res) {
  node.getStatus()
    .then(function(status) {
      res.send(status);
    });
};

module.exports = NodeStatus;
