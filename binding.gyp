{
  'targets': [{
    'target_name': "<(module_name)",
    'include_dirs' : [
      '<!(node -e "require(\'nan\')")',
      '<!(./platform/os.sh artifacts_dir)/include/libbitcoind/src',
      '<!(./platform/os.sh artifacts_dir)/include/libbitcoind/depends/<!(./platform/os.sh host)/include',
      '<!(./platform/os.sh artifacts_dir)/include/libbitcoind/src/leveldb/include'
    ],
    'sources': [
      './src/libbitcoind.cc',
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
        '<!(./platform/os.sh bitcoind)',
        '<!(./platform/os.sh filesystem)',
        '<!(./platform/os.sh thread)',
        '<!(./platform/os.sh program_options)',
        '<!(./platform/os.sh system)',
        '<!(./platform/os.sh chrono)',
        '<!(./platform/os.sh libsecp256k1)',
        '<!(./platform/os.sh leveldb)',
        '<!(./platform/os.sh memenv)',
        '<!(./platform/os.sh bdb)',
        '-lssl',
        '-lcrypto'
      ],
      'ldflags': [
        '<!(./platform/os.sh load_archive)'
      ]
    }
  },
  {
    "target_name": "action_after_build",
    "type": "none",
    "dependencies": [ "<(module_name)" ],
    "copies": [
    {
      "files": [ "<(PRODUCT_DIR)/<(module_name).node" ],
      "destination": "<(module_path)"
    }
    ]
  }]
}
