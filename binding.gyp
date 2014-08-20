{
  'targets': [{
    'target_name': 'bitcoindjs',
    'include_dirs' : [
      '<!(node -e "require(\'nan\')")',
      '<!(echo "$HOME")/bitcoin/src',
      '<!(echo "$HOME")/bitcoin/src/leveldb/include',
      '/usr/include/boost',
      # include our own boost
      #'./deps'
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
      '-lutil',
      # NOTE: rename this to bitcoind.o so we can statically link to it
      '-L/home/user/bitcoin/src/bitcoind',
      # statically link leveldb
      '-L/home/user/bitcoin/src/leveldb/libleveldb.a',
      '-L/usr/lib',
      '-L/usr/local/lib'
    ]
  }]
}
