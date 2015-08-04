#!/bin/bash

exec 2> /dev/null

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.."
BITCOIN_DIR="${root_dir}/libbitcoind"
os=
ext=so

host=`uname -m`-`uname -a | awk '{print tolower($1)}'`
depends_dir="${BITCOIN_DIR}"/depends
h_and_a_dir="${depends_dir}"/"${host}"

mac_response=
check_mac_build_system () {
  if [ "${ext}" == "dylib" ]; then
    if [ ! -d "/usr/include" ]; then
      if hash xcode-select 2>/dev/null; then
        mac_response="Please run 'xcode-select --install' from the command line because it seems that you've got Xcode, but not the Xcode command line tools that are required for compiling this project from source..."
      else
        mac_response="please use the App Store to install Xcode and Xcode command line tools. After Xcode is installed, please run: 'xcode-select --install' from the command line"
      fi
    fi
  fi
}

if test -f /etc/centos-release \
  || grep -q 'CentOS' /etc/redhat-release \
  || rpm -q --queryformat '%{VERSION}' centos-release > /dev/null; then
  os=centos
elif grep -q 'Fedora' /etc/system-release; then
  os=fedora
elif test -f /etc/redhat_release \
  || test -f /etc/redhat-release; then
  os=rhel
elif uname -a | grep -q '^Darwin'; then
  os=osx
  ext=dylib
elif test -f /etc/SuSE-release; then
  os=suse
elif test -f /etc/mandrake-release \
  || test -f /etc/mandriva-release; then
  os=mandriva
elif grep -q 'Linux Mint' /etc/issue; then
  os=mint
elif grep -q 'Ubuntu' /etc/issue \
  || grep -q 'Ubuntu' /etc/lsb-release \
  || uname -v | grep -q 'Ubuntu'; then
  os=ubuntu
elif test -f /etc/debian_version \
  || test -f /etc/debian-version; then
  os=debian
elif grep -q 'Arch Linux' /etc/issue \
  || test -d /lib/systemd -a "$(readlink /usr/bin/vi)" = 'ex'; then
  os=arch
elif test "$(uname -s)" = 'SunOS'; then
  os=solaris
elif test "$(uname -s)" = 'AIX'; then
  os=aix
elif test -d /system && test -d /data/data; then
  os=android
fi

os_dir=${root_dir}/platform/${os}

if [ "${os}"  == "osx" ]; then
  artifacts_dir="${os_dir}/lib"
else
  artifacts_dir="${os_dir}"
fi

thread="${artifacts_dir}"/lib/libboost_thread-mt.a
filesystem="${artifacts_dir}"/lib/libboost_filesystem-mt.a
chrono="${artifacts_dir}"/lib/libboost_chrono-mt.a
program_options="${artifacts_dir}"/lib/libboost_program_options-mt.a
system="${artifacts_dir}"/lib/libboost_system-mt.a
leveldb="${BITCOIN_DIR}"/src/leveldb/libleveldb.a
memenv="${BITCOIN_DIR}"/src/leveldb/libmemenv.a
libsecp256k1="${BITCOIN_DIR}"/src/secp256k1/.libs/libsecp256k1.a

if test -z "$os" -o x"$os" = x'android' -o x"$os" = x'aix'; then
  if test "$os" = 'android' -o "$os" = 'aix'; then
    echo 'Android or AIX detected!' >& 2
  fi
  echo 'OS not supported.' >& 2
  exit 1
fi

if test x"$1" = x'osdir'; then
  echo -n "$(pwd)/platform/${os}"
  exit 0
fi

if test x"$1" = x'btcdir'; then
  echo -n "${BITCOIN_DIR}"
  exit 0
fi

if test -z "$1" -o x"$1" = x'ext'; then
  echo -n "${ext}"
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

if test -z "$1" -o x"$1" = x'h_and_a_dir'; then
  echo -n "${h_and_a_dir}"
fi

if test -z "$1" -o x"$1" = x'host'; then
  echo -n "${host}"
fi

if test -z "$1" -o x"$1" = x'bdb'; then
  if [ "${BITCOINDJS_ENV}" == "test" ]; then
    echo -n "${artifacts_dir}/lib/libdb_cxx.a"
  fi
fi

if test -z "$1" -o x"$1" = x'load_archive'; then
  if [ "${os}"  == "osx" ]; then
    echo -n "-Wl,-all_load -Wl,--no-undefined"
  else
    echo -n "-Wl,--whole-archive ${filesystem} ${thread} "${BITCOIN_DIR}"/src/.libs/libbitcoind.a -Wl,--no-whole-archive"
  fi
fi

if test -z "$1" -o x"$1" = x'artifacts_dir'; then
  echo -n "${artifacts_dir}" 
fi

if test -z "$1" -o x"$1" = x'mac_dependencies'; then
  check_mac_build_system
  echo -n "${mac_response}"
fi

if test -z "$1" -o x"$1" = x'bitcoind'; then
  echo -n "${BITCOIN_DIR}"/src/.libs/libbitcoind.a
fi
