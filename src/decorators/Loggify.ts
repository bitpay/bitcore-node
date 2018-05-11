import logger from '../logger';

let LoggifiedClasses: { [key: string]: boolean } = {};
export function LoggifyClass<T extends { new (...args: any[]): {} }>(
  aClass: T
) {
  return class extends aClass {
    constructor(...args: any[]) {
      super(...args);
      var self = this;
      if (!LoggifiedClasses[aClass.name]) {
        logger.debug(
          `Loggifying  ${aClass.name} with args:: ${JSON.stringify(args)}`
        );
        LoggifyObject(aClass.prototype, aClass.name, self);
        LoggifiedClasses[aClass.name] = true;
      }
    }
  };
}

export function LoggifyMethod(className: string) {
  return function(
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<Function>
  ) {
    let prop = propertyKey;
    descriptor.value = function(...methodargs: any[]) {
      logger.debug(
        `${className}::${prop}()::args::${JSON.stringify(methodargs)} `
      );
      let returnVal = target(...methodargs);
      if (returnVal && <Promise<any>>returnVal.then) {
        returnVal.then((data: any) => {
          logger.debug(
            `${className}::${prop}()::resolved::${JSON.stringify(data)}`
          );
          return data;
        });
      } else {
        logger.debug(
          `${className}::${prop}()::returned::${JSON.stringify(returnVal)}`
        );
      }
      return returnVal;
    };
  };
}

export function LoggifyFunction(fn: Function, logPrefix?: string) {
  return function(...methodargs: any[]) {
    logger.debug(`${logPrefix}::args::${JSON.stringify(methodargs)} `);
    let returnVal = fn(...methodargs);
    if (returnVal && <Promise<any>>returnVal.then) {
      returnVal.then((data: any) => {
        logger.debug(`${logPrefix}::resolved::${JSON.stringify(data)}`);
        return data;
      });
    } else {
      logger.debug(`${logPrefix}::returned::${JSON.stringify(returnVal)}`);
    }
    return returnVal;
  };
}

export function LoggifyObject(obj: any, logPrefix?: string, bind?: any) {
  for (let prop of Object.getOwnPropertyNames(obj)) {
    if (typeof obj[prop] === 'function') {
      let copy = obj[prop];
      if (bind) {
        copy = copy.bind(bind);
      }
      logger.debug(`Loggifying  ${logPrefix}::${prop}`);
      obj[prop] = function(...methodargs: any[]) {
        logger.debug(
          `${logPrefix}::${prop}()::args::${JSON.stringify(methodargs)} `
        );
        let returnVal = copy(...methodargs);
        if (returnVal && <Promise<any>>returnVal.then) {
          returnVal.then((data: any) => {
            logger.debug(
              `${logPrefix}::${prop}()::resolved::${JSON.stringify(data)}`
            );
            return data;
          });
        } else {
          logger.debug(
            `${logPrefix}::${prop}()::returned::${JSON.stringify(returnVal)}`
          );
        }
        return returnVal;
      };
    }
  }
  return obj;
}
