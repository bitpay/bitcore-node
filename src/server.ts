import { P2pService } from "./services/p2p";
import StorageService from "./services/storage";
import WorkerService from "./services/worker";
const async = require("async");
const cluster = require("cluster");

const logger = require("./lib/logger");
const config = require("./lib/config");

async.series(
  [
    StorageService.start.bind(StorageService),
    WorkerService.start.bind(WorkerService),
    async () => {
      let p2pServices = [];
      for (let chain of Object.keys(config.chains)) {
        for (let network of Object.keys(config.chains[chain])) {
          const chainConfig = config.chains[chain][network];
          const hasChainSource = chainConfig.chainSource !== undefined;
          if (!hasChainSource || chainConfig.chainSource === "p2p") {
            let p2pServiceConfig = Object.assign(
              config.chains[chain][network],
              { chain, network }
            );
            p2pServices.push(new P2pService(p2pServiceConfig));
          }
        }
      }
      await Promise.all(p2pServices.map(p2pService => p2pService.start()));
    }
  ],
  function() {
    if (cluster.isWorker) {
      const app = require("./lib/routes");
      const server = app.listen(config.port, function() {
        logger.info(`API server started on port ${config.port}`);
      });
      server.timeout = 600000;
    }
  }
);
