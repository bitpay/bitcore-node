{
  'targets': [{
    'target_name': "<(module_name)",
    'include_dirs' : [
      '<!(node -e "require(\'nan\')")',
      '<!(./variables.sh btcdir)/src',
      '<!(./variables.sh btcdir)/depends/<!(./variables.sh host)/include',
      '<!(./variables.sh btcdir)/src/leveldb/include'
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
        '<!(./variables.sh bitcoind)',
        '<!(./variables.sh filesystem)',
        '<!(./variables.sh thread)',
        '<!(./variables.sh program_options)',
        '<!(./variables.sh system)',
        '<!(./variables.sh chrono)',
        '<!(./variables.sh libsecp256k1)',
        '<!(./variables.sh leveldb)',
        '<!(./variables.sh memenv)',
        '<!(./variables.sh bdb)',
        '-lssl',
        '-lcrypto'
      ],
      'ldflags': [
        '<!(./variables.sh load_archive)'
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
