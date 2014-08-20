{
  'targets': [{
    'target_name': 'bitcoindjs',
    'include_dirs' : [
      '/usr/include',
      '<!(node -e "require(\'nan\')")',
      # './deps',
      '/usr/include/boost',
      '<!(echo "$HOME")/bitcoin/src/leveldb/include',
      '<!(echo "$HOME")/bitcoin/src',
    ],
    'sources': [
      './src/bitcoindjs.cc',
    ],
    'defines': [
      'HAVE_WORKING_BOOST_SLEEP',
      #'HAVE_WORKING_BOOST_SLEEP_FOR',
    ],
    'cflags_cc': [
      '-fexceptions',
      '-frtti',
    ],
    'libraries': [
      # standard libs:
      '-L/usr/lib',
      '-L/usr/local/lib',
      # boost:
      '-lboost_system',
      # leveldb:
      '-L<!(echo "$HOME")/bitcoin/src/leveldb/libleveldb.a',
      # bitcoind:
      # '-L<!(echo "$HOME")/bitcoin/src/bitcoind',
      '-L/usr/bin/bitcoind',
    ]
  }]
}
