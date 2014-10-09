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
    'cflags_cc': [
      '-fexceptions',
      '-frtti',
      '-fpermissive',
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

      # '<(BITCOIN_DIR)/src/libbitcoin_server.a',
      # '<(BITCOIN_DIR)/src/libbitcoin_common.a',
      # '<(BITCOIN_DIR)/src/libbitcoin_wallet.a',
    ]
  }]
}
