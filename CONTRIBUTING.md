Contributing to bitcore-node
=======

## Quick Checklist

Make sure:

* `gulp lint` doesn't complain about your changes
* `gulp test` passes all the tests
* `gulp coverage` covers 100% of the branches of your code

## Design Guidelines

These are some global design goals in bitcore that any change must adhere.

### D1 - Naming Matters

We take our time with picking names. Code is going to be written once, and read hundreds of times.

We were inspired to name this rule first due to Uncle Bob's great work *Clean Code*, which has a whole chapter on this subject.

### D2 - Tests

Write a test for all your code. We encourage Test Driven Development so we know when our code is right. We have increased test coverage from 80% to around 95% and are targeting 100% as we move towards our 1.0 release.

## Style Guidelines

The design guidelines have quite a high abstraction level. These style guidelines are more concrete and easier to apply, and also more opinionated. The design guidelines mentioned above are the way we think about general software development and we believe they should be present in any software project.

### General

#### G0 - Default to Felixge's Style Guide

Follow this Node.js Style Guide: https://github.com/felixge/node-style-guide#nodejs-style-guide

#### G1 - No Magic Numbers

Avoid constants in the code as much as possible. Magic strings are also magic numbers.

#### G2 - Internal Objects Should be Instances

If a class has a `publicKey` member, for instance, that should be a `PublicKey` instance.

#### G3 - Internal Amounts Must be Integers Representing Satoshis

Avoid representation errors by always dealing with satoshis. For conversion for frontends, use the `Unit` class.

#### G4 - Internal Network References Must be Network Instances

A special case for [G2](#g2---general-internal-objects-should-be-instances) all network references must be `Network` instances (see `bitcore/lib/network.js`), but when returned to the user, its `.name` property should be used.

#### G5 - Objects Should Display Nicely in the Console

Write a `.inspect()` method so an instance can be easily debugged in the console.

#### G6 - Naming Utility Namespaces

Name them in CamelCase, as they are namespaces.

DO:
```javascript
var BufferUtil = require('./util/buffer');
```
DON'T:
```javascript
var bufferUtil = require('./util/buffer');
```

### Interface

#### I1 - Code that Fails Early

In order to deal with JavaScript's weak typing and confusing errors, we ask our code to fail as soon as possible when an unexpected input was provided.

There's a module called `util/preconditions`, loosely based on `preconditions.js`, based on `guava`, that we use for state and argument checking. It should be trivial to use. We recommend using it on all methods, in order to improve robustness and consistency.

```javascript
$.checkState(something === anotherthing, 'Expected something to be anotherthing');
$.checkArgument(something < 100, 'something', 'must be less than 100');
$.checkArgumentType(something, PrivateKey, 'something'); // The third argument is a helper to mention the name of the argument
$.checkArgumentType(something, PrivateKey); // but it's optional (will show up as "(unknown argument)")
```

### Testing

#### T1 - Tests Must be Written Elegantly

Style guidelines are not relaxed for tests. Tests are a good way to show how to use the library, and maintaining them is extremely necessary.

Don't write long tests, write helper functions to make them be as short and concise as possible (they should take just a few lines each), and use good variable names.

#### T2 - Tests Must not be Random

Inputs for tests should not be generated randomly. Also, the type and structure of outputs should be checked.

#### T3 - Data for Tests Included in a JSON File

If possible, data for tests should be included in a JSON file in the `test/data` directory. This improves interoperability with other libraries and keeps tests cleaner.

## Pull Request Workflow

Our workflow is based on GitHub's pull requests. We use feature branches, prepended with: `test`, `feature`, `fix`, `refactor`, or `remove` according to the change the branch introduces. Some examples for such branches are:
```sh
git checkout -b test/some-module
git checkout -b feature/some-new-stuff
git checkout -b fix/some-bug
git checkout -b remove/some-file
```

We expect pull requests to be rebased to the master branch before merging:
```sh
git remote add bitpay git@github.com:bitpay/bitcore-node.git
git pull --rebase bitpay master
```

Note that we require rebasing your branch instead of merging it, for commit readability reasons.

After that, you can push the changes to your fork, by doing:
```sh
git push origin your_branch_name
git push origin feature/some-new-stuff
git push origin fix/some-bug
```
Finally go to [github.com/bitpay/bitcore-node](https://github.com/bitpay/bitcore-node) in your web browser and issue a new pull request.

Main contributors will review your code and possibly ask for changes before your code is pulled in to the main repository.  We'll check that all tests pass, review the coding style, and check for general code correctness. If everything is OK, we'll merge your pull request and your code will be part of bitcore.

If you have any questions feel free to post them to
[github.com/bitpay/bitcore-node/issues](https://github.com/bitpay/bitcore-node/issues).

Thanks for your time and code!
