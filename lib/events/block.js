'use strict';

var Promise= require('bluebird');

var createProcessBlockHandler = function(blockService, funnel) {
  return function(session, block) {

    var currentTip;
    var newToConfirm;
    var commonAncestor;
    var triggerEvents;

    return Promise.try(function() {

      return blockService.getCurrentTip();

    }).then(function(tip) {

      currentTip = tip;
      return blockService.getOffchainBlocksUntil(session, block);

    }).then(function(blocks, events) {

      commonAncestor = blocks[blocks.length-1].parent;
      newToConfirm = blocks;
      newToConfirm.reverse();
      return blockService.getChainFrom(commonAncestor, tip);

    }).then(function(blocks) {

      return Promise.each(blocks, function(block) {
        funnel.process(new UnconfirmBlockEvent({
          session: session,
          block: block
        }));
      });

    }).then(function() {

      return Promise.each(blocks, function(block) {
        funnel.process(new ConfirmBlockEvent({
          session: session,
          block: block
        }));
      });

    });
  };
};
