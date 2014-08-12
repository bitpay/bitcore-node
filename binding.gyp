{
  'targets': [{
    'target_name': 'bitcoindjs',
    'include_dirs' : [
      '<!(node -e "require(\'nan\')")',
    ],
    'sources': [
      'src/bitcoindjs.cc'
    ],
    'libraries': [
      '-lutil',
      '-L/usr/lib',
      '-L/usr/local/lib'
    ]
  }]
}
