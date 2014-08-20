{
  'targets': [{
    'target_name': 'bitcoindjs',
    'include_dirs' : [
      '<!(node -e "require(\'nan\')")',
      '<!(echo "$HOME")/bitcoin/src',
      '<!(echo "$HOME")/bitcoin/src/leveldb/include',
      '/usr/include/boost'
      # include our own boost
      # './deps'
    ],
    'sources': [
      './src/bitcoindjs.cc'
    ],
    'defines': [
      'HAVE_WORKING_BOOST_SLEEP'
      #'HAVE_WORKING_BOOST_SLEEP_FOR'
    ],
    'cflags_cc': [
      '-fexceptions',
      '-frtti'
    ],
    'libraries': [
      # bitcoind:
      # arch is using bitcoin-daemon 0.9.2.1
      #   - should be the correct boost headers
      # building:
      # $ git clean -df
      # $ git checkout v0.9.2.1
      # $ ./autogen.sh
      # $ ./configure --with-incompatible-bdb
      # $ time make
      # $ cd ~/work/node_modules/bitcoind.js
      # $ PYTHON=/usr/bin/python2.7 make gyp
      # ^ move this to readme
      # NOTE: rename this to bitcoind.o so we can statically link to it
      # '-L<!(echo "$HOME")/bitcoin/src/bitcoind',
      '-L/usr/bin/bitcoind',
      # '-L/usr/lib/bitcoind.o',
      # '-L<!(echo "$HOME")/bitcoin/src/bitcoind.o',
      # statically link leveldb:
      '-L/home/user/bitcoin/src/leveldb/libleveldb.a',
      # standard libs:
      '-L/usr/lib',
      '-L/usr/local/lib'
    ]
  }]
}
