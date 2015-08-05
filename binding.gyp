{
  "targets": [
    {
      "target_name": "<(module_name)",
      "include_dirs" : [
        "<!(node -e \"require('nan')\")",
        "<!(./bin/variables.sh btcdir)/src",
        "<!(./bin/variables.sh btcdir)/depends/<!(./bin/variables.sh host)/include",
        "<!(./bin/variables.sh btcdir)/src/leveldb/include"
      ],
      "sources": [
        "./src/libbitcoind.cc",
      ],
      "conditions": [
        [
          "OS==\"mac\"", 
          {
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "GCC_ENABLE_CPP_RTTI": "YES",
              "MACOSX_DEPLOYMENT_TARGET": "10.9"
            }
          }
        ]
      ],
      "cflags_cc": [
        "-fexceptions",
        "-frtti",
        "-fpermissive",
      ],
      "link_settings": {
        "libraries": [
          "<!(./bin/variables.sh bitcoind)",
          "<!(./bin/variables.sh filesystem)",
          "<!(./bin/variables.sh thread)",
          "<!(./bin/variables.sh program_options)",
          "<!(./bin/variables.sh system)",
          "<!(./bin/variables.sh chrono)",
          "<!(./bin/variables.sh libsecp256k1)",
          "<!(./bin/variables.sh leveldb)",
          "<!(./bin/variables.sh memenv)",
          "<!(./bin/variables.sh bdb)",
          "-lssl",
          "-lcrypto"
        ],
        "ldflags": [
          "<!(./bin/variables.sh load_archive)"
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
    }
  ]
}
