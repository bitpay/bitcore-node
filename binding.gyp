{
  'targets': [{
    'target_name': 'bitcoindjs',
    'include_dirs' : [
      '<!(node -e "require(\'nan\')")',
      '<!(./platform/os.sh artifacts_dir)/include/libbitcoind/src',
      '<!(./platform/os.sh artifacts_dir)/include/libbitcoind/depends/<!(./platform/os.sh host)/include',
      '<!(./platform/os.sh artifacts_dir)/include/libbitcoind/src/leveldb/include'
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
    'link_settings': {
      'libraries': [
        '<!(./platform/os.sh filesystem)',
        '<!(./platform/os.sh thread)',
        '<!(./platform/os.sh lib)'
      ],
      'ldflags': [
        '-Wl,-rpath,<!(./platform/os.sh osdir)',
        '<!(./platform/os.sh load_archive)'
      ]
    }
  }]
}
