{
  'targets': [{
    'target_name': 'bitcoindjs',
    'include_dirs' : [
      '<!(node -e "require(\'nan\')")',
      '<!(./platform/os.sh depends_dir)/include',
      './libbitcoind/src/leveldb/include',
      './libbitcoind/src',
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
