#!/bin/bash

exec 2> /dev/null
root_dir="$(cd "$(dirname $0)" && pwd)/.."
if [ "${root_dir}" == "" ]; then
  root_dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/.."
fi
bitcoin_dir="${root_dir}"/libbitcoind
cache_dir="${root_dir}"/cache

get_host_and_platform () {
  platform=`uname -a | awk '{print tolower($1)}'`
  arch=`uname -m`
  if [ "${arch:0:3}" == "arm" ]; then
    platform="linux-gnueabihf"
    arch="arm"
  fi
  if [ -n "${CXX}" ] && [ -n "${CC}" ]; then
    cc_target=$("${CC}" -v 2>&1 | awk '/Target:/ {print $2}')
    cxx_target=$("${CXX}" -v 2>&1 | awk '/Target:/ {print $2}')
    IFS='-' read -ra SYS <<< "${cc_target}"
    if [ "${SYS[0]}" != "${arch}" ]; then
      if [ -n "${SYS[1]}" ] && [ -n "${SYS[2]}" ] && hash "${CXX}" && hash "${CC}" && [ -n "${cc_target}" ] && [ -n "${cxx_target}" ]; then
        #try and see if we've got a cross compiler, if not then auto detect
        arch="${SYS[0]}"
        platform="${SYS[1]}"-"${SYS[2]}"
      else
        error_message="You've specified a cross compiler, but we could not compute the host-platform-triplet for cross compilation. Please set CC and CXX environment variables with host-platform-triplet-*. Also ensure the cross compiler exists on your system and is available on your path. Example: CC=arm-linux-gnueabihf-gcc CXX=arm-linux-gnueabihf-g++"
        return_error_message
      fi
    fi
  fi
}

return_error_message () {
  echo "${error_message}"
  exit -1
}

get_host_and_platform
host="${arch}"-"${platform}"

mac_response=
check_mac_build_system () {
  if [ "${platform}" == "darwin" ]; then
    if [ ! -e "/usr/include/stdlib.h" ]; then
      if hash xcode-select 2>/dev/null; then
        mac_response="Please run 'xcode-select --install' from the command line because it seems that you've got Xcode, but not the Xcode command line tools that are required for compiling this project from source..."
      else
        mac_response="please use the App Store to install Xcode and Xcode command line tools. After Xcode is installed, please run: 'xcode-select --install' from the command line"
      fi
    fi
  fi
}

depends_dir="${bitcoin_dir}"/depends
thread="${cache_dir}"/depends/"${host}"/lib/libboost_thread-mt.a
filesystem="${cache_dir}"/depends/"${host}"/lib/libboost_filesystem-mt.a
chrono="${cache_dir}"/depends/"${host}"/lib/libboost_chrono-mt.a
program_options="${cache_dir}"/depends/"${host}"/lib/libboost_program_options-mt.a
system="${cache_dir}"/depends/"${host}"/lib/libboost_system-mt.a
leveldb="${cache_dir}"/src/leveldb/libleveldb.a
memenv="${cache_dir}"/src/leveldb/libmemenv.a
libsecp256k1="${cache_dir}"/src/secp256k1/.libs/libsecp256k1.a
ssl="${cache_dir}"/depends/"${host}"/lib/libssl.a
crypto="${cache_dir}"/depends/"${host}"/lib/libcrypto.a

config_lib_dir=
if [ "${platform}" == "darwin" ]; then
  config_lib_dir="--with-boost-libdir=${depends_dir}/${host}/lib"
else
  config_lib_dir="--prefix=${depends_dir}/${host}"
fi

if test x"$1" = x'anl'; then
  if [ "${platform}" != "darwin" ]; then
    echo -n "-lanl"
  fi
fi

if test x"$1" = x'cache_dir'; then
  echo -n "${cache_dir}"
fi

if test x"$1" = x'btcdir'; then
  echo -n "${bitcoin_dir}"
fi

if test -z "$1" -o x"$1" = x'thread'; then
  echo -n "${thread}"
fi

if test -z "$1" -o x"$1" = x'filesystem'; then
  echo -n "${filesystem}"
fi

if test -z "$1" -o x"$1" = x'program_options'; then
  echo -n "${program_options}"
fi

if test -z "$1" -o x"$1" = x'system'; then
  echo -n "${system}"
fi

if test -z "$1" -o x"$1" = x'ssl'; then
  echo -n "${ssl}"
fi

if test -z "$1" -o x"$1" = x'crypto'; then
  echo -n "${crypto}"
fi

if test -z "$1" -o x"$1" = x'chrono'; then
  echo -n "${chrono}"
fi

if test -z "$1" -o x"$1" = x'depends_dir'; then
  echo -n "${depends_dir}"
fi

if test -z "$1" -o x"$1" = x'leveldb'; then
  echo -n "${leveldb}"
fi

if test -z "$1" -o x"$1" = x'memenv'; then
  echo -n "${memenv}"
fi

if test -z "$1" -o x"$1" = x'libsecp256k1'; then
  echo -n "${libsecp256k1}"
fi

if test -z "$1" -o x"$1" = x'host'; then
  echo -n "${host}"
fi

if test -z "$1" -o x"$1" = x'arch'; then
  echo -n "${arch}"
fi

if test -z "$1" -o x"$1" = x'bdb'; then
  if [ "${BITCORENODE_ENV}" == "test" ]; then
    echo -n "${cache_dir}"/depends/"${host}"/lib/libdb_cxx.a
  fi
fi

if test -z "$1" -o x"$1" = x'load_archive'; then
  if [ "${os}"  == "osx" ]; then
    echo -n "-Wl,-all_load -Wl,--no-undefined"
  else
    echo -n "-Wl,--whole-archive ${filesystem} ${thread} "${cache_dir}"/src/.libs/libbitcoind.a -Wl,--no-whole-archive"
  fi
fi

if test -z "$1" -o x"$1" = x'mac_dependencies'; then
  check_mac_build_system
  echo -n "${mac_response}"
fi

if test -z "$1" -o x"$1" = x'wallet_enabled'; then
  if [ "${BITCORENODE_ENV}" == "test" ]; then
    echo -n "-DENABLE_WALLET"
  fi
fi

if test -z "$1" -o x"$1" = x'sys'; then
  if [ -n "${SYS}" ]; then
    echo -n "--arch=${SYS[0]}"
  fi
fi

if test -z "$1" -o x"$1" = x'bitcoind'; then
  echo -n "${cache_dir}"/src/.libs/libbitcoind.a
fi

if test -z "$1" -o x"$1" = x'config_lib_dir'; then
  echo -n "${config_lib_dir}"
fi
