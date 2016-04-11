# Release Process
Binaries for bitcoind are distributed for convenience and built deterministically with Gitian.

## How to Verify Signatures

```
cd bin
gpg --verify bitcoin-0.12.0-linux64.tar.gz.sig bitcoin-0.12.0-linux64.tar.gz
```

To verify signatures, use the following PGP keys:
- @braydonf: [https://pgp.mit.edu/pks/lookup?op=get&search=0x9BBF07CAC07A276D](https://pgp.mit.edu/pks/lookup?op=get&search=0x9BBF07CAC07A276D)
- @kleetus: [https://pgp.mit.edu/pks/lookup?op=get&search=0x33195D27EF6BDB7F](https://pgp.mit.edu/pks/lookup?op=get&search=0x33195D27EF6BDB7F)
- @pnagurny: [https://pgp.mit.edu/pks/lookup?op=get&search=0x0909B33F0AA53013](https://pgp.mit.edu/pks/lookup?op=get&search=0x0909B33F0AA53013)

## How to Release
Ensure you've followed the instructions in the README.md for building the project from source. When building for any platform, be sure to keep in mind the minimum supported C and C++ system libraries and build from source using this library. Example, Ubuntu 12.04 has the earliest system library for Linux that we support, so it would be easiest to build the Linux artifact using this version. A script will then upload the binaries to S3 for later use. You will also need credentials for BitPay's bitcore-node S3 bucket and be listed as an author for the bitcore-node's npm module.
- Create a file `.bitcore-node-upload.json` in your home directory
- The format of this file should be:

```json
{
  "region": "us-west-2",
  "accessKeyId": "xxx",
  "secretAccessKey": "yyy"
}
```

When publishing to npm, the .gitignore file is used to exclude files from the npm publishing process. Be sure that the bitcore-node directory has only the directories and files that you would like to publish to npm. You might need to run the commands below on each platform that you intend to publish (e.g. Mac and Linux).

To make a release, bump the `version` of the `package.json`:

```bash
git checkout master
git pull upstream master
git commit -a -m "Bump package version to <version>"
npm install
npm run package
npm run upload
npm publish
```

Create a release tag and push it to the BitPay Github repo:

```bash
git tag <version>
git push upstream <version>
```
