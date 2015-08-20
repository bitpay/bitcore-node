{
  "targets": [
    {
      "target_name": "libbitcoind",
      "include_dirs" : [
        "<!(node -e \"require('nan')\")",
        "<!(./bin/variables.sh cache_dir)/src",
        "<!(./bin/variables.sh cache_dir)/depends/<!(./bin/variables.sh host)/include",
        "<!(./bin/variables.sh cache_dir)/src/leveldb/include"
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
          "<!(./bin/variables.sh anl)",
          "-lssl",
          "-lcrypto"
        ],
        "ldflags": [
          "<!(./bin/variables.sh load_archive)"
        ]
      }
    },
    {
      "target_name": "test",
      "type": "executable",
      "sources": [
        "test/c++unit/libbitcoind_test.cpp" 
      ],
      "include_dirs": [
        "<!(./bin/variables.sh cache_dir)/src",
        "<!(./bin/variables.sh cache_dir)/depends/<!(./bin/variables.sh host)/include",
        "<!(./bin/variables.sh cache_dir)/src/leveldb/include",
        "<!(node -e \"require('cppunitlite')\")"
      ],
      "dependencies": [
        "node_modules/cppunitlite/binding.gyp:CppUnitLite"
      ]
    }
  ]
}
