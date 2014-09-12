{
  'targets': [{
    'target_name': 'bitcoindjs',
    'include_dirs' : [
      # standard include:
      # '/usr/include',
      '<!(node -e "require(\'nan\')")',
      # '/usr/include/boost',
      '<!(test -n "$BITCOIN_DIR" && echo "$BITCOIN_DIR" || echo "${HOME}/bitcoin")/src/leveldb/include',
      '<!(test -n "$BITCOIN_DIR" && echo "$BITCOIN_DIR" || echo "${HOME}/bitcoin")/src',
    ],
    'sources': [
      './src/bitcoindjs.cc',
    ],
    'defines': [
      '<!(test $(grep "#define BOOST_VERSION " /usr/include/boost/version.hpp'\
      ' | awk "{ print \$3 }") -gt 105200'\
      ' && echo HAVE_WORKING_BOOST_SLEEP_FOR'\
      ' || echo HAVE_WORKING_BOOST_SLEEP)',
      # Assume libbitcoind.so is always
      # compiled with wallet support.
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
      '<!(test -n "$BITCOIN_DIR" && echo "$BITCOIN_DIR" || echo "${HOME}/bitcoin")/src/libbitcoind.so',
    ]
  }]
}
