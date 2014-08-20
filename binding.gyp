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
      # '-L<!(echo "$HOME")/bitcoin/src/bitcoind',
      '-L/usr/bin/bitcoind',
      # NOTE: Rename this to bitcoind.o so we can statically link to it.
      # '-L<!(echo "$HOME")/bitcoin/src/bitcoind.o',
      # '-L/usr/lib/bitcoind.o',
      # statically link leveldb - shouldn't be necessary, but build fails without it:
      '-L/home/user/bitcoin/src/leveldb/libleveldb.a',
      # bdb - should already be done:
      # '-L/usr/lib/libdb-5.3.so',
      # '-L/usr/lib/libdb_cxx-5.3.so',
      # with aur package, we can use: /usr/lib/libdb-4.8.so
      # standard libs:
      '-L/usr/lib',
      '-L/usr/local/lib'

    ]
  }]
}
