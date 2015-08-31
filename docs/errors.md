# Errors

Many times there are cases where an error condition can be gracefully handled depending on a particular use. To assist in better error handling, errors will have different types so that it's possible to determine the type of error and handle appropriatly.

```js
node.services.address.getUnspentOutputs('00000000839a8...', function(err, outputs) {

  if (err instanceof errors.NoOutputs) {
    // the address hasn't received any transactions
  }

  // otherwise the address has outputs (which may be unspent/spent)

});
```

For more information about different types of errors, please see `lib/errors.js`.