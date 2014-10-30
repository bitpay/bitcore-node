g++ -I$HOME/bitcoin/src -I$HOME/bitcoin/src/obj -I$HOME/bitcoin/src/config \
  -I$HOME/bitcoin/src/leveldb/include \
  -DHAVE_WORKING_BOOST_SLEEP_FOR -DHAVE_CONFIG_H -g -O2 \
  -fexceptions -frtti -fpermissive -o test_btc test.cc \
  -lboost_system -lboost_filesystem -lboost_program_options \
  -lboost_thread -lboost_chrono -lssl -lcrypto \
  ${HOME}/bitcoin/src/libbitcoind.so
