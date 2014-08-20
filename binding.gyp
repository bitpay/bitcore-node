{
  'targets': [{
    'target_name': 'bitcoindjs',
    'include_dirs' : [
      '<!(node -e "require(\'nan\')")',
      '/home/user/bitcoin/src',
      '/home/user/bitcoin/src/leveldb/include',
      #'/usr/include/boost',
      './deps/boost'
    ],
    'sources': [
      'src/bitcoindjs.cc'
    ],
    'libraries': [
      '-lutil',
      # NOTE: rename this to bitcoind.o so we can statically link to it
      '-L/home/user/bitcoin/src/bitcoind',
      # statically link leveldb
      '-L/home/user/bitcoin/src/leveldb/libleveldb.a',
      '-L/usr/lib',
      '-L/usr/local/lib'
    ]
  }]
}
