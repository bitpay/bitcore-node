## Release Process

Binaries for the C++ binding file (which includes libbitcoind statically linked in) are distributed for convenience. The binary binding file `bitcoind.node` is published to S3 for later download and installation. Source files can also be built if binaries are not desired.

### How to Release

Ensure you've followed the instructions in the README.md for building the project from source. You will be using the node-gyp to build buildings and a script upload the binary to S3. You will also need credentials for BitPay's bitcore-node S3 bucket and be listed as an author for the bitcore-node's npm module.

- Create a file `.bitcore-node-upload.json` in your home directory
- The format of this file should be:

```json
{
  "region": "us-east-1",
  "accessKeyId": "xxx",
  "secretAccessKey": "yyy"
}
```

To make a release, bump the version of the package.json:

```bash
git commit -a -m "Bump package version to <version>"
npm install
npm run upload
npm publish
```

And then update the version of the package.json for development (e.g. "0.3.2-dev"):

```bash
git commit -a -m "Bump development version to <version>"
git push upstream master
```
