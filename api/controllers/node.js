'use strict';

var NodeStatus = {};
var node;
NodeStatus.setNode = function(aNode) {
  node = aNode;
};

NodeStatus.getStatus = function(req, res) {
  res.send(node.status);
};

module.exports = NodeStatus;
