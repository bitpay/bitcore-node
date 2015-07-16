var async = require('async');

var d = Date.now();

var i = 0;

function fn1(next) {
  console.log('fn1');
  setImmediate(function() {
    next(null, [])
  });
}

function fn2(next) {
  console.log('fn2');
  setImmediate(function() {
    next(null, [])
  });
}

async.whilst(
  function() {
    return i < 100000;
  },
  function(callback) {
    i++;
    async.series(
      [
        fn1.bind(this),
        fn2.bind(this)
      ],
      callback
    );
  },
  function() {
    console.log('Milliseconds', Date.now() - d);
  }
);

/*async.times(100000, function(n, next) {
  async.series(
    [
      function fn1(next) {
        setImmediate(function() {
          next(null, []);
        });
      },
      function fn2(next) {
        setImmediate(function() {
          next(null, []);
        });
      }
    ],
    next
  );
}, function() {
  console.log('Milliseconds', Date.now() - d);
});*/
