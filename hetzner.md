# Deploy instructions for Hetzner Cloud

## Server

host: https://www.hetzner.com

### OS 
Ubuntu 20.04

### Type
CX31
2 VCPUs
8GB RAM
80GB SSD
20TB Traffic

## Setup

### Setup DNS record

Do this as soon as you have created the server to give the DNS record to propogate.

### Create new sudo user

ssh to your server as root, replacing `<xxx.xxx.xxx.xxx>` with the IP of your server. Then create your new sudo user, replacing `<username>` with your desired new ubuntu username.

```
ssh root@<xxx.xxx.xxx.xxx>
# enter new root password

adduser <username>
# enter password for new user

usermod -aG sudo <username>
su - <username>
```

### Install pre-requesites

source: https://github.com/nodesource/distributions/blob/master/README.md
```
su
apt-get update
apt-get upgrade

curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
apt-get install -y nodejs
npm install -g n
n 6

su - `username`
sudo apt-get install libzmq3-dev git python build-essential

exit
```
Make sure to exit so the terminal reloads with the new path variables

### Install mongodb

source: https://docs.mongodb.com/manual/tutorial/install-mongodb-on-ubuntu/
```
su
wget -qO - https://www.mongodb.org/static/pgp/server-4.4.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/4.4 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-4.4.list
apt-get update
apt-get install -y mongodb-org

su - `username`
sudo systemctl daemon-reload
sudo systemctl enable mongod
sudo systemctl start mongod
sudo systemctl status mongod
```

### Install bitcore
```
sudo chown -R $USER /usr/local/lib
sudo chown -R $USER /usr/local/bin

npm install --unsafe-perm -g git://github.com/Encrypt-S/bitcore-node.git
bitcore-node create mynode
cd mynode
bitcore-node install insight-api
bitcore-node install bitcore-wallet-service
```

### Create systemctl service
```
sudo vi /etc/systemd/system/bitcore.service
```

paste the following into vi, replacing `<username>` with your ubuntu username
```
[Unit]
Description=bitcore-node
After=network.target
After=network-online.target

[Service]
User=<username>
Type=simple
WorkingDirectory=/home/<username>/mynode
ExecStart=/usr/local/bin/bitcore-node start
ExecReload=/bin/kill -HUP 
Restart=on-failure
RestartSec=15
PermissionsStartOnly=true
TimeoutStopSec=300

[Install]
WantedBy=multi-user.target
```

### Start and monitor the bitcore service

```
sudo systemctl enable bitcore
sudo systemctl start bitcore
sudo systemctl status bitcore
sudo journalctl -u bitcore.service -f
```
The service should start and begin to sync the blockchain.

### Setup nginx

source: https://www.digitalocean.com/community/tutorials/how-to-install-nginx-on-ubuntu-20-04
```
sudo apt-get install nginx
sudo ufw app list
sudo ufw allow 'Nginx HTTPS'
sudo ufw allow 'Nginx HTTP'
sudo ufw allow OpenSSH
sudo ufw enable

sudo vi /etc/nginx/sites-available/navpay.conf
```

paste the following into vi, replacing `<navpay-api.navcoin.org>` with the url of your server as configured wth your dns provider;
```
server {
	server_name <navpay-api.navcoin.org>;

	location / {

		proxy_set_header 	Access-Control-Allow-Origin *;	
		proxy_pass 		http://localhost:3232;
		proxy_http_version 	1.1;
        	proxy_set_header 	Upgrade $http_upgrade;
	        proxy_set_header 	Connection 'upgrade';
	        proxy_set_header 	Host $host;
	        proxy_cache_bypass	$http_upgrade;
	}
}
```
enable the site
```
sudo ln -s /etc/nginx/sites-available/navpay.conf /etc/nginx/sites-enabled
sudo systemctl reload nginx
```

Install certbot and ssl certificates
source: https://certbot.eff.org/lets-encrypt/ubuntufocal-nginx
```
sudo apt install snapd
sudo snap install core; sudo snap refresh core
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
sudo certbot --nginx
```
go through the certbot wizard, selecting the url that was configured in /etc/nginx/sites-available/navpay.conf

### Finishing Up

Wait for the blockchain to be fully downloaded and parsed into the mongodb. Once the progress is showing as 100 percent complete in the system journal the server is ready to be connected to with your NavPay wallet client.

Since we used the `enable` command on both bitcore and mongo, these should both start up automatically on any system restart.

## Upgrading

### Daemon Only

install the new version of navcoind, replacing `<x.x.x>` with the installed version number and `<y.y.y>` with the new version number you wish to install.
```
sudo systemctl stop bitcore
wget https://github.com/navcoin/navcoin-core/releases/download/<x.x.x>/navcoin-<y.y.y>-x86_64-linux-gnu.tar.gz
tar zxvf navcoin-<y.y.y>-x86_64-linux-gnu.tar.gz
sudo cp /home/navpay/navcoin-<x.x.x>/bin/navcoind /home/navpay/mynode/node_modules/bitcore-node/bin/navcoind
sudo cp /home/navpay/navcoin-<x.x.x>/bin/navcoind /usr/local/bin/navcoind
sudo systemctl start bitcore
```

check the daemon updated and bitcore is syncing, replacing `<x.x.x>` with the newly installed daemon version.
```
/home/navpay/mynode/node_modules/bitcore-node/bin/navcoin-<x.x.x>/bin/navcoin-cli -datadir=/home/navpay/mynode/data/ getinfo
sudo journalctl -u bitcore.service -f
```

you should see the new daemon version in the getinfo output and the service syncing successfully in the journal.

### Bitcore & Daemon

ensure the bitcore-node configruation has the latest daemon version specified, if not, make a PR to update the version in the repo here;

https://github.com/Encrypt-S/bitcore-node/blob/master/scripts/download

move the data folder out of the install directory so we don't have to download the entire blockchain again and reinstall the bitcore service
```
sudo systemctl stop bitcore
mv ~/mynode/data ~/data-backup
rm -rf mynode
npm install --unsafe-perm -g git://github.com/Encrypt-S/bitcore-node.git
bitcore-node create mynode
cd mynode
bitcore-node install insight-api
bitcore-node install bitcore-wallet-service
mv ~/data-backup ~/mynode/data
sudo systemctl start bitcore
sudo systemctl status bitcore
```

check the daemon updated and bitcore is syncing, replacing `<x.x.x>` with the newly installed daemon version.
```
/home/navpay/mynode/node_modules/bitcore-node/bin/navcoin-<x.x.x>/bin/navcoin-cli -datadir=/home/navpay/mynode/data/ getinfo
sudo journalctl -u bitcore.service -f
```

you should see the new daemon version in the getinfo output and the service syncing successfully in the journal.
