# Build & Install
This includes a detailed instructions for compiling. There are two main parts of the build, compiling Bitcoin Core as a static library and the Node.js bindings.

## Ubuntu 14.04 (Unix/Linux)
If git is not already installed, it can be installed by running:

```bash
sudo apt-get install git
```

If Node.js v0.12 isn't installed, it can be installed using "nvm", it can be done by following the installation script at [https://github.com/creationix/nvm#install-script](https://github.com/creationix/nvm#install-script) and then install version v0.12

```bash
nvm install v0.12
```

To build Bitcoin Core and bindings development packages are needed:

```bash
sudo apt-get install build-essential libtool autotools-dev automake autoconf pkg-config libssl-dev
```

Clone the bitcore-node repository locally:

```bash
git clone https://github.com/bitpay/bitcore-node.git
cd bitcore-node
```

And finally run the build which will take several minutes. A script in the "bin" directory will download Bitcoin Core v0.11, apply a patch (see more info below), and compile the static library and Node.js bindings. You can start this by running:

```bash
npm install
```

Once everything is built, you can run bitcore-node via:

```bash
npm start
```

This will then start the syncing process for Bitcoin Core and the extended capabilities as provided by the built-in Address Module (details below).

## Fedora
Later versions of Fedora (>= 22) should also work with this project. The directions for Ubuntu should generally work except the installation of system utilities and libraries is a bit different. Git is already installed and ready for use without installation.

```bash
yum install libtool automake autoconf pkgconfig openssl make gcc gcc-c++ kernel-devel openssl-devel.x86_64 patch
```

## Mac OS X Yosemite
If Xcode is not already installed, it can be installed via the Mac App Store (will take several minutes). XCode includes "Clang", "git" and other build tools. Once Xcode is installed, you'll then need to install "xcode-select" via running in a terminal and following the prompts:

```bash
xcode-select --install
```

If "Homebrew" is not yet installed, it's needed to install "autoconf" and others. You can install it using the script at [http://brew.sh](http://brew.sh) and following the directions at [https://github.com/Homebrew/homebrew/blob/master/share/doc/homebrew/Installation.md](https://github.com/Homebrew/homebrew/blob/master/share/doc/homebrew/Installation.md) And then run in a terminal:

```bash
brew install autoconf automake libtool openssl pkg-config
```

If Node.js v0.12 and associated commands "node", "npm" and "nvm" are not already installed, you can use "nvm" by running the script at [https://github.com/creationix/nvm#install-script](https://github.com/creationix/nvm#install-script) And then run this command to install Node.js v0.12

```bash
nvm install v0.12
```

Clone the bitcore-node repository locally:

```bash
git clone https://github.com/bitpay/bitcore-node.git
cd bitcore-node
```

And finally run the build which will take several minutes. A script in the "bin" directory will download Bitcoin Core v0.11, apply a patch (see more info below), and compile the static library and Node.js bindings. You can start this by running:

```bash
npm install
```

## Cross Compilation
If you desire to cross compile to ARM or Windows from a system that has cross compilation tools available for use, please use the following directions:

Using a Debian (Jessie) system as the host system (the system that will be doing the compiling):

```bash
echo -n "deb http://emdebian.org/tools/debian/ jessie main" | sudo tee -a /etc/apt/sources.list
sudo dpkg --add-architecture armhf  #or whatever arch you are interested in compiling for
sudo apt-get update #you will get GPG KEY warnings, you can decide if you would like to trust the key
sudo apt-get install crossbuild-essential-armhf
```

Next is to use the cross compilation toolchain instead of the defaults:

```bash
CXX=arm-linux-gnueabihf-g++ CC=arm-linux-gnueabihf-gcc npm install
```

The only thing different is the setting of CC/CXX environment variables. Please make sure those compilers (arm-linux-gnueabihf-gcc) actually exist and are on your path.

```bash
arm-linux-gnueabihf-g++ -v
arm-linux-gnueabihf-gcc -v
```

You should get output with the last line ending with something like this:
gcc version 4.9.2 ( 4.9.2-10)

Once everything is built, you can run bitcore-node via:

```bash
npm start
```

This will then start the syncing process for Bitcoin Core and the extended capabilities as provided by the built-in Address Module (details below).
