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
      'BITCOIN_DIR': '<!(./platform/os.sh btcdir)',
      'LIBBITCOIND': '<!(./platform/os.sh lib)',
    },
    'defines': [
      'ENABLE_WALLET=1',
    ],
    'include_dirs' : [
      '<(BOOST_INCLUDE)',
      '<(LEVELDB_INCLUDE)',
      '<(BITCOIN_DIR)/src',
      './libbitcoind/src/leveldb/helpers/memenv',
      '<!(node -e "require(\'nan\')")',
    ],
    'sources': [
      './src/bitcoindjs.cc',
    ],
    'conditions': [
        ['OS=="mac"', {
          'xcode_settings': {
            'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
            'GCC_ENABLE_CPP_RTTI': 'YES'
          }
        }]
    ],
    'cflags_cc': [
      '-fexceptions',
      '-frtti',
      '-fpermissive',
    ],
    'libraries': [
      '-lssl',
      '-lcrypto',
      '-lboost_system',
      '-lboost_filesystem',
      '-lboost_program_options',
      '-lboost_thread-mt',
      '-lboost_chrono',
      '<(LIBBITCOIND)',
    ]
  }]
}
