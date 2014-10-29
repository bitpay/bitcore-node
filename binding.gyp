{
  'targets': [{
    'target_name': 'bitcoindjs',
    'variables': {
      'BOOST_INCLUDE': '<!(test -n "$BOOST_INCLUDE"'\
      ' && echo "$BOOST_INCLUDE"'\
      ' || test -e /usr/include/boost && echo /usr/include/boost' \
      ' || echo ./include)',
      'LEVELDB_INCLUDE': '<!(test -n "$LEVELDB_INCLUDE"'\
      ' && echo "$LEVELDB_INCLUDE"'\
      ' || test "$BITCOIN_DIR" && echo "${BITCOIN_DIR}/src/leveldb/include"' \
      ' || echo ./include)',
      'BITCOIN_DIR': '<!(test -n "$BITCOIN_DIR"'\
        ' && echo "$BITCOIN_DIR"'\
        ' || echo "${HOME}/bitcoin")',
      'LIBBITCOIND': '<!(./platform/os.sh)',
    },
    'defines': [
      'ENABLE_WALLET=1',
    ],
    'include_dirs' : [
      '<(BOOST_INCLUDE)',
      '<(LEVELDB_INCLUDE)',
      '<(BITCOIN_DIR)/src',
      '<!(node -e "require(\'nan\')")',
    ],
    'sources': [
      './src/bitcoindjs.cc',
    ],
    'cflags_cc': [
      '-fexceptions',
      '-frtti',
      '-fpermissive',
    ],
    'libraries': [
      '-lboost_system',
      '-lboost_filesystem',
      '-lboost_program_options',
      '-lboost_thread',
      '-lboost_chrono',
      '<(LIBBITCOIND)',
    ]
  }]
}
