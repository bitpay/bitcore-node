{
  'targets': [{
    'target_name': 'bitcoindjs',
    'include_dirs' : [
      '/usr/include/boost',
      './libbitcoind/src/leveldb/include',
      './libbitcoind/src',
      '<!(node -e "require(\'nan\')")'
    ],
    'sources': [
      './src/bitcoindjs.cc',
    ],
    'conditions': [
        ['OS=="mac"', {
          'xcode_settings': {
            'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
            'GCC_ENABLE_CPP_RTTI': 'YES',
            'MACOSX_DEPLOYMENT_TARGET': '10.9'
          }
	}
      ]
    ],
    'cflags_cc': [
      '-fexceptions',
      '-frtti',
      '-fpermissive',
    ],
    'libraries': [
      '-lboost_filesystem',
      '-lboost_thread',
      '-lbitcoind'
    ]
  }]
}
