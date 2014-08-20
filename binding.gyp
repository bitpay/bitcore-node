{
  'targets': [{
    'target_name': 'bitcoindjs',
    'include_dirs' : [
      '<!(node -e "require(\'nan\')")',
      '<!(echo "$HOME")/bitcoin/src',
      '<!(echo "$HOME")/bitcoin/src/leveldb/include',
      '/usr/include',
      '/usr/include/boost'
      # include our own boost
      # './deps'
    ],
    'sources': [
      './src/bitcoindjs.cc'
    ],
    'defines': [
      'HAVE_WORKING_BOOST_SLEEP'
      #'HAVE_WORKING_BOOST_SLEEP_FOR'
    ],
    'cflags_cc': [
      '-fexceptions',
      '-frtti'
    ],
    'libraries': [
      # standard libs:
      '-L/usr/lib',
      '-L/usr/local/lib',

      # boost:
      #'-lboost_system-mt',
      '-lboost_system',

      #'-L/usr/lib/libboost_atomic.so',
      #'-L/usr/lib/libboost_chrono.so',
      #'-L/usr/lib/libboost_context.so',
      #'-L/usr/lib/libboost_coroutine.so',
      #'-L/usr/lib/libboost_date_time.so',
      #'-L/usr/lib/libboost_filesystem.so',
      #'-L/usr/lib/libboost_graph.so',
      #'-L/usr/lib/libboost_graph_parallel.so',
      #'-L/usr/lib/libboost_iostreams.so',
      #'-L/usr/lib/libboost_locale.so',
      #'-L/usr/lib/libboost_log.so',
      #'-L/usr/lib/libboost_log_setup.so',
      #'-L/usr/lib/libboost_math_c99.so',
      #'-L/usr/lib/libboost_math_c99f.so',
      #'-L/usr/lib/libboost_math_c99l.so',
      #'-L/usr/lib/libboost_math_tr1.so',
      #'-L/usr/lib/libboost_math_tr1f.so',
      #'-L/usr/lib/libboost_math_tr1l.so',
      #'-L/usr/lib/libboost_mpi.so',
      #'-L/usr/lib/libboost_mpi_python.so',
      #'-L/usr/lib/libboost_prg_exec_monitor.so',
      #'-L/usr/lib/libboost_program_options.so',
      #'-L/usr/lib/libboost_python.so',
      #'-L/usr/lib/libboost_python3.so',
      #'-L/usr/lib/libboost_random.so',
      #'-L/usr/lib/libboost_regex.so',
      #'-L/usr/lib/libboost_serialization.so',
      #'-L/usr/lib/libboost_signals.so',
      #'-L/usr/lib/libboost_system.so',
      #'-L/usr/lib/libboost_thread.so',
      #'-L/usr/lib/libboost_timer.so',
      #'-L/usr/lib/libboost_unit_test_framework.so',
      #'-L/usr/lib/libboost_wave.so',
      #'-L/usr/lib/libboost_wserialization.so',

      # statically link leveldb - shouldn't be necessary, but build fails without it:
      '-L<!(echo "$HOME")/bitcoin/src/leveldb/libleveldb.a',

      # bdb - should already be done:
      # '-L/usr/lib/libdb-5.3.so',
      # '-L/usr/lib/libdb_cxx-5.3.so',
      # '-L/usr/lib/libdb-4.8.so',
      # '-L/usr/lib/libdb_cxx-4.8.so',

      # bitcoind:
      # NOTE: Rename this to bitcoind.o so we can statically link to it.
      # '-L<!(echo "$HOME")/bitcoin/src/bitcoind.o',
      # '-L/usr/lib/bitcoind.o',
      # '-L<!(echo "$HOME")/bitcoin/src/bitcoind',
      '-L/usr/bin/bitcoind',
    ]
  }]
}
