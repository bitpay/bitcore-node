{
  'targets': [{
    'target_name': 'bitcoindjs',
    'include_dirs' : [
      # standard include:
      # '/usr/include',
      '<!(node -e "require(\'nan\')")',
      '/usr/include/boost',
      '<!(test -n "$BITCOIN_DIR" && echo "$BITCOIN_DIR" || echo "${HOME}/bitcoin")/src/leveldb/include',
      '<!(test -n "$BITCOIN_DIR" && echo "$BITCOIN_DIR" || echo "${HOME}/bitcoin")/src',
    ],
    # 'includes': [
    #   './include.gypi',
    # ],
    # 'variables': {
    #   'BOOST_VERSION': '<!(grep "#define BOOST_VERSION " /usr/include/boost/version.hpp | awk "{ print \$3 }")',
    #   'BOOST_HAS_NANOSLEEP': '0',
    # },
    'conditions': [
      ['OS=="linux"', {
        'variables': {
          'BOOST_VERSION': '<!(grep "#define BOOST_VERSION " /usr/include/boost/version.hpp | awk "{ print \$3 }")',
          'BOOST_HAS_NANOSLEEP': '<!(grep -q "#define \+BOOST_HAS_NANOSLEEP" /usr/include/boost/config/platform/linux.hpp && echo 1 || echo 0)',
        },
      }],
      ['OS=="darwin"', {
        'variables': {
          'BOOST_VERSION': '<!(grep "#define BOOST_VERSION " /usr/include/boost/version.hpp | awk "{ print \$3 }")',
          'BOOST_HAS_NANOSLEEP': '<!(grep -q "#define \+BOOST_HAS_NANOSLEEP" /usr/include/boost/config/platform/macos.hpp && echo 1 || echo 0)',
        },
      }],
      ['OS!="linux" && OS!="darwin"', {
        'variables': {
          'BOOST_VERSION': '<!(grep "#define BOOST_VERSION " /usr/include/boost/version.hpp | awk "{ print \$3 }")',
          'BOOST_HAS_NANOSLEEP': '0',
        },
      }],
      ['BOOST_VERSION>=105000 && (BOOST_HAS_NANOSLEEP==0 || BOOST_VERSION>=105200)', {
        'variables': {
          'BOOST_SLEEP': 'HAVE_WORKING_BOOST_SLEEP_FOR',
        },
        #'defines': [
        #  'HAVE_WORKING_BOOST_SLEEP_FOR',
        #  # Assume libbitcoind.so is always
        #  # compiled with wallet support.
        #  'ENABLE_WALLET',
        #],
      }, { # !(BOOST_VERSION>=105000) ...
        'variables': {
          'BOOST_SLEEP': 'HAVE_WORKING_BOOST_SLEEP',
        },
        #'defines': [
        #  'HAVE_WORKING_BOOST_SLEEP',
        #  # Assume libbitcoind.so is always
        #  # compiled with wallet support.
        #  'ENABLE_WALLET',
        #],
      }],
    ],
    'sources': [
      './src/bitcoindjs.cc',
    ],
    'defines': [
      # TODO: Figure out how to detect BOOST_SLEEP in gyp.
      # 'HAVE_WORKING_BOOST_SLEEP',
      '<(BOOST_SLEEP)',
      # Assume libbitcoind.so is always
      # compiled with wallet support.
      'ENABLE_WALLET',
    ],
    'conditions': [
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
