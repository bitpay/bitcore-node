/**
 * @file gulpfile.js
 *
 * Defines tasks that can be run on gulp.
 *
 * Summary: <ul>
 * <li> `test` - runs all the tests using mocha
 * <ul>
 * <li> `test:node`
 * <li> `test:nofail` - internally used for watching (due to bug on gulp-mocha)
 * </ul>`
 * <li> `watch:test` - watch for file changes and run tests
 * <li> `lint` - run `jshint`
 * <li> `coverage` - run `istanbul` with mocha to generate a report of test coverage
 * <li> `coveralls` - updates coveralls info
 * </ul>
 */
'use strict';

var gulp = require('gulp');

var coveralls = require('gulp-coveralls');
var jshint = require('gulp-jshint');
var mocha = require('gulp-mocha');
var shell = require('gulp-shell');


function ignoreerror() {
  /* jshint ignore:start */ // using `this` in this context is weird 
  this.emit('end');
  /* jshint ignore:end */
}

var files = ['lib/**/*.js'];
var tests = ['test/**/*.js'];
var alljs = files.concat(tests);


/**
 * testing
 */

var testmocha = function() {
  return gulp.src(tests).pipe(new mocha({
    reporter: 'spec'
  }));
}

gulp.task('test', testmocha);

gulp.task('test:nofail', function() {
  return testmocha().on('error', ignoreerror);
});


/**
 * code quality and documentation
 */

gulp.task('lint', function() {
  return gulp.src(alljs)
    .pipe(jshint())
    .pipe(jshint.reporter('default'));
});

gulp.task('plato', shell.task(['node_modules/.bin/plato -d report -r -l .jshintrc -t bitcore-node lib']));

gulp.task('coverage', shell.task(['node_modules/.bin/istanbul cover node_modules/.bin/_mocha -- --recursive']));

gulp.task('coveralls', ['coverage'], function() {
  gulp.src('coverage/lcov.info').pipe(coveralls());
});


/**
 * watch tasks
 */

gulp.task('watch:test', function() {
  // todo: only run tests that are linked to file changes by doing
  // something smart like reading through the require statements
  return gulp.watch(alljs, ['test']);
});

gulp.task('watch:coverage', function() {
  // todo: only run tests that are linked to file changes by doing
  // something smart like reading through the require statements
  return gulp.watch(alljs, ['coverage']);
});

gulp.task('watch:lint', function() {
  // todo: only lint files that are linked to file changes by doing
  // something smart like reading through the require statements
  return gulp.watch(alljs, ['lint']);
});
