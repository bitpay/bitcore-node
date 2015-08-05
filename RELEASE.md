## Release Notes 

Binaries for the C++ binding file (which includes libbitcoind statically linked in) are distributed with the help of node-pre-gyp. Node-pre-gyp publishes pre-built binaries to S3 for later download and installation. Source files can also be built if binaries are not desired.

## How to release

Ensure you've followed the instructions in the README.md for building the project from source. You will be using the node-pre-gyp to package and publish the project to S3. You will also need credentials for Bitpay's bitcore-node S3 bucket and be listed as an author for the bitcore-node's npm module.

- Create a file, ".node_pre_gyprc" in your home directory
- The format of this file should be:


```json
{
  "accessKeyId": "xxx",
  "secretAccessKey": "yyy"
}
```

- then run the commands to push binaries corresponding to the version in package.json to S3 and npm

```bash
npm install
node-pre-gyp package publish
npm publish
```

 


