{
  'targets': [{
    'target_name': 'bitcoindjs',
    'variables': {
      'BOOST_INCLUDE': '<!(test -n "$BOOST_INCLUDE"'\
      ' && echo "$BOOST_INCLUDE"'\
      ' || echo /usr/include/boost)',
      'BITCOIN_DIR': '<!(test -n "$BITCOIN_DIR"'\
        ' && echo "$BITCOIN_DIR"'\
        ' || echo "${HOME}/bitcoin")',
    },
    'include_dirs' : [
      # standard include:
      # '/usr/include',

      # boost:
      # '<(BOOST_INCLUDE)',

      # leveldb:
      '<(BITCOIN_DIR)/src/leveldb/include',

      # bitcoind:
      '<(BITCOIN_DIR)/src',

      # nan:
      '<!(node -e "require(\'nan\')")',
    ],
    'sources': [
      './src/bitcoindjs.cc',
    ],
    'defines': [
      # boost sleep:
      '<!(test $(grep "#define BOOST_VERSION " <(BOOST_INCLUDE)/version.hpp'\
      ' | awk "{ print \$3 }") -ge 105200'\
      ' && echo HAVE_WORKING_BOOST_SLEEP_FOR'\
      ' || echo HAVE_WORKING_BOOST_SLEEP)',

      # wallet:
      'ENABLE_WALLET',
    ],
    'cflags_cc': [
      '-fexceptions',
      '-frtti',
    ],
    'libraries': [
      # standard libs:
      # '-L/usr/lib',
      # '-L/usr/local/lib',

      # boost:
      '-lboost_system',
      '-lboost_filesystem',
      '-lboost_program_options',
      '-lboost_thread',
      '-lboost_chrono',

      # bitcoind:
      '<(BITCOIN_DIR)/src/libbitcoind.so',
    ]
  }]
}
