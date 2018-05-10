import { P2pService } from './services/p2p';
import { Storage} from './services/storage';
import WorkerService from './services/worker';
import logger from './logger';
import config from './config';
import { CallbackType } from './types/Callback';
import cluster = require('cluster');
const async = require('async');

async.series(
  [
    Storage.start.bind(Storage),
    WorkerService.start.bind(WorkerService),
    async (cb: CallbackType) => {
      let p2pServices = [];
      for (let chain of Object.keys(config.chains)) {
        for (let network of Object.keys(config.chains[chain])) {
          const chainConfig = config.chains[chain][network];
          const hasChainSource = chainConfig.chainSource !== undefined;
          if (!hasChainSource || chainConfig.chainSource === 'p2p') {
            let p2pServiceConfig = Object.assign(
              config.chains[chain][network],
              { chain, network }
            );
            p2pServices.push(new P2pService(p2pServiceConfig));
          }
        }
      }
      await Promise.all(p2pServices.map(p2pService => p2pService.start()))
        .then(cb);
    }
  ],
  function() {
    if (cluster.isWorker) {
      const app = require('./routes');
      const server = app.listen(config.port, function() {
        logger.info(`API server started on port ${config.port}`);
      });
      server.timeout = 600000;
    }
  }
);
